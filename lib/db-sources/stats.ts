import sql from "@/lib/neon";
import { getDbRowLimit, normalizePlan } from "@/lib/plans";

/** 마스터 화면용 에이전시별 DB 지식 집계. 건수만 — 접속 정보·문서 본문은 담지 않는다. */
export type DbKnowledgeStats = { connections: number; sources: number; rows: number; failing: number; stopped: number; rowLimit: number };

export async function dbKnowledgeStats(db = sql): Promise<Map<string, DbKnowledgeStats>> {
  const out = new Map<string, DbKnowledgeStats>();
  const ready = await db`SELECT to_regclass('db_sources') IS NOT NULL AS ok`;
  if (!ready[0]?.ok) return out;
  const rows = await db`
    SELECT t.id, t.plan, t.enterprise_db_row_limit,
      (SELECT count(*)::int FROM data_connections c WHERE c.tenant_id=t.id AND c.status<>'deleted') AS connections,
      (SELECT count(*)::int FROM db_sources s JOIN bots b ON b.id=s.bot_id WHERE b.tenant_id=t.id) AS sources,
      (SELECT count(*)::int FROM db_source_rows r JOIN db_sources s ON s.id=r.source_id JOIN bots b ON b.id=s.bot_id WHERE b.tenant_id=t.id AND r.status='active') AS rows,
      (SELECT count(*)::int FROM db_sources s JOIN bots b ON b.id=s.bot_id WHERE b.tenant_id=t.id AND s.last_error IS NOT NULL) AS failing,
      (SELECT count(*)::int FROM db_sources s JOIN bots b ON b.id=s.bot_id WHERE b.tenant_id=t.id AND NOT s.enabled) AS stopped
    FROM tenants t`;
  for (const r of rows)
    out.set(String(r.id), {
      connections: Number(r.connections),
      sources: Number(r.sources),
      rows: Number(r.rows),
      failing: Number(r.failing),
      stopped: Number(r.stopped),
      rowLimit: getDbRowLimit(normalizePlan(r.plan), r.enterprise_db_row_limit === null ? null : Number(r.enterprise_db_row_limit)),
    });
  return out;
}
