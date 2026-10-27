import sql from "@/lib/neon";
import { getDbRowLimit, normalizePlan } from "@/lib/plans";

/** 마스터 화면용 에이전시별 DB 지식 집계. 건수만 — 접속 정보·문서 본문은 담지 않는다. */
export type DbKnowledgeStats = { connections: number; sources: number; rows: number; failing: number; stopped: number; rowLimit: number };

export async function dbKnowledgeStats(db = sql): Promise<Map<string, DbKnowledgeStats>> {
  const out = new Map<string, DbKnowledgeStats>();
  const ready = await db`SELECT to_regclass('db_sources') IS NOT NULL AS ok`;
  if (!ready[0]?.ok) return out;
  // 표마다 한 번씩만 모아 에이전시별로 합친다(에이전시 수만큼 하위 질의를 돌리지 않음).
  const rows = await db`
    WITH conn AS (SELECT tenant_id, count(*)::int AS n FROM data_connections WHERE status<>'deleted' GROUP BY tenant_id),
      src AS (SELECT b.tenant_id, count(*)::int AS n, count(*) FILTER (WHERE s.last_error IS NOT NULL)::int AS failing, count(*) FILTER (WHERE NOT s.enabled)::int AS stopped
        FROM db_sources s JOIN bots b ON b.id=s.bot_id GROUP BY b.tenant_id),
      rws AS (SELECT b.tenant_id, count(*)::int AS n FROM db_source_rows r JOIN db_sources s ON s.id=r.source_id JOIN bots b ON b.id=s.bot_id WHERE r.status='active' GROUP BY b.tenant_id)
    SELECT t.id, t.plan, t.enterprise_db_row_limit, COALESCE(conn.n,0) AS connections, COALESCE(src.n,0) AS sources,
      COALESCE(rws.n,0) AS rows, COALESCE(src.failing,0) AS failing, COALESCE(src.stopped,0) AS stopped
    FROM tenants t LEFT JOIN conn ON conn.tenant_id=t.id LEFT JOIN src ON src.tenant_id=t.id LEFT JOIN rws ON rws.tenant_id=t.id`;
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
