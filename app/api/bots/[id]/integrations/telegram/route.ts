import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getTelegramIntegration, telegramCall } from "@/lib/support";

async function ownedBot(id: string) {
  const tenantId = (await cookies()).get("tenant_id")?.value;
  if (!tenantId) return null;
  const rows = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  return rows[0] ? tenantId : null;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await initSchema();
  if (!(await ownedBot(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await sql`SELECT chat_id, enabled, updated_at FROM telegram_integrations WHERE bot_id = ${id}`;
  return NextResponse.json(rows[0] ? { connected: true, hasToken: true, ...rows[0] } : { connected: false, hasToken: false, chat_id: "", enabled: false });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await initSchema();
  if (!(await ownedBot(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { bot_token, chat_id, enabled = true } = await req.json();
  const currentRows = await sql`SELECT bot_token, webhook_secret FROM telegram_integrations WHERE bot_id = ${id}`;
  if (!bot_token && !currentRows[0]) return NextResponse.json({ error: "Telegram Bot Token을 입력해주세요." }, { status: 400 });
  if (!chat_id?.toString().trim()) return NextResponse.json({ error: "Telegram 그룹 Chat ID를 입력해주세요." }, { status: 400 });
  const encryptedToken = bot_token ? encrypt(bot_token.trim()) : currentRows[0].bot_token;
  const webhookSecret = (currentRows[0]?.webhook_secret as string | undefined) || randomUUID().replaceAll("-", "");
  await sql`
    INSERT INTO telegram_integrations (bot_id, bot_token, chat_id, webhook_secret, enabled, updated_at)
    VALUES (${id}, ${encryptedToken}, ${String(chat_id).trim()}, ${webhookSecret}, ${Boolean(enabled)}, EXTRACT(EPOCH FROM NOW())::BIGINT)
    ON CONFLICT (bot_id) DO UPDATE SET bot_token = ${encryptedToken}, chat_id = ${String(chat_id).trim()},
      webhook_secret = ${webhookSecret}, enabled = ${Boolean(enabled)}, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
  `;
  const integration = await getTelegramIntegration(id);
  if (!integration) return NextResponse.json({ error: "Telegram 설정을 불러오지 못했습니다." }, { status: 500 });
  const origin = new URL(req.url).origin;
  const webhookUrl = `${origin}/api/integrations/telegram/${id}/webhook`;
  try {
    const bot = await telegramCall(integration.token, "getMe", {}) as { username?: string };
    let webhookRegistered = false;
    if (!origin.includes("localhost") && !origin.includes("127.0.0.1")) {
      await telegramCall(integration.token, "setWebhook", { url: webhookUrl, secret_token: webhookSecret });
      webhookRegistered = true;
    }
    await telegramCall(integration.token, "sendMessage", { chat_id: integration.chat_id, text: "✅ IDEAL AI 고객상담 연동이 완료되었습니다." });
    return NextResponse.json({ ok: true, connected: true, botUsername: bot.username || null, webhookRegistered, webhookUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Telegram 연결에 실패했습니다.", saved: true, webhookUrl }, { status: 502 });
  }
}
