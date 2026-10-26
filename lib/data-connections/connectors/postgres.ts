import postgres from "postgres";
import { isIP } from "node:net";
import { PortalError } from "@/lib/customer-portal/validation";
import { humanizeConnectionError } from "../errors";
import { resolveConnectionHost } from "../host";
import { qualifiedName, quoteIdentifier, displayTableName } from "../identifiers";
import {
  CONNECT_TIMEOUT_S,
  POOL_MAX,
  READ_BATCH,
  SAMPLE_LIMIT,
  STATEMENT_TIMEOUT_MS,
  type ColumnInfo,
  type ConnectionConfig,
  type Connector,
  type RowQuery,
  type SampleResult,
  type TableInfo,
  type TestResult,
} from "../types";

type Sql = ReturnType<typeof postgres>;
type Tx = Parameters<Parameters<Sql["begin"]>[1]>[0];

/** 호스트를 공개 주소로 확인한 뒤 읽기 전용 트랜잭션 하나를 열어 fn을 실행한다. 끝나면 풀을 닫는다. */
async function withReadOnly<T>(config: ConnectionConfig, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const resolved = await resolveConnectionHost(config.host);
  const sql = postgres({
    host: resolved.address,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    // 호스트 이름으로 SNI를 보내되, IP 주소에는 servername을 줄 수 없다(Node TLS 제약).
    ssl: config.ssl ? { rejectUnauthorized: false, ...(isIP(config.host) ? {} : { servername: config.host }) } : false,
    max: POOL_MAX,
    connect_timeout: CONNECT_TIMEOUT_S,
    idle_timeout: 5,
    max_lifetime: 120,
    prepare: false,
    connection: {
      statement_timeout: STATEMENT_TIMEOUT_MS,
      application_name: "idealai-db-knowledge",
    },
    onnotice: () => {},
  });
  try {
    return (await sql.begin("read only", (tx) => fn(tx as Tx))) as T;
  } catch (e) {
    if (e instanceof PortalError) throw e;
    throw new PortalError(humanizeConnectionError(e, "postgres"), 400);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

const TABLES = `
  SELECT n.nspname AS schema, c.relname AS table, c.relkind AS relkind,
    CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS row_estimate
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p','v','m')
    AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
    AND has_table_privilege(c.oid, 'SELECT')
  ORDER BY (n.nspname <> 'public'), n.nspname, c.relname
  LIMIT 500`;

function toTables(rows: Record<string, unknown>[]): TableInfo[] {
  return rows.map((r) => ({
    schema: String(r.schema),
    table: String(r.table),
    name: displayTableName(String(r.schema), String(r.table)),
    kind: r.relkind === "v" || r.relkind === "m" ? "view" : "table",
    rowEstimate: r.row_estimate === null || r.row_estimate === undefined ? null : Number(r.row_estimate),
  }));
}

/** JSON으로 안전하게 보낼 값. Date·bigint·Buffer를 문자열로. */
export function plainValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return "[binary]";
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
  return value;
}
export function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = plainValue(v);
  return out;
}

async function columnsOf(tx: Tx, schema: string, table: string): Promise<ColumnInfo[]> {
  const rows = await tx`SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema=${schema} AND table_name=${table} ORDER BY ordinal_position`;
  if (!rows.length) throw new PortalError("테이블을 찾지 못했어요. 테이블이 삭제됐거나 이름이 바뀌었는지 확인해주세요.", 404);
  return rows.map((r) => ({ name: String(r.column_name), type: String(r.data_type), nullable: r.is_nullable === "YES" }));
}

const OPS: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
/** 필터는 컬럼 인용 + 값 바인딩으로만 만든다. 연산자는 목록 밖이면 거부. */
export function buildRowQuery(query: RowQuery, kind: "postgres" = "postgres", batch = READ_BATCH) {
  const params: unknown[] = [];
  const where: string[] = [];
  for (const f of query.filters) {
    const col = quoteIdentifier(f.column, kind);
    if (f.op === "is_null") where.push(`${col} IS NULL`);
    else if (f.op === "not_null") where.push(`${col} IS NOT NULL`);
    else if (f.op === "in" || f.op === "not_in") {
      const list = Array.isArray(f.value) ? f.value : [];
      if (!list.length) throw new PortalError("필터 값을 입력해주세요.");
      const marks = list.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      where.push(`${col}::text ${f.op === "in" ? "IN" : "NOT IN"} (${marks.join(",")})`);
    } else if (f.op in OPS) {
      if (f.value === undefined || Array.isArray(f.value)) throw new PortalError("필터 값을 입력해주세요.");
      params.push(f.value);
      // 숫자 비교는 숫자로, 나머지는 텍스트로 비교한다. 컬럼 타입 캐스트 실패는 DB 오류로 돌아온다.
      where.push(typeof f.value === "number" ? `${col} ${OPS[f.op]} $${params.length}` : `${col}::text ${OPS[f.op]} $${params.length}`);
    } else throw new PortalError("지원하지 않는 필터예요.");
  }
  const key = quoteIdentifier(query.keyColumn, kind);
  const cols = [...new Set([query.keyColumn, ...query.columns])].map((c) => quoteIdentifier(c, kind)).join(", ");
  params.push(null); // cursor placeholder, replaced per batch
  const cursorIndex = params.length;
  const sql = `SELECT ${cols} FROM ${qualifiedName(query.schema, query.table, kind)}
    WHERE ${[...where, `($${cursorIndex}::text IS NULL OR ${key}::text > $${cursorIndex}::text)`].join(" AND ")}
    ORDER BY ${key}::text ASC LIMIT ${Math.max(1, Math.min(batch, READ_BATCH))}`;
  return { sql, params, cursorIndex };
}

export const postgresConnector: Connector = {
  async testConnection(config): Promise<TestResult> {
    try {
      const tables = await withReadOnly(config, async (tx) => toTables((await tx.unsafe(TABLES)) as unknown as Record<string, unknown>[]));
      return { ok: true, tableCount: tables.length, tables };
    } catch (e) {
      if (e instanceof PortalError) return { ok: false, error: e.message };
      return { ok: false, error: humanizeConnectionError(e, "postgres") };
    }
  },
  listTables(config) {
    return withReadOnly(config, async (tx) => toTables((await tx.unsafe(TABLES)) as unknown as Record<string, unknown>[]));
  },
  sample(config, schema, table, limit = SAMPLE_LIMIT): Promise<SampleResult> {
    return withReadOnly(config, async (tx) => {
      const columns = await columnsOf(tx, schema, table);
      const rows = (await tx.unsafe(
        `SELECT * FROM ${qualifiedName(schema, table)} LIMIT ${Math.max(1, Math.min(limit, 50))}`,
      )) as unknown as Record<string, unknown>[];
      return { columns, rows: rows.map(plainRow) };
    });
  },
  readRows(config, query, onBatch, batch = READ_BATCH) {
    return withReadOnly(config, async (tx) => {
      const built = buildRowQuery(query, "postgres", batch);
      let cursor: string | null = null;
      while (true) {
        const params = [...built.params];
        params[built.cursorIndex - 1] = cursor;
        const rows = (await tx.unsafe(built.sql, params as never[])) as unknown as Record<string, unknown>[];
        if (!rows.length) return;
        const plain = rows.map(plainRow);
        const stop = await onBatch(plain);
        if (stop === false || rows.length < batch) return;
        const last = plain[plain.length - 1][query.keyColumn];
        cursor = last === null || last === undefined ? null : String(last);
        if (cursor === null) return;
      }
    });
  },
};
