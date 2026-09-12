import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import sql from "./neon";
import { decrypt } from "./crypto";

export type SenderType = "customer" | "bot" | "agent" | "system";

export async function ensureChatSession(sessionId: string, tenantId: string, botId: string, customerName?: string) {
  await sql`
    INSERT INTO chat_sessions (id, tenant_id, bot_id, customer_name)
    VALUES (${sessionId}, ${tenantId}, ${botId}, ${customerName || null})
    ON CONFLICT (id) DO UPDATE SET updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
  `;
}

export async function saveChatMessage(sessionId: string, senderType: SenderType, content: string, source = "widget", senderName?: string | null, externalMessageId?: string | null) {
  if (!content.trim()) return null;
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO chat_messages (id, session_id, sender_type, sender_name, content, source, external_message_id)
    VALUES (${id}, ${sessionId}, ${senderType}, ${senderName || null}, ${content}, ${source}, ${externalMessageId || null})
    ON CONFLICT (source, external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
    RETURNING *
  `;
  await sql`UPDATE chat_sessions SET updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id = ${sessionId}`;
  return rows[0] ?? null;
}

export async function getTelegramIntegration(botId: string) {
  const rows = await sql`SELECT * FROM telegram_integrations WHERE bot_id = ${botId} AND enabled = TRUE`;
  if (!rows[0]) return null;
  try {
    return { ...rows[0], token: decrypt(rows[0].bot_token as string) } as Record<string, unknown> & { token: string; chat_id: string; webhook_secret: string };
  } catch {
    return null;
  }
}

export async function telegramCall(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

export async function sendTelegramMessage(botId: string, text: string, topicId?: number | null) {
  const integration = await getTelegramIntegration(botId);
  if (!integration) return false;
  await telegramCall(integration.token, "sendMessage", {
    chat_id: integration.chat_id,
    message_thread_id: topicId || undefined,
    text: text.slice(0, 4096),
  });
  return true;
}

export async function getSlackIntegration(botId: string) {
  const rows = await sql`SELECT * FROM slack_integrations WHERE bot_id = ${botId} AND enabled = TRUE`;
  if (!rows[0]) return null;
  try {
    return {
      ...rows[0],
      token: decrypt(rows[0].bot_token as string),
      secret: decrypt(rows[0].signing_secret as string),
    } as Record<string, unknown> & { token: string; secret: string; channel_id: string; team_id: string | null };
  } catch {
    return null;
  }
}

export async function slackCall(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await response.json() as { ok?: boolean; error?: string; [key: string]: unknown };
  if (!response.ok || !data.ok) throw new Error(data.error || `Slack ${method} failed`);
  return data;
}

export async function sendSlackMessage(botId: string, text: string, threadTs?: string | null) {
  const integration = await getSlackIntegration(botId);
  if (!integration) return null;
  const result = await slackCall(integration.token, "chat.postMessage", {
    channel: integration.channel_id,
    thread_ts: threadTs || undefined,
    text: text.slice(0, 40000),
  });
  return result as { ok: boolean; channel: string; ts: string };
}

export function verifySlackSignature(secret: string, rawBody: string, timestamp: string | null, signature: string | null) {
  if (!timestamp || !signature || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function enforceRateLimit(botId: string, request: Request, limit = 60) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const minute = Math.floor(Date.now() / 60000);
  const key = `${botId}:${ip}:${minute}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  const rows = await sql`
    INSERT INTO api_rate_limits (bucket_key, request_count, expires_at) VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT (bucket_key) DO UPDATE SET request_count = api_rate_limits.request_count + 1
    RETURNING request_count
  `;
  if (Math.random() < 0.02) await sql`DELETE FROM api_rate_limits WHERE expires_at < EXTRACT(EPOCH FROM NOW())::BIGINT`;
  return Number(rows[0]?.request_count || 1) <= limit;
}

export type SupportChannelRefs = {
  telegram_topic_id?: number | string | null;
  slack_thread_ts?: string | null;
};

/**
 * 연결된 외부 상담 채널(Telegram Topic / Slack Thread)에 같은 문구를 미러링합니다.
 * 한 채널의 실패가 다른 채널과 DB 저장을 막지 않도록 각각 개별적으로 처리합니다.
 */
export async function fanOutToSupportChannels(
  botId: string,
  refs: SupportChannelRefs,
  text: string,
  skip: { telegram?: boolean; slack?: boolean } = {},
) {
  const tasks: Promise<unknown>[] = [];
  if (!skip.telegram && refs.telegram_topic_id) {
    tasks.push(sendTelegramMessage(botId, text, Number(refs.telegram_topic_id)).catch(() => false));
  }
  if (!skip.slack && refs.slack_thread_ts) {
    tasks.push(sendSlackMessage(botId, text, refs.slack_thread_ts).catch(() => null));
  }
  await Promise.all(tasks);
}
