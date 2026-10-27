import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import { audit, type DbSourceRow } from "./store";
import { beginImport, importStep, LOCK_TTL, type ImportState } from "./import";

export const FAILURE_LIMIT = 3;
export const STOPPED_MESSAGE = "연속 3회 실패로 자동 동기화를 멈췄어요. 연결을 확인한 뒤 다시 켜주세요.";
/** 이전 cron 호출이 시간 안에 못 끝낸 실행은 이 시간(초) 동안 하트비트가 없으면 이어 받는다. */
const CONTINUE_AFTER = 30;
type Db = typeof sql;
type DueSource = DbSourceRow & { customer_id: string; tenant_id: string };

/**
 * 예정 시각이 지난 소스와, 지난 cron 호출이 끝내지 못한 cron 실행을 고른다.
 * 고객사당 하나만, 전체는 concurrency개까지. 화면에서 진행 중인 실행(잠금 유효)은 건드리지 않는다.
 */
export async function dueSources(db: Db = sql, now = Math.floor(Date.now() / 1000), concurrency = 2): Promise<DueSource[]> {
  const rows = await db<DueSource[]>`
    SELECT s.*, b.customer_id, b.tenant_id FROM db_sources s
    JOIN bots b ON b.id=s.bot_id
    JOIN data_connections c ON c.id=s.connection_id AND c.status<>'deleted'
    WHERE s.enabled AND b.customer_id IS NOT NULL AND (
      (s.sync_state->>'runner'='cron' AND s.sync_locked_at IS NOT NULL AND s.sync_locked_at < ${now - CONTINUE_AFTER} AND s.sync_locked_at >= ${now - LOCK_TTL})
      OR (s.next_sync_at IS NOT NULL AND s.next_sync_at <= ${now} AND (s.sync_locked_at IS NULL OR s.sync_locked_at < ${now - LOCK_TTL}))
    )
    ORDER BY s.next_sync_at NULLS FIRST, s.id LIMIT 50`;
  const seen = new Set<string>();
  const picked: DueSource[] = [];
  for (const r of rows) {
    if (seen.has(r.customer_id)) continue;
    seen.add(r.customer_id);
    picked.push(r);
    if (picked.length >= concurrency) break;
  }
  return picked;
}

export type SyncOutcome = { sourceId: string; status: "done" | "continued" | "failed" | "stopped"; state?: ImportState; error?: string };

/** 소스 하나를 시간 예산 안에서 진행한다. 실패는 연속 실패로 세고, 한도에 이르면 자동 동기화를 끈다. */
export async function syncSource(source: DueSource, deadline: number, db: Db = sql): Promise<SyncOutcome> {
  const key = await getTenantApiKeyByTenantId(source.tenant_id);
  try {
    const continuing = (source.sync_state as ImportState | null)?.runner === "cron";
    let state: ImportState;
    if (!continuing) {
      await beginImport(source, db, "cron");
      await audit(db as unknown as AccessDatabase, { userId: null, tenantId: source.tenant_id }, source.customer_id, "db_source.sync", source.id);
    }
    do {
      state = await importStep(source, key, db, true);
    } while (!state.done && Date.now() < deadline);
    return { sourceId: source.id, status: state.done ? "done" : "continued", state };
  } catch (e) {
    const [row] = await db`SELECT consecutive_failures FROM db_sources WHERE id=${source.id}`;
    const error = e instanceof Error ? e.message : "동기화 중 오류";
    if (row && Number(row.consecutive_failures) >= FAILURE_LIMIT) {
      await db`UPDATE db_sources SET enabled=FALSE, last_error=${`${error} · ${STOPPED_MESSAGE}`}, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${source.id}`;
      return { sourceId: source.id, status: "stopped", error };
    }
    return { sourceId: source.id, status: "failed", error };
  }
}

/** cron 진입점. 고른 소스들을 동시에 진행하고 시간 예산이 끝나면 멈춘다(다음 호출이 이어 받는다). */
export async function runScheduledSync(options: { budgetMs?: number; concurrency?: number; db?: Db } = {}) {
  const db = options.db ?? sql;
  const concurrency = Math.max(1, Math.min(10, options.concurrency ?? (Number(process.env.DB_SYNC_CONCURRENCY) || 2)));
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  const due = await dueSources(db, Math.floor(Date.now() / 1000), concurrency);
  const results = await Promise.all(due.map((s) => syncSource(s, deadline, db)));
  return { picked: due.length, results };
}
