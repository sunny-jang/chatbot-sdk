import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import { audit, type DbSourceRow } from "./store";
import { PortalError } from "@/lib/customer-portal/validation";
import { beginImport, importStep, LOCK_TTL, type ImportState } from "./import";

export const FAILURE_LIMIT = 3;
export const STOPPED_MESSAGE = "연속 3회 실패로 자동 동기화를 멈췄어요. 연결을 확인한 뒤 다시 켜주세요.";
/** 이전 cron 호출이 시간 안에 못 끝낸 실행은 이 시간(초) 동안 하트비트가 없으면 이어 받는다. */
const CONTINUE_AFTER = 30;
type Db = typeof sql;
type DueSource = DbSourceRow & { customer_id: string; tenant_id: string };

/**
 * 예정 시각이 지난 소스와, 지난 cron 호출이 끝내지 못한 cron 실행(잠금 나이와 무관하게 이어 받음)을 고른다.
 * 화면에서 진행 중인 실행(잠금 유효)은 건드리지 않는다. 고객사별 대기열로 돌려준다(고객사 안에서는 하나씩 차례로).
 */
export async function dueSources(db: Db = sql, now = Math.floor(Date.now() / 1000), limit = 200): Promise<DueSource[][]> {
  const rows = await db<DueSource[]>`
    SELECT s.*, b.customer_id, b.tenant_id FROM db_sources s
    JOIN bots b ON b.id=s.bot_id
    JOIN data_connections c ON c.id=s.connection_id AND c.status<>'deleted'
    WHERE s.enabled AND b.customer_id IS NOT NULL AND (
      (s.sync_state->>'runner'='cron' AND s.sync_locked_at IS NOT NULL AND s.sync_locked_at < ${now - CONTINUE_AFTER})
      OR (s.next_sync_at IS NOT NULL AND s.next_sync_at <= ${now} AND (s.sync_locked_at IS NULL OR s.sync_locked_at < ${now - LOCK_TTL}))
    )
    ORDER BY (s.sync_state->>'runner'='cron') DESC NULLS LAST, s.next_sync_at NULLS FIRST, s.id LIMIT ${limit}`;
  const queues = new Map<string, DueSource[]>();
  for (const r of rows) {
    const q = queues.get(r.customer_id) ?? [];
    q.push(r);
    queues.set(r.customer_id, q);
  }
  // 가장 오래 기다린 고객사부터. 한 고객사의 밀린 소스가 다른 고객사를 막지 않는다.
  return [...queues.values()];
}

/** 이어 받을 cron 실행을 원자적으로 가져온다. 겹친 호출이 같은 실행을 동시에 진행하지 않게. */
export async function claimContinuation(source: DueSource, db: Db = sql): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const [row] = await db`UPDATE db_sources SET sync_locked_at=${now}
    WHERE id=${source.id} AND sync_state->>'runner'='cron' AND sync_locked_at=${source.sync_locked_at} RETURNING id`;
  return Boolean(row);
}

export type SyncOutcome = { sourceId: string; status: "done" | "continued" | "failed" | "stopped" | "skipped"; state?: ImportState; error?: string };

/** 소스 하나를 시간 예산 안에서 진행한다. 실패는 연속 실패로 세고, 한도에 이르면 자동 동기화를 끈다. */
export async function syncSource(source: DueSource, deadline: number, db: Db = sql): Promise<SyncOutcome> {
  const key = await getTenantApiKeyByTenantId(source.tenant_id);
  const continuing = (source.sync_state as ImportState | null)?.runner === "cron";
  try {
    if (continuing) {
      if (!(await claimContinuation(source, db))) return { sourceId: source.id, status: "skipped" };
    } else {
      try {
        await beginImport(source, db, "cron");
      } catch (e) {
        // 그 사이 화면에서 가져오기를 시작했으면 실패가 아니라 이번 차례를 건너뛴다.
        if (e instanceof PortalError && e.status === 409) return { sourceId: source.id, status: "skipped" };
        throw e;
      }
      await audit(db as unknown as AccessDatabase, { userId: null, tenantId: source.tenant_id }, source.customer_id, "db_source.sync", source.id);
    }
    let state: ImportState;
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

/**
 * cron 진입점. 고객사 대기열을 concurrency개 일꾼이 나눠 맡아, 고객사 안에서는 하나씩 차례로 시간 예산이 끝날 때까지 진행한다.
 * 다 못 한 실행은 다음 호출이 이어 받는다.
 */
export async function runScheduledSync(options: { budgetMs?: number; concurrency?: number; db?: Db } = {}) {
  const db = options.db ?? sql;
  const concurrency = Math.max(1, Math.min(10, options.concurrency ?? (Number(process.env.DB_SYNC_CONCURRENCY) || 2)));
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  const queues = await dueSources(db, Math.floor(Date.now() / 1000));
  const results: SyncOutcome[] = [];
  let next = 0;
  const worker = async () => {
    while (Date.now() < deadline && next < queues.length) {
      const queue = queues[next++];
      for (const source of queue) {
        if (Date.now() >= deadline) break;
        const out = await syncSource(source, deadline, db);
        results.push(out);
        if (out.status === "continued") break; // 시간이 다 됐다
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queues.length) }, worker));
  return { picked: queues.reduce((n, q) => n + q.length, 0), results };
}
