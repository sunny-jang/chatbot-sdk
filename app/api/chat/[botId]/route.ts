import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { Bot, QaPair, initSchema } from "@/lib/db";
import { findBestMatch, getEmbedding, cosineSimilarity } from "@/lib/embeddings";
import { getTenantApiKey } from "@/lib/tenantKey";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { classifyIntent, detectRefusal, estimateOpenAICost } from "@/lib/analytics";
import { getMonthlySessionLimit, normalizePlan, PLAN_CONFIG } from "@/lib/plans";
import { reserveMonthlySession } from "@/lib/monthlyUsage";

type AnalyticsLog = {
  intent: string;
  refused: boolean;
  refusalReason: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  apiSuccess: boolean;
  estimatedCostUsd: number | null;
  toolName: string | null;
  toolSuccess: boolean | null;
};

async function saveLog(
  botId: string,
  sessionId: string,
  userMessage: string,
  botReply: string,
  analytics: AnalyticsLog
) {
  try {
    await sql`
      INSERT INTO chat_logs (
        id, bot_id, session_id, user_message, bot_reply, intent, refused,
        refusal_reason, model, input_tokens, output_tokens, latency_ms,
        api_success, estimated_cost_usd, tool_name, tool_success
      )
      VALUES (
        ${randomUUID()}, ${botId}, ${sessionId}, ${userMessage}, ${botReply},
        ${analytics.intent}, ${analytics.refused}, ${analytics.refusalReason},
        ${analytics.model}, ${analytics.inputTokens}, ${analytics.outputTokens},
        ${analytics.latencyMs}, ${analytics.apiSuccess}, ${analytics.estimatedCostUsd},
        ${analytics.toolName}, ${analytics.toolSuccess}
      )
    `;
  } catch {
    // non-critical
  }
}

const DOC_THRESHOLD = 0.25;
const DOC_TOP_K = 5;
const DOC_CONTEXT_MAX_CHARS = 24_000;

function buildDocumentContext(docs: { title: string; content: string }[]) {
  let remaining = DOC_CONTEXT_MAX_CHARS;
  const sections: string[] = [];
  for (const doc of docs) {
    if (remaining <= 0) break;
    const header = `[${doc.title}]\n`;
    const allowance = Math.max(0, remaining - header.length);
    const content = doc.content.slice(0, allowance);
    sections.push(`${header}${content}${content.length < doc.content.length ? "\n[문서 일부만 포함됨]" : ""}`);
    remaining -= header.length + content.length;
  }
  return sections.join("\n\n---\n\n");
}

async function findRelevantDocs(
  botId: string,
  queryEmbedding: number[]
): Promise<{ title: string; content: string; score: number }[]> {
  // Step 1: fetch only id + embedding (skip heavy content field)
  const rows = await sql`
    SELECT id, title, embedding FROM documents WHERE bot_id = ${botId} AND embedding IS NOT NULL
  `;
  const scored = rows
    .map((r) => ({
      id: r.id as string,
      title: r.title as string,
      score: cosineSimilarity(queryEmbedding, JSON.parse(r.embedding as string)),
    }))
    .filter((r) => r.score >= DOC_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, DOC_TOP_K);

  if (scored.length === 0) return [];

  // Step 2: fetch content only for matched docs
  const ids = scored.map((r) => r.id);
  const contentRows = await sql`
    SELECT id, content FROM documents WHERE id = ANY(${ids}::text[])
  `;
  const contentMap = new Map(contentRows.map((r) => [r.id as string, r.content as string]));

  return scored.map((r) => ({ title: r.title, content: contentMap.get(r.id) ?? "", score: r.score }));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ botId: string }> }
) {
  const { botId } = await params;
  const body = await req.json();
  const message = body.message;
  const history = Array.isArray(body.history) ? body.history : [];
  const sessionId = typeof body.sessionId === "string" && body.sessionId.trim()
    ? body.sessionId.trim().slice(0, 200)
    : randomUUID();
  const startedAt = Date.now();

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  await initSchema();
  const [botRows, tenantApiKey] = await Promise.all([
    sql`SELECT * FROM bots WHERE id = ${botId}`,
    getTenantApiKey(botId),
  ]);
  const bot = botRows[0] as unknown as Bot | undefined;
  if (!bot) return NextResponse.json({ error: "Bot not found" }, { status: 404 });

  const tenantRows = await sql`
    SELECT plan, subscription_status, enterprise_monthly_session_limit
    FROM tenants WHERE id = ${bot.tenant_id}
  `;
  const tenant = tenantRows[0] as {
    plan?: string;
    subscription_status?: string;
    enterprise_monthly_session_limit?: number | null;
  } | undefined;
  if (!tenant) return NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
  if (tenant.subscription_status !== "active") {
    const error = "현재 구독이 중지되어 챗봇을 이용할 수 없습니다. 관리자에게 문의해주세요.";
    return NextResponse.json({ error, reply: error, code: "SUBSCRIPTION_INACTIVE" }, { status: 403 });
  }

  const plan = normalizePlan(tenant.plan);
  const monthlyLimit = getMonthlySessionLimit(plan, tenant.enterprise_monthly_session_limit);
  if (monthlyLimit === null) {
    const error = "월 대화 세션 한도가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.";
    return NextResponse.json({ error, reply: error, code: "MONTHLY_SESSION_LIMIT_NOT_SET" }, { status: 409 });
  }
  const reservation = await reserveMonthlySession(bot.tenant_id, botId, sessionId, monthlyLimit);
  if (!reservation.allowed) {
    const error = `${PLAN_CONFIG[plan].name} 플랜의 이번 달 대화 세션 ${monthlyLimit.toLocaleString("ko-KR")}건을 모두 사용했습니다.`;
    return NextResponse.json({
      error,
      reply: `${error} 다음 달에 다시 이용하거나 플랜 업그레이드를 문의해주세요.`,
      code: "MONTHLY_SESSION_LIMIT_REACHED",
      usage: reservation.usage,
    }, { status: 429 });
  }

  const openai = new OpenAI({ apiKey: tenantApiKey ?? process.env.OPENAI_API_KEY });

  if (bot.type === "qa") {
    const pairRows = await sql`
      SELECT id, answer, embedding FROM qa_pairs WHERE bot_id = ${botId}
    `;
    let match;
    try {
      match = await findBestMatch(
        message,
        pairRows as unknown as Pick<QaPair, "id" | "answer" | "embedding">[],
        0.75,
        tenantApiKey
      );
    } catch {
      await saveLog(botId, sessionId, message, "요청 처리 중 오류가 발생했습니다.", {
        intent: classifyIntent(message), refused: false, refusalReason: null,
        model: "qa-match", inputTokens: null, outputTokens: null,
        latencyMs: Date.now() - startedAt, apiSuccess: false, estimatedCostUsd: null,
        toolName: "Q&A 검색", toolSuccess: false,
      });
      return NextResponse.json({ error: "답변을 생성하지 못했습니다." }, { status: 500 });
    }
    const reply = match?.answer ?? "죄송합니다. 해당 질문에 대한 답변을 찾지 못했습니다.";
    const refusal = detectRefusal(reply);
    await saveLog(botId, sessionId, message, reply, {
      intent: classifyIntent(message),
      refused: refusal.refused,
      refusalReason: refusal.reason,
      model: "qa-match",
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - startedAt,
      apiSuccess: true,
      estimatedCostUsd: null,
      toolName: "Q&A 검색",
      toolSuccess: Boolean(match),
    });
    return NextResponse.json({ reply, usage: reservation.usage });
  }

  // AI bot — build messages with optional RAG context
  const queryEmbedding = await getEmbedding(message, tenantApiKey);
  const relevantDocs = await findRelevantDocs(botId, queryEmbedding);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  let systemContent = bot.system_prompt ?? "";
  if (relevantDocs.length > 0) {
    const context = buildDocumentContext(relevantDocs);
    systemContent = `${systemContent ? systemContent + "\n\n" : ""}다음 참고 문서를 바탕으로 답변하세요:\n\n${context}`;
  }

  if (systemContent) messages.push({ role: "system", content: systemContent });
  for (const h of history) messages.push({ role: h.role, content: h.content });
  messages.push({ role: "user", content: message });

  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: bot.model || "gpt-4o-mini",
      messages,
    });
  } catch {
    await saveLog(botId, sessionId, message, "요청 처리 중 오류가 발생했습니다.", {
      intent: classifyIntent(message), refused: false, refusalReason: null,
      model: bot.model || "gpt-4o-mini", inputTokens: null, outputTokens: null,
      latencyMs: Date.now() - startedAt, apiSuccess: false, estimatedCostUsd: null,
      toolName: relevantDocs.length > 0 ? "문서 검색(RAG)" : null,
      toolSuccess: relevantDocs.length > 0 ? false : null,
    });
    return NextResponse.json({ error: "답변을 생성하지 못했습니다." }, { status: 500 });
  }
  const reply = completion.choices[0].message.content ?? "";
  const explicitRefusal = completion.choices[0].message.refusal;
  const refusal = detectRefusal(reply, explicitRefusal);
  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const model = completion.model || bot.model || "gpt-4o-mini";
  await saveLog(botId, sessionId, message, reply, {
    intent: classifyIntent(message),
    refused: refusal.refused,
    refusalReason: refusal.reason,
    model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - startedAt,
    apiSuccess: true,
    estimatedCostUsd: estimateOpenAICost(model, inputTokens, outputTokens),
    toolName: relevantDocs.length > 0 ? "문서 검색(RAG)" : null,
    toolSuccess: relevantDocs.length > 0 ? true : null,
  });

  const usedDocs = relevantDocs.map((d) => ({ title: d.title, score: Math.round(d.score * 100) }));
  return NextResponse.json({ reply, usedDocs, usage: reservation.usage });
}
