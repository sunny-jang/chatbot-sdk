import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { Bot, QaPair } from "@/lib/db";
import { findBestMatch, getEmbedding, cosineSimilarity } from "@/lib/embeddings";
import { getTenantApiKey } from "@/lib/tenantKey";
import OpenAI from "openai";
import { randomUUID } from "crypto";

async function saveLog(botId: string, sessionId: string, userMessage: string, botReply: string) {
  try {
    await sql`
      INSERT INTO chat_logs (id, bot_id, session_id, user_message, bot_reply)
      VALUES (${randomUUID()}, ${botId}, ${sessionId}, ${userMessage}, ${botReply})
    `;
  } catch {
    // non-critical
  }
}

const DOC_THRESHOLD = 0.25;
const DOC_TOP_K = 5;

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
  const { message, history = [], sessionId = randomUUID() } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const [botRows, tenantApiKey] = await Promise.all([
    sql`SELECT * FROM bots WHERE id = ${botId}`,
    getTenantApiKey(botId),
  ]);
  const bot = botRows[0] as unknown as Bot | undefined;
  if (!bot) return NextResponse.json({ error: "Bot not found" }, { status: 404 });

  const openai = new OpenAI({ apiKey: tenantApiKey ?? process.env.OPENAI_API_KEY });

  if (bot.type === "qa") {
    const pairRows = await sql`
      SELECT id, answer, embedding FROM qa_pairs WHERE bot_id = ${botId}
    `;
    const match = await findBestMatch(
      message,
      pairRows as unknown as Pick<QaPair, "id" | "answer" | "embedding">[],
      0.75,
      tenantApiKey
    );
    const reply = match?.answer ?? "죄송합니다. 해당 질문에 대한 답변을 찾지 못했습니다.";
    await saveLog(botId, sessionId, message, reply);
    return NextResponse.json({ reply });
  }

  // AI bot — build messages with optional RAG context
  const queryEmbedding = await getEmbedding(message, tenantApiKey);
  const relevantDocs = await findRelevantDocs(botId, queryEmbedding);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  let systemContent = bot.system_prompt ?? "";
  if (relevantDocs.length > 0) {
    const context = relevantDocs.map((d) => `[${d.title}]\n${d.content}`).join("\n\n---\n\n");
    systemContent = `${systemContent ? systemContent + "\n\n" : ""}다음 참고 문서를 바탕으로 답변하세요:\n\n${context}`;
  }

  if (systemContent) messages.push({ role: "system", content: systemContent });
  for (const h of history) messages.push({ role: h.role, content: h.content });
  messages.push({ role: "user", content: message });

  const completion = await openai.chat.completions.create({
    model: bot.model || "gpt-4o-mini",
    messages,
  });
  const reply = completion.choices[0].message.content ?? "";
  await saveLog(botId, sessionId, message, reply);

  const usedDocs = relevantDocs.map((d) => ({ title: d.title, score: Math.round(d.score * 100) }));
  return NextResponse.json({ reply, usedDocs });
}
