import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { enforceRateLimit, ensureChatSession, getSlackIntegration, getTelegramIntegration, saveChatMessage, slackCall, telegramCall } from "@/lib/support";
import { getMonthlySessionLimit, normalizePlan } from "@/lib/plans";
import { reserveMonthlySession } from "@/lib/monthlyUsage";
import { getSupportStatus } from "@/lib/supportHours";

export async function POST(req: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const { sessionId, reason, customerName, message } = await req.json();
  if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  await initSchema();
  const botRows = await sql`
    SELECT b.id, b.tenant_id, b.name, b.support_mode, b.support_channel, b.support_hours, b.force_unattended, b.public_token,
           t.plan, t.subscription_status, t.enterprise_monthly_session_limit
    FROM bots b JOIN tenants t ON t.id = b.tenant_id WHERE b.id = ${botId}
  `;
  const bot = botRows[0] as { id:string; tenant_id:string; name:string; support_mode:string; support_channel:string|null; support_hours:unknown; force_unattended:boolean|null; public_token:string|null; plan:string; subscription_status:string; enterprise_monthly_session_limit:number|null } | undefined;
  if (!bot) return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  if (!bot.public_token || req.headers.get("x-bot-token") !== bot.public_token) return NextResponse.json({ error: "Invalid bot token" }, { status: 401 });
  if (!(await enforceRateLimit(botId, req, 20))) return NextResponse.json({ error: "요청이 너무 많습니다." }, { status: 429 });
  if (bot.support_mode !== "hybrid") return NextResponse.json({ error: "이 챗봇은 24시간 무인 상담 모드입니다.", code: "UNATTENDED_MODE" }, { status: 409 });
  if (bot.subscription_status !== "active") return NextResponse.json({ error: "구독이 비활성 상태입니다." }, { status: 403 });
  const monthlyLimit = getMonthlySessionLimit(normalizePlan(bot.plan), bot.enterprise_monthly_session_limit);
  if (monthlyLimit === null) return NextResponse.json({ error: "월 대화 세션 한도가 설정되지 않았습니다." }, { status: 409 });
  const reservation = await reserveMonthlySession(bot.tenant_id, botId, sessionId, monthlyLimit);
  if (!reservation.allowed) return NextResponse.json({ error: "이번 달 대화 세션 한도를 모두 사용했습니다.", code: "MONTHLY_SESSION_LIMIT_REACHED", usage: reservation.usage }, { status: 429 });

  await ensureChatSession(sessionId, bot.tenant_id, botId, customerName);
  if (message) await saveChatMessage(sessionId, "customer", message);
  const existing = await sql`SELECT * FROM support_handoffs WHERE session_id = ${sessionId}`;
  if (existing[0] && existing[0].status !== "closed") {
    return NextResponse.json({
      ok: true,
      handoff: existing[0],
      telegramConnected: Boolean(existing[0].telegram_topic_id),
      slackConnected: Boolean(existing[0].slack_thread_ts),
    });
  }

  // 이미 진행 중인 상담은 위에서 이어가고, 새 상담 요청만 강제 무인 운영·운영 시간을 확인합니다.
  const supportStatus = getSupportStatus(bot);
  if (!supportStatus.live) {
    const forced = supportStatus.reason === "forced";
    return NextResponse.json({
      error: forced
        ? "지금은 상담원 연결이 어렵습니다. 챗봇 상담을 이용해주세요."
        : `지금은 상담원 연결 가능 시간이 아닙니다.${supportStatus.hoursText ? ` 상담 가능 시간: ${supportStatus.hoursText}` : ""}`,
      code: forced ? "FORCED_UNATTENDED" : "OUTSIDE_SUPPORT_HOURS",
      supportHoursText: supportStatus.hoursText,
    }, { status: 409 });
  }

  const handoffId = randomUUID();
  let topicId: number | null = null;
  let telegramChatId: string | null = null;
  // 상담원 연결 채널은 하나만 사용합니다. 이후 메시지·종료 알림은 상담 건에 저장된 채널 정보로만 전달됩니다.
  const channel = bot.support_channel === "telegram" || bot.support_channel === "slack" ? bot.support_channel : "inbox";
  const integration = channel === "telegram" ? await getTelegramIntegration(botId) : null;
  if (integration) {
    try {
      const topic = await telegramCall(integration.token, "createForumTopic", {
        chat_id: integration.chat_id,
        name: `[대기] ${customerName || "고객"} · ${sessionId.slice(0, 8)}`.slice(0, 128),
      }) as { message_thread_id: number };
      topicId = topic.message_thread_id;
      telegramChatId = integration.chat_id;
    } catch (error) {
      // Telegram 연결 실패 시에도 로컬 상담 대기열에는 정상 접수합니다. 원인 파악을 위해 에러 내용만 로그로 남깁니다.
      console.error(`[handoff] Telegram 주제 생성 실패 (bot ${botId}):`, error instanceof Error ? error.message : error);
    }
  }

  let slackChannelId: string | null = null;
  let slackThreadTs: string | null = null;
  const slack = channel === "slack" ? await getSlackIntegration(botId) : null;

  const rows = await sql`
    INSERT INTO support_handoffs (id, session_id, bot_id, telegram_chat_id, telegram_topic_id, status, reason)
    VALUES (${handoffId}, ${sessionId}, ${botId}, ${telegramChatId}, ${topicId}, 'waiting', ${reason || "고객 요청"})
    RETURNING *
  `;
  await sql`UPDATE chat_sessions SET status = 'waiting', customer_name = COALESCE(${customerName || null}, customer_name) WHERE id = ${sessionId}`;
  await saveChatMessage(sessionId, "system", "상담원 연결이 요청되었습니다.", "system");

  let transcript = "";
  if ((integration && topicId) || slack) {
    const history = await sql`SELECT sender_type, content FROM chat_messages WHERE session_id = ${sessionId} ORDER BY created_at ASC LIMIT 30`;
    transcript = history.map((item) => `${item.sender_type === "customer" ? "고객" : item.sender_type === "agent" ? "상담원" : "챗봇"}: ${item.content}`).join("\n");
  }

  if (integration && topicId) {
    await telegramCall(integration.token, "sendMessage", {
      chat_id: integration.chat_id,
      message_thread_id: topicId,
      text: `🆕 상담 요청\n챗봇: ${bot.name}\n세션: ${sessionId}\n사유: ${reason || "고객 요청"}\n\n${transcript || "이전 대화 없음"}\n\n이 Topic에 답변하면 고객 웹챗으로 전달됩니다. 상담 종료: /close`,
    }).catch(() => null);
  }

  if (slack) {
    // Slack API 실패가 자체 대기열/Telegram 접수를 막지 않도록 개별 처리합니다.
    try {
      const posted = await slackCall(slack.token, "chat.postMessage", {
        channel: slack.channel_id,
        text: `🆕 상담 요청\n챗봇: ${bot.name}\n고객: ${customerName || "고객"}\n세션: ${sessionId}\n사유: ${reason || "고객 요청"}\n\n${transcript || "이전 대화 없음"}\n\n이 스레드에 답변하면 고객 웹챗으로 전달됩니다. 상담 종료: /close`.slice(0, 40000),
      }) as { channel?: string; ts?: string };
      if (posted.ts) {
        slackChannelId = posted.channel || slack.channel_id;
        slackThreadTs = posted.ts;
        await sql`UPDATE support_handoffs SET slack_channel_id = ${slackChannelId}, slack_thread_ts = ${slackThreadTs} WHERE id = ${handoffId}`;
      }
    } catch (error) {
      // Slack 연결 실패 시에도 로컬 상담 대기열에는 정상 접수합니다. 원인 파악을 위해 에러 내용만 로그로 남깁니다.
      console.error(`[handoff] Slack 스레드 생성 실패 (bot ${botId}):`, error instanceof Error ? error.message : error);
    }
  }

  return NextResponse.json({
    ok: true,
    handoff: { ...rows[0], slack_channel_id: slackChannelId, slack_thread_ts: slackThreadTs },
    channel,
    telegramConnected: Boolean(topicId),
    slackConnected: Boolean(slackThreadTs),
  }, { status: 201 });
}

export async function GET(req: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const after = Number(url.searchParams.get("after") || 0);
  if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  await initSchema();
  const bots = await sql`SELECT public_token FROM bots WHERE id = ${botId}`;
  if (!bots[0]?.public_token || req.headers.get("x-bot-token") !== bots[0].public_token) return NextResponse.json({ error: "Invalid bot token" }, { status: 401 });
  const sessions = await sql`SELECT status, assigned_agent_name FROM chat_sessions WHERE id = ${sessionId} AND bot_id = ${botId}`;
  if (!sessions[0]) return NextResponse.json({ status: "bot", messages: [] });
  const messages = await sql`
    SELECT id, sender_type, sender_name, content, source, created_at
    FROM chat_messages WHERE session_id = ${sessionId} AND created_at > ${after}
    ORDER BY created_at ASC LIMIT 100
  `;
  return NextResponse.json({ ...sessions[0], messages });
}
