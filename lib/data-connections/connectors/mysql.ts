import mysql from "mysql2/promise";
import { isIP } from "node:net";
import { PortalError } from "@/lib/customer-portal/validation";
import { humanizeConnectionError } from "../errors";
import { resolveConnectionHost } from "../host";
import { quoteIdentifier } from "../identifiers";
import {
  CONNECT_TIMEOUT_S,
  LOOKUP_CONNECT_TIMEOUT_S,
  LOOKUP_TIMEOUT_MS,
  LookupTimeoutError,
  escapeLike,
  READ_BATCH,
  SAMPLE_LIMIT,
  STATEMENT_TIMEOUT_MS,
  type ColumnInfo,
  type ConnectionConfig,
  type Connector,
  type LookupQuery,
  type RowFilter,
  type RowQuery,
  type SampleResult,
  type TableInfo,
  type TestResult,
} from "../types";
import { LOOKUP_READ_MAX, plainRow } from "./postgres";

type Conn = mysql.Connection;

/**
 * MySQL은 스키마 = 데이터베이스다. 화면·소스 설정은 Postgres와 같은 모양을 쓰므로
 * 기본 스키마 "public"을 접속한 데이터베이스로 바꿔 읽는다.
 */
const schemaOf = (schema: string, config: ConnectionConfig) => (schema === "public" ? config.database : schema);
const qualified = (schema: string, table: string, config: ConnectionConfig) =>
  quoteIdentifier(schemaOf(schema, config), "mysql") + "." + quoteIdentifier(table, "mysql");

/** 공개 주소 확인 → 읽기 전용 세션·20초 실행 제한 → 읽기 전용 트랜잭션에서 fn 실행 → 연결 종료. */
type SessionOptions = { timeoutMs?: number; connectTimeoutS?: number };
async function withReadOnly<T>(config: ConnectionConfig, fn: (conn: Conn) => Promise<T>, opts: SessionOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? STATEMENT_TIMEOUT_MS;
  const resolved = await resolveConnectionHost(config.host);
  let conn: Conn | null = null;
  try {
    conn = await mysql.createConnection({
      host: resolved.address,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      connectTimeout: (opts.connectTimeoutS ?? CONNECT_TIMEOUT_S) * 1000,
      ssl: config.ssl
        ? { rejectUnauthorized: false, ...(/^[a-z0-9.-]+$/.test(config.host) && !isIP(config.host) ? { servername: config.host } : {}) }
        : undefined,
      // 큰 정수·DECIMAL은 문자열로 받아 정밀도를 잃지 않는다. 날짜는 Date로.
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: false,
      // 날짜·시각은 원본 문자열 그대로(서버 시간대로 Date 변환하면 자정 근처 날짜가 밀린다).
      dateStrings: true,
      multipleStatements: false,
      charset: "utf8mb4",
    });
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    // MySQL은 MAX_EXECUTION_TIME(ms), MariaDB는 max_statement_time(초)를 쓴다.
    try {
      await conn.query(`SET SESSION MAX_EXECUTION_TIME=${timeoutMs}`);
    } catch {
      await conn.query(`SET SESSION max_statement_time=${Math.ceil(timeoutMs / 1000)}`);
    }
    await conn.query("START TRANSACTION READ ONLY");
    const out = await fn(conn);
    await conn.query("COMMIT");
    return out;
  } catch (e) {
    if (e instanceof PortalError || e instanceof LookupTimeoutError) throw e;
    // MySQL 3024(MAX_EXECUTION_TIME 초과)·MariaDB 1969(max_statement_time 초과). 실시간 조회는 상태로 돌려준다.
    const errno = Number((e as { errno?: unknown })?.errno);
    if (opts.timeoutMs && (errno === 3024 || errno === 1969)) throw new LookupTimeoutError();
    throw new PortalError(humanizeConnectionError(e, "mysql"), 400);
  } finally {
    await conn?.end().catch(() => {});
  }
}

const TABLES = `SELECT table_schema AS \`schema\`, table_name AS \`table\`, table_type AS kind, table_rows AS row_estimate
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
  ORDER BY table_name LIMIT 500`;

function toTables(rows: Record<string, unknown>[]): TableInfo[] {
  return rows.map((r) => ({
    // 접속한 데이터베이스의 표는 "public"으로 다뤄 화면 이름이 표 이름만 되게 한다.
    schema: "public",
    table: String(r.table),
    name: String(r.table),
    kind: String(r.kind).toUpperCase().includes("VIEW") ? "view" : "table",
    rowEstimate: r.row_estimate === null || r.row_estimate === undefined ? null : Number(r.row_estimate),
  }));
}

async function columnsOf(conn: Conn, schema: string, table: string, config: ConnectionConfig): Promise<ColumnInfo[]> {
  const [rows] = await conn.query(
    "SELECT column_name AS name, data_type AS type, is_nullable AS nullable FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position",
    [schemaOf(schema, config), table],
  );
  const list = rows as Record<string, unknown>[];
  if (!list.length) throw new PortalError("테이블을 찾지 못했어요. 테이블이 삭제됐거나 이름이 바뀌었는지 확인해주세요.", 404);
  return list.map((r) => ({ name: String(r.name), type: String(r.type), nullable: r.nullable === "YES" }));
}

const OPS: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
function numeric(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || String(value).trim() === "") throw new PortalError("숫자 필터 값을 확인해주세요.");
  return n;
}
/** Postgres 빌더와 같은 규칙: 식별자는 백틱 인용, 값은 ? 바인딩, 연산자는 목록 밖이면 거부, 고유키 순 키셋. */
/** 고정 필터 → WHERE 조각(? 바인딩). Postgres filterClauses와 같은 규칙. */
export function mysqlFilterClauses(filters: RowFilter[], params: unknown[]): string[] {
  const where: string[] = [];
  for (const f of filters) {
    const col = quoteIdentifier(f.column, "mysql");
    const asNumber = f.kind === "number" || (f.kind === undefined && typeof f.value === "number");
    const text = `CAST(${col} AS CHAR)`;
    if (f.op === "is_null") where.push(`${col} IS NULL`);
    else if (f.op === "not_null") where.push(`${col} IS NOT NULL`);
    else if (f.op === "in" || f.op === "not_in") {
      const list = Array.isArray(f.value) ? f.value : [];
      if (!list.length) throw new PortalError("필터 값을 입력해주세요.");
      for (const v of list) params.push(asNumber ? numeric(v) : String(v));
      where.push(`${asNumber ? col : text} ${f.op === "in" ? "IN" : "NOT IN"} (${list.map(() => "?").join(",")})`);
    } else if (f.op in OPS) {
      if (f.value === undefined || Array.isArray(f.value)) throw new PortalError("필터 값을 입력해주세요.");
      params.push(asNumber ? numeric(f.value) : String(f.value));
      where.push(`${asNumber ? col : text} ${OPS[f.op]} ?`);
    } else throw new PortalError("지원하지 않는 필터예요.");
  }
  return where;
}
export function buildMysqlRowQuery(query: RowQuery, config: ConnectionConfig, batch = READ_BATCH, withCursor = false) {
  const params: unknown[] = [];
  const where = mysqlFilterClauses(query.filters, params);
  const key = quoteIdentifier(query.keyColumn, "mysql");
  const cols = [...new Set([query.keyColumn, ...query.columns])].map((c) => quoteIdentifier(c, "mysql")).join(", ");
  const filterSql = where.length ? where.join(" AND ") : "";
  const cursorWhere = withCursor ? `${key} > ?` : "";
  const allWhere = [filterSql, cursorWhere].filter(Boolean).join(" AND ");
  const sql = `SELECT ${cols} FROM ${qualified(query.schema, query.table, config)}${allWhere ? ` WHERE ${allWhere}` : ""} ORDER BY ${key} ASC LIMIT ${Math.max(1, Math.min(batch, READ_BATCH))}`;
  const count = `SELECT COUNT(*) AS n, COUNT(DISTINCT ${key}) AS k FROM ${qualified(query.schema, query.table, config)}${filterSql ? ` WHERE ${filterSql}` : ""}`;
  return { sql, count, params, withCursor };
}

/** 실시간 조회 질의(MySQL). 같음은 대소문자 무시, 포함은 LIKE(와일드카드 이스케이프), 숫자는 숫자 비교. */
export function buildMysqlLookupQuery(query: LookupQuery, config: ConnectionConfig) {
  if (!query.conditions.length) throw new PortalError("조건이 없는 조회는 실행할 수 없어요.");
  if (!query.columns.length) throw new PortalError("보여줄 컬럼을 하나 이상 골라주세요.");
  const params: unknown[] = [];
  const where = mysqlFilterClauses(query.filters, params);
  for (const c of query.conditions) {
    const col = quoteIdentifier(c.column, "mysql");
    if (c.kind === "number") {
      params.push(numeric(c.value));
      where.push(`${col} = ?`);
    } else if (c.match === "contains") {
      params.push(escapeLike(String(c.value)));
      where.push(`CAST(${col} AS CHAR) LIKE CONCAT('%', ?, '%')`);
    } else {
      params.push(String(c.value));
      where.push(`LOWER(CAST(${col} AS CHAR)) = LOWER(?)`);
    }
  }
  const cols = [...new Set(query.columns)].map((c) => quoteIdentifier(c, "mysql")).join(", ");
  const limit = Math.max(1, Math.min(Math.floor(query.limit), LOOKUP_READ_MAX));
  return { sql: `SELECT ${cols} FROM ${qualified(query.schema, query.table, config)} WHERE ${where.join(" AND ")} LIMIT ${limit}`, params };
}

export const mysqlConnector: Connector = {
  async testConnection(config): Promise<TestResult> {
    try {
      const tables = await withReadOnly(config, async (conn) => toTables((await conn.query(TABLES))[0] as Record<string, unknown>[]));
      return { ok: true, tableCount: tables.length, tables };
    } catch (e) {
      if (e instanceof PortalError) return { ok: false, error: e.message };
      return { ok: false, error: humanizeConnectionError(e, "mysql") };
    }
  },
  listTables(config) {
    return withReadOnly(config, async (conn) => toTables((await conn.query(TABLES))[0] as Record<string, unknown>[]));
  },
  sample(config, schema, table, limit = SAMPLE_LIMIT): Promise<SampleResult> {
    return withReadOnly(config, async (conn) => {
      const columns = await columnsOf(conn, schema, table, config);
      const [rows] = await conn.query(`SELECT * FROM ${qualified(schema, table, config)} LIMIT ${Math.max(1, Math.min(limit, 50))}`);
      return { columns, rows: (rows as Record<string, unknown>[]).map(plainRow) };
    });
  },
  countRows(config, query) {
    return withReadOnly(config, async (conn) => {
      const built = buildMysqlRowQuery(query, config, 1, false);
      const [rows] = await conn.query(built.count, built.params);
      const row = (rows as Record<string, unknown>[])[0] ?? {};
      return { total: Number(row.n ?? 0), distinctKeys: Number(row.k ?? 0) };
    });
  },
  readRows(config, query, onBatch, batch = READ_BATCH, startAfter = undefined) {
    return withReadOnly(config, async (conn) => {
      let cursor: unknown = startAfter === null ? undefined : startAfter;
      while (true) {
        const built = buildMysqlRowQuery(query, config, batch, cursor !== undefined);
        const params = cursor === undefined ? built.params : [...built.params, cursor];
        const [result] = await conn.query(built.sql, params);
        const rows = result as Record<string, unknown>[];
        if (!rows.length) return;
        const last = rows[rows.length - 1][query.keyColumn];
        const stop = await onBatch(rows.map(plainRow), last);
        if (stop === false || rows.length < batch) return;
        cursor = last;
        if (cursor === null || cursor === undefined) return;
      }
    });
  },
  lookup(config, query, timeoutMs = LOOKUP_TIMEOUT_MS) {
    return withReadOnly(
      config,
      async (conn) => {
        const built = buildMysqlLookupQuery(query, config);
        const [rows] = await conn.query(built.sql, built.params);
        return (rows as Record<string, unknown>[]).map(plainRow);
      },
      { timeoutMs, connectTimeoutS: LOOKUP_CONNECT_TIMEOUT_S },
    );
  },
};
