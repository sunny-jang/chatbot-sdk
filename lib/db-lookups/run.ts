import { randomUUID } from "node:crypto";
import type { AccessDatabase } from "@/lib/access/schema";
import { PortalError } from "@/lib/customer-portal/validation";
import { connectorFor } from "@/lib/data-connections/connectors";
import { credentialsOf, tenantDbRowLimit, type DataConnectionRow } from "@/lib/data-connections/store";
import { LOOKUP_TIMEOUT_MS, LookupTimeoutError } from "@/lib/data-connections/types";
import {
  CACHE_SECONDS,
  CALLS_PER_BOT_MINUTE,
  CALLS_PER_MESSAGE,
  CALLS_PER_SESSION,
  SESSION_WINDOW_S,
  TOO_BROAD_MESSAGE,
  checkLookupArgs,
  formatLookupRows,
  toolDefinition,
  toolName,
  type LookupResult,
  type LookupStatus,
} from "./config";
import { configOf, type DbLookupRow } from "./store";

export const MESSAGES: Record<Exclude<LookupStatus, "ok" | "need_input">, string> = {
  empty: "조건에 맞는 결과가 없어요. 이름을 다시 확인해 달라고 안내하세요.",
  too_broad: TOO_BROAD_MESSAGE,
  too_many_calls: "한 번에 확인할 수 있는 조회 수를 넘었어요. 나머지는 하나씩 다시 물어봐 달라고 안내하세요.",
  rate_limited: "지금은 조회 요청이 많아 잠시 후 다시 물어봐 달라고 안내하세요.",
  timeout: "지금은 실시간 정보를 확인하지 못했어요(시간 초과). 잠시 후 다시 물어봐 달라고 안내하세요.",
  error: "지금은 실시간 정보를 확인하지 못했어요. 잠시 후 다시 물어봐 달라고 안내하세요.",
};

type Ctx = {
  botId: string;
  sessionId: string | null;
  /** 관리 화면의 테스트 실행. 횟수 제한·캐시를 쓰지 않고 실패 사유를 그대로 보여준다. 집계에서 빠진다. */
  test?: boolean;
  timeoutMs?: number;
};
type Lookup = DbLookupRow;

/** 같은 조회·같은 값은 30초 동안 결과를 다시 쓴다(인스턴스별). 설정이 바뀌면(updated_at) 키가 달라진다. */
const cache = new Map<string, { at: number; result: LookupResult }>();
const CACHE_MAX = 500;
export function clearLookupCache() {
  cache.clear();
}

const now = () => Math.floor(Date.now() / 1000);

async function record(db: AccessDatabase, lookupId: string | null, ctx: Ctx, status: LookupStatus, rowCount: number, latencyMs: number, cached = false) {
  try {
    await db`INSERT INTO db_lookup_calls(id,lookup_id,bot_id,session_id,status,row_count,latency_ms,cached,test)
      VALUES(${randomUUID()},${lookupId || null},${ctx.botId},${ctx.sessionId},${status},${rowCount},${Math.round(latencyMs)},${cached},${Boolean(ctx.test)})`;
  } catch {
    // 기록 실패가 답변을 막지 않는다.
  }
}

/** 실행 제한(G6). 대화 하나 10분 10회(모든 시도), 챗봇 하나 1분 60회(고객사 DB에 실제 접속한 것만). */
async function overLimit(db: AccessDatabase, ctx: Ctx, kind: "session" | "bot") {
  const t = now();
  if (kind === "session") {
    if (!ctx.sessionId) return false;
    const [{ n }] = await db`SELECT count(*)::int AS n FROM db_lookup_calls
      WHERE session_id=${ctx.sessionId} AND bot_id=${ctx.botId} AND NOT test AND status <> 'rate_limited' AND created_at > ${t - SESSION_WINDOW_S}`;
    return Number(n) >= CALLS_PER_SESSION;
  }
  const [{ n }] = await db`SELECT count(*)::int AS n FROM db_lookup_calls
    WHERE bot_id=${ctx.botId} AND NOT test AND NOT cached AND status IN ('ok','empty','too_broad','timeout','error') AND created_at > ${t - 60}`;
  return Number(n) >= CALLS_PER_BOT_MINUTE;
}

/**
 * 조회 하나 실행. 순서: 값 검사(G2·G3) → 대화 한도(G6) → 캐시 → 챗봇 한도(G6) → 읽기 전용·5초 제한(G7)으로 최대 결과 수+1행 읽기 → 초과면 too_broad(G4).
 * 실패해도 throw하지 않고 상태를 돌려준다(대화는 계속된다).
 */
export async function runLookup(db: AccessDatabase, lookup: Lookup, args: Record<string, unknown>, ctx: Ctx): Promise<LookupResult> {
  const started = Date.now();
  const done = async (result: LookupResult, rowCount = 0, cached = false) => {
    await record(db, lookup.id, ctx, result.status, rowCount, Date.now() - started, cached);
    return result;
  };
  const check = checkLookupArgs(lookup.params, args ?? {});
  if (!check.ok) return done({ status: check.status, message: check.message, at: now() });
  if (!ctx.test && (await overLimit(db, ctx, "session"))) return done({ status: "rate_limited", message: MESSAGES.rate_limited, at: now() });

  const key = `${lookup.id}:${lookup.updated_at}:${JSON.stringify(check.conditions)}`;
  const hit = ctx.test ? undefined : cache.get(key);
  if (hit && now() - hit.at < CACHE_SECONDS) return done({ ...hit.result, cached: true }, hit.result.rows?.length ?? 0, true);
  if (!ctx.test && (await overLimit(db, ctx, "bot"))) return done({ status: "rate_limited", message: MESSAGES.rate_limited, at: now() });

  const [conn] = await db<DataConnectionRow[]>`SELECT * FROM data_connections WHERE id=${lookup.connection_id} AND status <> 'deleted'`;
  if (!conn) return done({ status: "error", message: ctx.test ? "데이터 연결이 삭제됐어요." : MESSAGES.error, at: now() });

  const timeoutMs = ctx.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  const config = configOf(lookup);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 연결 단계까지 포함한 전체 대기 상한. 질의 자체는 DB 쪽 실행 제한으로도 끊긴다.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LookupTimeoutError()), timeoutMs + 1500);
    });
    const rows = await Promise.race([
      connectorFor(conn.kind).lookup(
        credentialsOf(conn),
        {
          schema: config.schema,
          table: config.table,
          columns: config.outputs.map((o) => o.column),
          filters: config.filters,
          conditions: check.conditions,
          limit: config.maxRows + 1,
        },
        timeoutMs,
      ),
      deadline,
    ]);
    let result: LookupResult;
    if (rows.length > config.maxRows)
      result = { status: "too_broad", message: `조건에 맞는 결과가 ${config.maxRows}건을 넘어요. ${TOO_BROAD_MESSAGE}`, at: now() };
    else if (!rows.length) result = { status: "empty", message: MESSAGES.empty, at: now() };
    else result = { status: "ok", rows: formatLookupRows(rows, config.outputs), at: now() };
    if (!ctx.test && result.status !== "too_broad") {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: result.at, result });
    }
    return done(result, result.status === "ok" ? rows.length : 0);
  } catch (e) {
    if (e instanceof LookupTimeoutError) return done({ status: "timeout", message: MESSAGES.timeout, at: now() });
    const reason = e instanceof PortalError ? e.message : MESSAGES.error;
    return done({ status: "error", message: ctx.test ? reason : MESSAGES.error, at: now() });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 대화에 붙일 조회. 꺼진 조회·삭제된 연결·DB 연동을 쓸 수 없는 요금제면 없다. */
export async function liveLookupsFor(db: AccessDatabase, botId: string, tenantId: string): Promise<Lookup[]> {
  try {
    const rows = await db<Lookup[]>`SELECT l.* FROM db_lookups l JOIN data_connections c ON c.id = l.connection_id
      WHERE l.bot_id=${botId} AND l.enabled AND c.status <> 'deleted' ORDER BY l.created_at, l.id LIMIT 5`;
    if (!rows.length) return [];
    if ((await tenantDbRowLimit(db, tenantId)) <= 0) return [];
    return rows;
  } catch {
    // 표가 아직 없거나 조회에 실패해도 챗봇 답변은 계속된다.
    return [];
  }
}

export const toolsOf = (lookups: Lookup[]) => lookups.map((l, i) => toolDefinition(i, configOf(l)));

export type ToolCall = { id: string; name: string; arguments: string };
export type ToolRun = { id: string; lookup: Lookup | null; result: LookupResult };

/** 모델이 부른 도구들. 앞의 2개만 실행하고(G5) 나머지는 too_many_calls. 모든 호출 id에 결과를 돌려줘야 2차 호출이 성립한다. */
export async function runToolCalls(db: AccessDatabase, lookups: Lookup[], calls: ToolCall[], ctx: Ctx): Promise<ToolRun[]> {
  return Promise.all(
    calls.map(async (call, index): Promise<ToolRun> => {
      const lookup = lookups.find((_, i) => toolName(i) === call.name) ?? null;
      if (!lookup) return { id: call.id, lookup: null, result: { status: "error", message: MESSAGES.error, at: now() } };
      if (index >= CALLS_PER_MESSAGE) {
        await record(db, lookup.id, ctx, "too_many_calls", 0, 0);
        return { id: call.id, lookup, result: { status: "too_many_calls", message: MESSAGES.too_many_calls, at: now() } };
      }
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.arguments || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
      return { id: call.id, lookup, result: await runLookup(db, lookup, args, ctx) };
    }),
  );
}
