import { randomUUID } from "node:crypto";
import type { AccessDatabase } from "@/lib/access/schema";
import { PortalError, text } from "@/lib/customer-portal/validation";
import { quoteIdentifier } from "@/lib/data-connections/identifiers";
import { assertDbKnowledgeAllowed, credentialsOf, toView, type DataConnectionRow } from "@/lib/data-connections/store";
import type { RowFilter } from "@/lib/data-connections/types";
import { DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT, SCHEDULES, SOURCE_LIMIT_PER_CUSTOMER, type BodyColumn, type Schedule, type SourceConfig, type SyncResult } from "./types";

export type DbSourceRow = {
  id: string;
  bot_id: string;
  connection_id: string;
  schema_name: string;
  table_name: string;
  title_column: string;
  key_column: string;
  body_columns: BodyColumn[];
  excluded_columns: string[];
  filters: RowFilter[];
  folder_id: string | null;
  schedule: Schedule;
  row_limit: number;
  missing_rows: "archive" | "delete";
  enabled: boolean;
  last_synced_at: number | null;
  next_sync_at: number | null;
  last_result: SyncResult | null;
  last_error: string | null;
  consecutive_failures: number;
  sync_locked_at: number | null;
  sync_started_at?: number | null;
  sync_state?: unknown;
  created_at: number;
  updated_at: number;
};

/** 봇 소속 고객사(bot.customer_id)와 연결의 고객사가 같아야 한다. 고객사 미배정 봇은 DB 지식을 쓸 수 없다. */
export async function connectionForBot(db: AccessDatabase, bot: { id: string; customer_id: string | null }, connectionId: string) {
  if (!bot.customer_id) throw new PortalError("이 챗봇을 고객사에 배정한 뒤 DB를 연결할 수 있어요.", 409);
  const [row] = await db<DataConnectionRow[]>`SELECT * FROM data_connections WHERE id=${connectionId} AND customer_id=${bot.customer_id} AND status<>'deleted'`;
  if (!row) throw new PortalError("데이터 연결을 찾을 수 없습니다.", 404);
  return row;
}
export async function listConnectionsForBot(db: AccessDatabase, bot: { customer_id: string | null }) {
  if (!bot.customer_id) return [];
  const rows = await db<DataConnectionRow[]>`SELECT * FROM data_connections WHERE customer_id=${bot.customer_id} AND status<>'deleted' ORDER BY created_at,id`;
  return rows.map(toView);
}

const FILTER_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "is_null", "not_null"]);
const ident = (v: unknown, label: string) => {
  const s = text(v, label, 128);
  quoteIdentifier(s);
  return s;
};
/** 폼 입력 → 검증된 소스 설정. 컬럼 이름은 식별자 규칙만 확인하고, 실제 존재 여부는 가져오기 때 DB 오류로 드러난다. */
export function sourceConfig(input: Record<string, unknown>): SourceConfig {
  const connectionId = text(input.connectionId, "데이터 연결", 200);
  const schema = ident(input.schema ?? "public", "스키마");
  const table = ident(input.table, "테이블");
  const titleColumn = ident(input.titleColumn, "제목 컬럼");
  const keyColumn = ident(input.keyColumn, "고유키 컬럼");
  if (!input.keyColumn) throw new PortalError("고유키 컬럼을 골라주세요.");
  const bodyRaw = Array.isArray(input.bodyColumns) ? input.bodyColumns : [];
  const bodyColumns: BodyColumn[] = bodyRaw.slice(0, 100).map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    const column = ident(o.column, "본문 컬럼");
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 40) : column;
    const unit = typeof o.unit === "string" ? o.unit.trim().slice(0, 10) : "";
    const type = typeof o.type === "string" ? o.type.trim().slice(0, 60) : "";
    const valueMap: Record<string, string> = {};
    if (o.valueMap && typeof o.valueMap === "object")
      for (const [k, v] of Object.entries(o.valueMap as Record<string, unknown>).slice(0, 50)) valueMap[String(k).slice(0, 50)] = String(v).slice(0, 50);
    return { column, label, ...(type ? { type } : {}), ...(unit ? { unit } : {}), ...(Object.keys(valueMap).length ? { valueMap } : {}) };
  });
  if (!bodyColumns.length) throw new PortalError("본문에 넣을 컬럼을 하나 이상 골라주세요.");
  if (bodyColumns.some((b) => b.column === keyColumn)) throw new PortalError("고유키 컬럼은 본문에 넣을 수 없어요.");
  const excludedColumns = (Array.isArray(input.excludedColumns) ? input.excludedColumns : []).slice(0, 200).map((c) => ident(c, "제외 컬럼"));
  const filters: RowFilter[] = (Array.isArray(input.filters) ? input.filters : []).slice(0, 20).map((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const column = ident(o.column, "필터 컬럼");
    const op = String(o.op ?? "");
    if (!FILTER_OPS.has(op)) throw new PortalError("지원하지 않는 필터예요.");
    const kind = o.kind === "number" ? "number" : o.kind === "text" ? "text" : undefined;
    let value: RowFilter["value"];
    if (op === "in" || op === "not_in") {
      const list = Array.isArray(o.value) ? o.value : String(o.value ?? "").split(",");
      value = list.map((v) => (typeof v === "number" ? v : String(v).trim())).filter((v) => v !== "").slice(0, 100);
      if (!value.length) throw new PortalError("필터 값을 입력해주세요.");
    } else if (op === "is_null" || op === "not_null") value = undefined;
    else {
      if (o.value === undefined || o.value === null || o.value === "") throw new PortalError("필터 값을 입력해주세요.");
      value = typeof o.value === "number" || typeof o.value === "boolean" ? o.value : String(o.value).slice(0, 500);
    }
    return { column, op: op as RowFilter["op"], ...(value !== undefined ? { value } : {}), ...(kind ? { kind } : {}) };
  });
  const folderId = input.folderId ? text(input.folderId, "폴더", 200) : null;
  const schedule = (input.schedule ?? "daily") as Schedule;
  if (!SCHEDULES.includes(schedule)) throw new PortalError("동기화 주기를 확인해주세요.");
  const rowLimit = input.rowLimit === undefined || input.rowLimit === "" ? DEFAULT_ROW_LIMIT : Number(input.rowLimit);
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > MAX_ROW_LIMIT)
    throw new PortalError(`행 상한은 1~${MAX_ROW_LIMIT.toLocaleString("ko-KR")} 사이로 입력해주세요.`);
  const missingRows = input.missingRows === "delete" ? "delete" : "archive";
  return { connectionId, schema, table, titleColumn, keyColumn, bodyColumns, excludedColumns, filters, folderId, schedule, rowLimit, missingRows };
}

export function nextSyncAt(schedule: Schedule, from = Math.floor(Date.now() / 1000)): number | null {
  if (schedule === "manual") return null;
  if (schedule === "hourly") return from + 3600;
  // 매일·매주는 다음 새벽 3시(KST)로 맞춘다.
  const kst = new Date((from + 9 * 3600) * 1000);
  const next = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1, 3, 0, 0));
  let ts = Math.floor(next.getTime() / 1000) - 9 * 3600;
  if (schedule === "weekly") ts += 6 * 86400;
  return ts;
}

export async function listDbSources(db: AccessDatabase, botId: string, sourceId?: string) {
  const rows = await db<(DbSourceRow & { connection_name: string; connection_status: string; folder_name: string | null })[]>`
    SELECT s.*, c.name AS connection_name, c.status AS connection_status, f.name AS folder_name
    FROM db_sources s JOIN data_connections c ON c.id=s.connection_id LEFT JOIN doc_folders f ON f.id=s.folder_id
    WHERE s.bot_id=${botId} ${sourceId ? db`AND s.id=${sourceId}` : db``} ORDER BY s.created_at, s.id`;
  return rows.map(sourceView);
}
export function sourceView(row: DbSourceRow & { connection_name?: string; connection_status?: string; folder_name?: string | null }) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name ?? null,
    connectionDeleted: row.connection_status === "deleted",
    schema: row.schema_name,
    table: row.table_name,
    tableLabel: row.schema_name === "public" ? row.table_name : `${row.schema_name}.${row.table_name}`,
    titleColumn: row.title_column,
    keyColumn: row.key_column,
    bodyColumns: row.body_columns,
    excludedColumns: row.excluded_columns,
    filters: row.filters,
    folderId: row.folder_id,
    folderName: row.folder_name ?? null,
    schedule: row.schedule,
    rowLimit: Number(row.row_limit),
    missingRows: row.missing_rows,
    enabled: Boolean(row.enabled),
    lastSyncedAt: row.last_synced_at === null ? null : Number(row.last_synced_at),
    nextSyncAt: row.next_sync_at === null ? null : Number(row.next_sync_at),
    lastResult: row.last_result,
    lastError: row.last_error,
    consecutiveFailures: Number(row.consecutive_failures),
    syncing: row.sync_locked_at !== null && Number(row.sync_locked_at) > Math.floor(Date.now() / 1000) - 600,
    createdAt: Number(row.created_at),
  };
}
export type DbSourceView = ReturnType<typeof sourceView>;

export async function dbSource(db: AccessDatabase, botId: string, sourceId: string, lock = false) {
  const [row] = lock
    ? await db<DbSourceRow[]>`SELECT * FROM db_sources WHERE id=${sourceId} AND bot_id=${botId} FOR UPDATE`
    : await db<DbSourceRow[]>`SELECT * FROM db_sources WHERE id=${sourceId} AND bot_id=${botId}`;
  if (!row) throw new PortalError("DB 소스를 찾을 수 없습니다.", 404);
  return row;
}

async function assertFolder(db: AccessDatabase, botId: string, folderId: string | null) {
  if (!folderId) return;
  const [f] = await db`SELECT id FROM doc_folders WHERE id=${folderId} AND bot_id=${botId}`;
  if (!f) throw new PortalError("이 챗봇의 폴더를 선택해주세요.", 404);
}

export async function createDbSource(
  db: AccessDatabase,
  actor: { userId: string | null; tenantId: string; customerId: string | null },
  bot: { id: string; customer_id: string | null },
  input: Record<string, unknown>,
) {
  const config = sourceConfig(input);
  await assertDbKnowledgeAllowed(db, actor.tenantId);
  const connection = await connectionForBot(db, bot, config.connectionId);
  await assertFolder(db, bot.id, config.folderId);
  await db`SELECT id FROM customers WHERE id=${connection.customer_id} FOR UPDATE`;
  const [{ count }] = await db`SELECT count(*)::int AS count FROM db_sources s JOIN bots b ON b.id=s.bot_id WHERE b.customer_id=${connection.customer_id}`;
  if (Number(count) >= SOURCE_LIMIT_PER_CUSTOMER)
    throw new PortalError(`고객사당 DB 소스는 ${SOURCE_LIMIT_PER_CUSTOMER}개까지 만들 수 있어요.`, 409);
  const [dup] = await db`SELECT id FROM db_sources WHERE bot_id=${bot.id} AND connection_id=${config.connectionId} AND schema_name=${config.schema} AND table_name=${config.table}`;
  if (dup) throw new PortalError("이미 등록된 테이블이에요. 기존 소스를 수정하거나 삭제해주세요.", 409);
  const id = randomUUID();
  const [row] = await db<DbSourceRow[]>`INSERT INTO db_sources(id,bot_id,connection_id,schema_name,table_name,title_column,key_column,body_columns,excluded_columns,filters,folder_id,schedule,row_limit,missing_rows,next_sync_at,created_by)
    VALUES(${id},${bot.id},${config.connectionId},${config.schema},${config.table},${config.titleColumn},${config.keyColumn},${db.json(config.bodyColumns)},${db.json(config.excludedColumns)},${db.json(config.filters)},${config.folderId},${config.schedule},${config.rowLimit},${config.missingRows},${nextSyncAt(config.schedule)},${actor.userId}) RETURNING *`;
  await audit(db, actor, connection.customer_id, "db_source.create", id);
  return sourceView(row);
}

export async function updateDbSource(
  db: AccessDatabase,
  actor: { userId: string | null; tenantId: string },
  bot: { id: string; customer_id: string | null },
  sourceId: string,
  input: Record<string, unknown>,
) {
  const existing = await dbSource(db, bot.id, sourceId, true);
  const config = sourceConfig({ ...rowToInput(existing), ...input });
  const connection = await connectionForBot(db, bot, config.connectionId);
  await assertFolder(db, bot.id, config.folderId);
  const [row] = await db<DbSourceRow[]>`UPDATE db_sources SET connection_id=${config.connectionId}, schema_name=${config.schema}, table_name=${config.table},
    title_column=${config.titleColumn}, key_column=${config.keyColumn}, body_columns=${db.json(config.bodyColumns)}, excluded_columns=${db.json(config.excludedColumns)},
    filters=${db.json(config.filters)}, folder_id=${config.folderId}, schedule=${config.schedule}, row_limit=${config.rowLimit}, missing_rows=${config.missingRows},
    next_sync_at=${existing.schedule === config.schedule && existing.next_sync_at && input.enabled !== true ? existing.next_sync_at : nextSyncAt(config.schedule)},
    enabled=${input.enabled === undefined ? existing.enabled : Boolean(input.enabled)},
    consecutive_failures=${input.enabled === true ? 0 : existing.consecutive_failures},
    last_error=${input.enabled === true ? null : existing.last_error},
    updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${sourceId} RETURNING *`;
  // 폴더가 바뀌면 이미 가져온 문서도 옮긴다.
  if (config.folderId !== existing.folder_id)
    await db`UPDATE documents SET folder_id=${config.folderId} WHERE id IN (SELECT document_id FROM db_source_rows WHERE source_id=${sourceId} AND document_id IS NOT NULL)`;
  await audit(db, actor, connection.customer_id, "db_source.update", sourceId);
  return sourceView(row);
}

/** 소스 삭제. 문서는 기본 보관(검색 제외), documents: "delete"면 삭제. */
export async function deleteDbSource(
  db: AccessDatabase,
  actor: { userId: string | null; tenantId: string },
  bot: { id: string; customer_id: string | null },
  sourceId: string,
  documents: "archive" | "delete" = "archive",
) {
  const existing = await dbSource(db, bot.id, sourceId, true);
  if (documents === "delete")
    await db`DELETE FROM documents WHERE bot_id=${bot.id} AND id IN (SELECT document_id FROM db_source_rows WHERE source_id=${sourceId} AND document_id IS NOT NULL)`;
  else
    await db`UPDATE documents SET archived_at=COALESCE(archived_at, EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE bot_id=${bot.id} AND id IN (SELECT document_id FROM db_source_rows WHERE source_id=${sourceId} AND document_id IS NOT NULL)`;
  await db`DELETE FROM db_sources WHERE id=${sourceId}`;
  const [c] = await db`SELECT customer_id FROM data_connections WHERE id=${existing.connection_id}`;
  await audit(db, actor, c ? String(c.customer_id) : bot.customer_id, "db_source.delete", sourceId);
  return { ok: true };
}

export function rowToInput(row: DbSourceRow): Record<string, unknown> {
  return {
    connectionId: row.connection_id,
    schema: row.schema_name,
    table: row.table_name,
    titleColumn: row.title_column,
    keyColumn: row.key_column,
    bodyColumns: row.body_columns,
    excludedColumns: row.excluded_columns,
    filters: row.filters,
    folderId: row.folder_id,
    schedule: row.schedule,
    rowLimit: Number(row.row_limit),
    missingRows: row.missing_rows,
  };
}
export function configOf(row: DbSourceRow): SourceConfig {
  return sourceConfig(rowToInput(row));
}

export async function audit(
  db: AccessDatabase,
  actor: { userId: string | null; tenantId: string },
  customerId: string | null,
  action: string,
  target: string | null,
) {
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${actor.userId},${actor.tenantId},${customerId},${action},${target},'success')`;
}

export { credentialsOf };
