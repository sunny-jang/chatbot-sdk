import { randomUUID } from "node:crypto";
import type { AccessDatabase } from "@/lib/access/schema";
import { PortalError } from "@/lib/customer-portal/validation";
import { assertDbKnowledgeAllowed } from "@/lib/data-connections/store";
import type { RowFilter } from "@/lib/data-connections/types";
import { audit, connectionForBot } from "@/lib/db-sources/store";
import { LOOKUP_LIMIT_PER_BOT, lookupConfig, type LookupConfig, type LookupOutput, type LookupParam } from "./config";

export type DbLookupRow = {
  id: string;
  bot_id: string;
  connection_id: string;
  name: string;
  description: string;
  schema_name: string;
  table_name: string;
  params: LookupParam[];
  outputs: LookupOutput[];
  filters: RowFilter[];
  max_rows: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};
export type LookupStats = { total: number; ok: number; tooBroad: number; failed: number };
export type DbLookupView = DbLookupRow & { connection_name: string; connection_status: string; stats: LookupStats };

type Actor = { userId: string | null; tenantId: string };
type BotRef = { id: string; customer_id: string | null };

export const configOf = (row: DbLookupRow): LookupConfig => ({
  connectionId: row.connection_id,
  name: row.name,
  description: row.description,
  schema: row.schema_name,
  table: row.table_name,
  params: row.params,
  outputs: row.outputs,
  filters: row.filters,
  maxRows: row.max_rows,
  enabled: row.enabled,
});

/** 화면 목록. 최근 7일 실행 집계(테스트 실행 제외)를 함께 돌려준다. */
export async function listLookups(db: AccessDatabase, botId: string, lookupId?: string): Promise<DbLookupView[]> {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const rows = await db<(DbLookupRow & { connection_name: string; connection_status: string; total: number; ok: number; too_broad: number; failed: number })[]>`
    SELECT l.*, c.name AS connection_name, c.status AS connection_status,
      COALESCE(s.total, 0)::int AS total, COALESCE(s.ok, 0)::int AS ok, COALESCE(s.too_broad, 0)::int AS too_broad, COALESCE(s.failed, 0)::int AS failed
    FROM db_lookups l
    JOIN data_connections c ON c.id = l.connection_id
    LEFT JOIN (
      SELECT lookup_id, count(*) AS total,
        count(*) FILTER (WHERE status IN ('ok','empty')) AS ok,
        count(*) FILTER (WHERE status IN ('too_broad','too_many_calls','rate_limited')) AS too_broad,
        count(*) FILTER (WHERE status IN ('timeout','error')) AS failed
      FROM db_lookup_calls WHERE bot_id = ${botId} AND NOT test AND created_at >= ${since}
      GROUP BY lookup_id
    ) s ON s.lookup_id = l.id
    WHERE l.bot_id = ${botId} ${lookupId ? db`AND l.id = ${lookupId}` : db``}
    ORDER BY l.created_at, l.id`;
  return rows.map(({ total, ok, too_broad, failed, ...row }) => ({
    ...(row as DbLookupRow & { connection_name: string; connection_status: string }),
    stats: { total: Number(total), ok: Number(ok), tooBroad: Number(too_broad), failed: Number(failed) },
  }));
}

export async function dbLookup(db: AccessDatabase, botId: string, lookupId: string, forUpdate = false) {
  const [row] = forUpdate
    ? await db<DbLookupRow[]>`SELECT * FROM db_lookups WHERE id=${lookupId} AND bot_id=${botId} FOR UPDATE`
    : await db<DbLookupRow[]>`SELECT * FROM db_lookups WHERE id=${lookupId} AND bot_id=${botId}`;
  if (!row) throw new PortalError("실시간 조회를 찾을 수 없습니다.", 404);
  return row;
}

/** 표의 실제 컬럼에 없는 컬럼을 고르면 거부한다(저장 전에 커넥터로 읽은 컬럼 목록). */
export function assertColumnsExist(config: LookupConfig, columns: string[]) {
  const known = new Set(columns);
  const used = [...config.params.map((p) => p.column), ...config.outputs.map((o) => o.column), ...config.filters.map((f) => f.column)];
  const missing = used.filter((c) => !known.has(c));
  if (missing.length) throw new PortalError(`표에 없는 컬럼이에요: ${[...new Set(missing)].join(", ")}`);
}

export async function createLookup(db: AccessDatabase, actor: Actor, bot: BotRef, input: Record<string, unknown>, columns: string[]) {
  const config = lookupConfig(input, columns);
  assertColumnsExist(config, columns);
  await assertDbKnowledgeAllowed(db, actor.tenantId);
  const connection = await connectionForBot(db, bot, config.connectionId);
  await db`SELECT id FROM bots WHERE id=${bot.id} FOR UPDATE`;
  const [{ count }] = await db`SELECT count(*)::int AS count FROM db_lookups WHERE bot_id=${bot.id}`;
  if (Number(count) >= LOOKUP_LIMIT_PER_BOT) throw new PortalError(`실시간 조회는 챗봇당 ${LOOKUP_LIMIT_PER_BOT}개까지 만들 수 있어요.`, 409);
  const id = randomUUID();
  await db`INSERT INTO db_lookups(id,bot_id,connection_id,name,description,schema_name,table_name,params,outputs,filters,max_rows,enabled,created_by)
    VALUES(${id},${bot.id},${config.connectionId},${config.name},${config.description},${config.schema},${config.table},${db.json(config.params)},${db.json(config.outputs)},${db.json(config.filters)},${config.maxRows},${config.enabled},${actor.userId})`;
  await audit(db, actor, connection.customer_id, "db_lookup.create", id);
  return (await listLookups(db, bot.id, id))[0];
}

export async function updateLookup(
  db: AccessDatabase,
  actor: Actor,
  bot: BotRef,
  lookupId: string,
  input: Record<string, unknown>,
  columns: string[],
) {
  const existing = await dbLookup(db, bot.id, lookupId, true);
  const config = lookupConfig({ ...configOf(existing), ...input }, columns);
  assertColumnsExist(config, columns);
  await assertDbKnowledgeAllowed(db, actor.tenantId);
  const connection = await connectionForBot(db, bot, config.connectionId);
  await db`UPDATE db_lookups SET connection_id=${config.connectionId}, name=${config.name}, description=${config.description},
    schema_name=${config.schema}, table_name=${config.table}, params=${db.json(config.params)}, outputs=${db.json(config.outputs)},
    filters=${db.json(config.filters)}, max_rows=${config.maxRows}, enabled=${config.enabled}, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
    WHERE id=${lookupId}`;
  await audit(db, actor, connection.customer_id, "db_lookup.update", lookupId);
  return (await listLookups(db, bot.id, lookupId))[0];
}

/** 켜기·끄기. 표 구조를 다시 읽지 않는다. 켤 때는 요금제를 다시 확인한다. */
export async function setLookupEnabled(db: AccessDatabase, actor: Actor, bot: BotRef, lookupId: string, enabled: boolean) {
  await dbLookup(db, bot.id, lookupId, true);
  if (enabled) await assertDbKnowledgeAllowed(db, actor.tenantId);
  await db`UPDATE db_lookups SET enabled=${enabled}, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${lookupId}`;
  await audit(db, actor, bot.customer_id, enabled ? "db_lookup.enable" : "db_lookup.disable", lookupId);
  return (await listLookups(db, bot.id, lookupId))[0];
}

export async function deleteLookup(db: AccessDatabase, actor: Actor, bot: BotRef, lookupId: string) {
  await dbLookup(db, bot.id, lookupId, true);
  await db`DELETE FROM db_lookups WHERE id=${lookupId}`;
  await audit(db, actor, bot.customer_id, "db_lookup.delete", lookupId);
  return { ok: true };
}
