import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { findBestMatch } from "@/lib/embeddings";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ botId: string }> }
) {
  const { botId } = await params;
  const { message, history = [] } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const db = getDb();
  const bot = db.prepare("SELECT * FROM bots WHERE id = ?").get(botId) as {
    id: string; name: string; type: string; system_prompt: string | null; model: string;
  } | undefined;

  if (!bot) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  if (bot.type === "qa") {
    const pairs = db
      .prepare("SELECT id, answer, embedding FROM qa_pairs WHERE bot_id = ?")
      .all(botId) as { id: string; answer: string; embedding: string | null }[];

    const match = await findBestMatch(message, pairs);

    if (match) {
      return NextResponse.json({ reply: match.answer });
    }

    return NextResponse.json({
      reply: "죄송합니다. 해당 질문에 대한 답변을 찾지 못했습니다.",
    });
  }

  // AI 챗봇
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (bot.system_prompt) {
    messages.push({ role: "system", content: bot.system_prompt });
  }

  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: message });

  const completion = await openai.chat.completions.create({
    model: bot.model || "gpt-4o-mini",
    messages,
  });

  const reply = completion.choices[0].message.content ?? "";
  return NextResponse.json({ reply });
}
