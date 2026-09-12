import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { fanOutToSupportChannels, saveChatMessage } from "@/lib/support";

export async function POST(req: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const { sessionId, message } = await req.json();
  if (!sessionId || !message?.trim()) return NextResponse.json({ error: "sessionId and message are required" }, { status: 400 });
  await initSchema();
  const bots = await sql`SELECT public_token FROM bots WHERE id = ${botId}`;
  if (!bots[0]?.public_token || req.headers.get("x-bot-token") !== bots[0].public_token) return NextResponse.json({ error: "Invalid bot token" }, { status: 401 });
  const rows = await sql`SELECT status, telegram_topic_id, slack_thread_ts FROM support_handoffs WHERE session_id = ${sessionId} AND bot_id = ${botId}`;
  if (!rows[0] || rows[0].status === "closed") return NextResponse.json({ error: "활성 상담을 찾을 수 없습니다." }, { status: 404 });
  const saved = await saveChatMessage(sessionId, "customer", message.trim());
  await fanOutToSupportChannels(botId, {
    telegram_topic_id: rows[0].telegram_topic_id as number | null,
    slack_thread_ts: rows[0].slack_thread_ts as string | null,
  }, `고객: ${message.trim()}`);
  return NextResponse.json({ ok: true, message: saved });
}
