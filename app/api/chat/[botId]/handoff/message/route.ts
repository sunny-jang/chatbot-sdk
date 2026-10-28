import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { fanOutToSupportChannels, saveChatMessage } from "@/lib/support";
import { withWidgetCors } from "@/lib/widget-origin";

// 위젯이 상담 중에 보내는 메시지. 다른 위젯 API처럼 등록된 홈페이지 출처만 허용하고 CORS 헤더를 붙인다.
// (빠져 있으면 고객 홈페이지에서 응답을 읽지 못해 전송은 됐는데도 "전송 실패"가 뜬다.)
async function POSTHandler(req: Request, { params }: { params: Promise<{ botId: string }> }) {
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

export const POST = withWidgetCors(POSTHandler);
