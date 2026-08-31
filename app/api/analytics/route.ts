import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { classifyIntent, detectRefusal } from "@/lib/analytics";

type AnalyticsRow = {
  id: string;
  bot_id: string;
  bot_name: string;
  session_id: string;
  user_message: string;
  bot_reply: string;
  created_at: number | string;
  intent: string | null;
  refused: boolean | null;
  refusal_reason: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  api_success: boolean | null;
  estimated_cost_usd: number | null;
  tool_name: string | null;
  tool_success: boolean | null;
};

const round = (value: number, digits = 1) => Number(value.toFixed(digits));

export async function GET(req: Request) {
  const jar = await cookies();
  const tenantId = jar.get("tenant_id")?.value;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initSchema();

  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 365);
  const botId = url.searchParams.get("botId");
  const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

  const [botRows, logRows] = await Promise.all([
    sql`SELECT id, name FROM bots WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`,
    botId && botId !== "all"
      ? sql`
          SELECT l.*, b.name AS bot_name
          FROM chat_logs l
          JOIN bots b ON b.id = l.bot_id
          WHERE b.tenant_id = ${tenantId} AND b.id = ${botId} AND l.created_at >= ${since}
          ORDER BY l.created_at DESC
          LIMIT 10000
        `
      : sql`
          SELECT l.*, b.name AS bot_name
          FROM chat_logs l
          JOIN bots b ON b.id = l.bot_id
          WHERE b.tenant_id = ${tenantId} AND l.created_at >= ${since}
          ORDER BY l.created_at DESC
          LIMIT 10000
        `,
  ]);

  const logs = (logRows as unknown as AnalyticsRow[]).map((row) => {
    const refusal = row.refused === null ? detectRefusal(row.bot_reply) : {
      refused: row.refused,
      reason: row.refusal_reason,
    };
    return {
      ...row,
      created_at: Number(row.created_at),
      // 현재 B2B/제조업 분류 체계로 과거 로그까지 일관되게 재분류합니다.
      intent: classifyIntent(row.user_message),
      refused: refusal.refused,
      refusal_reason: refusal.reason,
    };
  });

  const sessionKey = (log: typeof logs[number]) =>
    log.session_id === "legacy" || !log.session_id
      ? `${log.bot_id}:legacy:${log.id}`
      : `${log.bot_id}:${log.session_id}`;
  const sessions = new Set(logs.map(sessionKey));
  const refused = logs.filter((log) => log.refused);
  const measuredApi = logs.filter((log) => log.api_success !== null);
  const measuredLatency = logs.filter((log) => log.latency_ms !== null);
  const measuredTokens = logs.filter((log) => log.input_tokens !== null || log.output_tokens !== null);
  const toolLogs = logs.filter((log) => log.tool_name);

  const intentMap = new Map<string, number>();
  const refusalMap = new Map<string, number>();
  const toolMap = new Map<string, { calls: number; success: number; latency: number[] }>();
  const dailyMap = new Map<string, { messages: number; sessions: Set<string>; refusals: number }>();

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
    dailyMap.set(date, { messages: 0, sessions: new Set(), refusals: 0 });
  }

  for (const log of logs) {
    intentMap.set(log.intent, (intentMap.get(log.intent) ?? 0) + 1);
    if (log.refused) {
      const reason = log.refusal_reason || "기타";
      refusalMap.set(reason, (refusalMap.get(reason) ?? 0) + 1);
    }
    if (log.tool_name) {
      const current = toolMap.get(log.tool_name) ?? { calls: 0, success: 0, latency: [] };
      current.calls += 1;
      if (log.tool_success) current.success += 1;
      if (log.latency_ms !== null) current.latency.push(log.latency_ms);
      toolMap.set(log.tool_name, current);
    }
    const day = new Date(log.created_at * 1000).toISOString().slice(0, 10);
    const daily = dailyMap.get(day);
    if (daily) {
      daily.messages += 1;
      daily.sessions.add(sessionKey(log));
      if (log.refused) daily.refusals += 1;
    }
  }

  const intents = [...intentMap.entries()]
    .map(([name, count]) => ({ name, count, share: logs.length ? round((count / logs.length) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  const refusalReasons = [...refusalMap.entries()]
    .map(([name, count]) => ({ name, count, share: refused.length ? round((count / refused.length) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  const tools = [...toolMap.entries()].map(([name, value]) => ({
    name,
    calls: value.calls,
    successRate: value.calls ? round((value.success / value.calls) * 100) : null,
    averageLatencyMs: value.latency.length ? Math.round(value.latency.reduce((a, b) => a + b, 0) / value.latency.length) : null,
  })).sort((a, b) => b.calls - a.calls);

  const inputTokens = measuredTokens.reduce((sum, log) => sum + (log.input_tokens ?? 0), 0);
  const outputTokens = measuredTokens.reduce((sum, log) => sum + (log.output_tokens ?? 0), 0);
  const totalCost = logs.reduce((sum, log) => sum + Number(log.estimated_cost_usd ?? 0), 0);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    periodDays: days,
    bots: botRows.map((row) => ({ id: row.id as string, name: row.name as string })),
    coverage: {
      logs: logs.length,
      api: measuredApi.length,
      latency: measuredLatency.length,
      tokens: measuredTokens.length,
      tools: toolLogs.length,
    },
    summary: {
      messages: logs.length,
      conversations: sessions.size,
      activeSessions: sessions.size,
      responseRate: logs.length ? round(((logs.length - refused.length) / logs.length) * 100) : null,
      refusalRate: logs.length ? round((refused.length / logs.length) * 100) : null,
      apiSuccessRate: measuredApi.length ? round((measuredApi.filter((log) => log.api_success).length / measuredApi.length) * 100) : null,
      averageLatencyMs: measuredLatency.length ? Math.round(measuredLatency.reduce((sum, log) => sum + (log.latency_ms ?? 0), 0) / measuredLatency.length) : null,
      inputTokens,
      outputTokens,
      estimatedCostUsd: measuredTokens.length ? totalCost : null,
    },
    daily: [...dailyMap.entries()].map(([date, value]) => ({ date, messages: value.messages, conversations: value.sessions.size, refusals: value.refusals })),
    intents,
    refusalReasons,
    tools,
    conversations: logs.slice(0, 100).map((log) => ({
      id: log.id,
      botId: log.bot_id,
      botName: log.bot_name,
      sessionId: log.session_id,
      userMessage: log.user_message,
      botReply: log.bot_reply,
      createdAt: log.created_at,
      intent: log.intent,
      refused: log.refused,
      refusalReason: log.refusal_reason,
      model: log.model,
      inputTokens: log.input_tokens,
      outputTokens: log.output_tokens,
      latencyMs: log.latency_ms,
      apiSuccess: log.api_success,
      costUsd: log.estimated_cost_usd,
      toolName: log.tool_name,
    })),
  });
}
