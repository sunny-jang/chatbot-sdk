import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { Bot, QaPair } from "@/lib/db";
import { findBestMatch, getEmbedding, cosineSimilarity } from "@/lib/embeddings";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DOC_THRESHOLD = 0.5;
const DOC_TOP_K = 3;

async function findRelevantDocs(
  botId: string,
  queryEmbedding: number[]
): Promise<string[]> {
  const rows = await sql`
    SELECT title, content, embedding FROM documents WHERE bot_id = ${botId}
  `;
  const scored = rows
    .filter((r) => r.embedding)
    .map((r) => ({
      title: r.title as string,
      content: r.content as string,
      score: cosineSimilarity(queryEmbedding, JSON.parse(r.embedding as string)),
    }))
    .filter((r) => r.score >= DOC_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, DOC_TOP_K);

  return scored.map((r) => `[${r.title}]\n${r.content}`);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ botId: string }> }
) {
  const { botId } = await params;
  const { message, history = [] } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const botRows = await sql`SELECT * FROM bots WHERE id = ${botId}`;
  const bot = botRows[0] as unknown as Bot | undefined;
  if (!bot) return NextResponse.json({ error: "Bot not found" }, { status: 404 });

  if (bot.type === "qa") {
    const pairRows = await sql`
      SELECT id, answer, embedding FROM qa_pairs WHERE bot_id = ${botId}
    `;
    const match = await findBestMatch(
      message,
      pairRows as unknown as Pick<QaPair, "id" | "answer" | "embedding">[]
    );
    if (match) return NextResponse.json({ reply: match.answer });
    return NextResponse.json({ reply: "죄송합니다. 해당 질문에 대한 답변을 찾지 못했습니다." });
  }

  // AI bot — build messages with optional RAG context
  const queryEmbedding = await getEmbedding(message);
  const relevantDocs = await findRelevantDocs(botId, queryEmbedding);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  let systemContent = bot.system_prompt ?? "";
  if (relevantDocs.length > 0) {
    const context = relevantDocs.join("\n\n---\n\n");
    systemContent = `${systemContent ? systemContent + "\n\n" : ""}다음 참고 문서를 바탕으로 답변하세요:\n\n${context}`;
  }

  if (systemContent) messages.push({ role: "system", content: systemContent });
  for (const h of history) messages.push({ role: h.role, content: h.content });
  messages.push({ role: "user", content: message });

  const completion = await openai.chat.completions.create({
    model: bot.model || "gpt-4o-mini",
    messages,
  });
  return NextResponse.json({ reply: completion.choices[0].message.content ?? "" });
}
