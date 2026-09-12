import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { saveChatMessage, sendSlackMessage, sendTelegramMessage } from "@/lib/support";

export async function POST(req: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  await initSchema();
  const integrations = await sql`SELECT webhook_secret FROM telegram_integrations WHERE bot_id = ${botId} AND enabled = TRUE`;
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!integrations[0] || secret !== integrations[0].webhook_secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const update = await req.json();
  const message = update.message;
  if (!message || message.from?.is_bot || !message.message_thread_id || !message.text) return NextResponse.json({ ok: true });
  const handoffs = await sql`
    SELECT h.session_id, h.status, h.slack_thread_ts FROM support_handoffs h
    WHERE h.bot_id = ${botId} AND h.telegram_topic_id = ${message.message_thread_id}
  `;
  if (!handoffs[0]) return NextResponse.json({ ok: true });
  const sessionId = handoffs[0].session_id as string;
  const agentName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || "상담원";

  if (message.text.trim() === "/close") {
    const now = Math.floor(Date.now() / 1000);
    await sql`UPDATE support_handoffs SET status = 'closed', closed_at = ${now} WHERE session_id = ${sessionId}`;
    await sql`UPDATE chat_sessions SET status = 'closed', closed_at = ${now}, updated_at = ${now} WHERE id = ${sessionId}`;
    await saveChatMessage(sessionId, "system", "상담이 종료되었습니다.", "telegram", agentName, String(message.message_id));
    await sendTelegramMessage(botId, "✅ 상담이 종료되었습니다.", Number(message.message_thread_id)).catch(() => false);
    if (handoffs[0].slack_thread_ts) {
      await sendSlackMessage(botId, "✅ 상담이 종료되었습니다. (Telegram)", handoffs[0].slack_thread_ts as string).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }

  if (handoffs[0].status === "waiting") {
    await sql`UPDATE support_handoffs SET status = 'active', accepted_at = COALESCE(accepted_at, EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE session_id = ${sessionId}`;
    await sql`UPDATE chat_sessions SET status = 'human', assigned_agent_name = ${agentName}, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id = ${sessionId}`;
    await saveChatMessage(sessionId, "system", `${agentName} 상담원이 연결되었습니다.`, "system");
  }
  const saved = await saveChatMessage(sessionId, "agent", message.text, "telegram", agentName, String(message.message_id));
  // 중복 업데이트는 DB 멱등성으로 걸러지므로 미러링도 건너뜁니다.
  if (saved && handoffs[0].slack_thread_ts) {
    await sendSlackMessage(botId, `[Telegram 상담원] ${message.text}`, handoffs[0].slack_thread_ts as string).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}
