import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { getSlackIntegration, saveChatMessage, sendSlackMessage, sendTelegramMessage, slackCall, verifySlackSignature } from "@/lib/support";

type SlackEvent = {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  await initSchema();
  // 서명 검증에는 원문이 필요하므로 JSON parse 전에 raw body를 읽습니다.
  const rawBody = await req.text();
  const integration = await getSlackIntegration(botId);
  if (!integration) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const valid = verifySlackSignature(
    integration.secret,
    rawBody,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
  );
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: { type?: string; challenge?: string; event?: SlackEvent };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (payload.type === "url_verification") return NextResponse.json({ challenge: payload.challenge });

  const event = payload.event;
  if (!event || event.type !== "message" || event.bot_id || event.subtype || !event.text?.trim() || !event.channel || !event.ts) {
    return NextResponse.json({ ok: true });
  }
  const threadTs = event.thread_ts || event.ts;
  const handoffs = await sql`
    SELECT session_id, status, telegram_topic_id FROM support_handoffs
    WHERE bot_id = ${botId} AND slack_channel_id = ${event.channel} AND slack_thread_ts = ${threadTs}
  `;
  if (!handoffs[0]) return NextResponse.json({ ok: true });
  const sessionId = handoffs[0].session_id as string;
  const telegramTopicId = handoffs[0].telegram_topic_id as number | null;
  const externalId = `${event.channel}:${event.ts}`;
  const text = event.text.trim();

  // users:read 스코프가 없으면 조회에 실패하므로 기본 표기로 대체합니다.
  let agentName = "Slack 상담원";
  if (event.user) {
    const info = await slackCall(integration.token, "users.info", { user: event.user }).catch(() => null) as
      | { user?: { profile?: { display_name?: string; real_name?: string } } }
      | null;
    agentName = info?.user?.profile?.display_name || info?.user?.profile?.real_name || agentName;
  }

  if (text === "/close") {
    const now = Math.floor(Date.now() / 1000);
    await sql`UPDATE support_handoffs SET status = 'closed', closed_at = ${now} WHERE session_id = ${sessionId}`;
    await sql`UPDATE chat_sessions SET status = 'closed', closed_at = ${now}, updated_at = ${now} WHERE id = ${sessionId}`;
    await saveChatMessage(sessionId, "system", "상담이 종료되었습니다.", "slack", agentName, externalId);
    await sendSlackMessage(botId, "✅ 상담이 종료되었습니다.", threadTs).catch(() => null);
    if (telegramTopicId) await sendTelegramMessage(botId, "✅ 상담이 종료되었습니다. (Slack)", Number(telegramTopicId)).catch(() => false);
    return NextResponse.json({ ok: true });
  }

  if (handoffs[0].status === "waiting") {
    await sql`UPDATE support_handoffs SET status = 'active', accepted_at = COALESCE(accepted_at, EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE session_id = ${sessionId}`;
    await sql`UPDATE chat_sessions SET status = 'human', assigned_agent_name = ${agentName}, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id = ${sessionId}`;
    await saveChatMessage(sessionId, "system", `${agentName}이 연결되었습니다.`, "system");
  }
  const saved = await saveChatMessage(sessionId, "agent", text, "slack", agentName, externalId);
  // 이미 처리한 중복 이벤트는 DB 멱등성으로 걸러지므로 미러링도 건너뜁니다.
  if (saved && telegramTopicId) {
    await sendTelegramMessage(botId, `[Slack 상담원] ${text}`, Number(telegramTopicId)).catch(() => false);
  }
  return NextResponse.json({ ok: true });
}
