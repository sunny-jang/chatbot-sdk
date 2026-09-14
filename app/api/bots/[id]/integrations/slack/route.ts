import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getSlackIntegration, slackCall } from "@/lib/support";
import { readTenantId } from "@/lib/auth";

async function ownedBot(id: string) {
  const tenantId = (await readTenantId());
  if (!tenantId) return null;
  const rows = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  return rows[0] ? tenantId : null;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await initSchema();
  if (!(await ownedBot(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await sql`SELECT channel_id, team_id, enabled, updated_at FROM slack_integrations WHERE bot_id = ${id}`;
  return NextResponse.json(rows[0]
    ? { connected: true, hasToken: true, hasSecret: true, ...rows[0] }
    : { connected: false, hasToken: false, hasSecret: false, channel_id: "", team_id: null, enabled: false });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await initSchema();
  if (!(await ownedBot(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { bot_token, signing_secret, channel_id, enabled = true } = await req.json();
  const currentRows = await sql`SELECT bot_token, signing_secret FROM slack_integrations WHERE bot_id = ${id}`;
  const current = currentRows[0] as { bot_token: string; signing_secret: string } | undefined;
  if (!bot_token && !current) return NextResponse.json({ error: "Slack Bot User OAuth Token을 입력해주세요." }, { status: 400 });
  if (!signing_secret && !current) return NextResponse.json({ error: "Slack Signing Secret을 입력해주세요." }, { status: 400 });
  if (!channel_id?.toString().trim()) return NextResponse.json({ error: "Slack Channel ID를 입력해주세요." }, { status: 400 });

  const encryptedToken = bot_token ? encrypt(String(bot_token).trim()) : current!.bot_token;
  const encryptedSecret = signing_secret ? encrypt(String(signing_secret).trim()) : current!.signing_secret;
  const channelId = String(channel_id).trim();
  await sql`
    INSERT INTO slack_integrations (bot_id, bot_token, signing_secret, channel_id, enabled, updated_at)
    VALUES (${id}, ${encryptedToken}, ${encryptedSecret}, ${channelId}, ${Boolean(enabled)}, EXTRACT(EPOCH FROM NOW())::BIGINT)
    ON CONFLICT (bot_id) DO UPDATE SET bot_token = ${encryptedToken}, signing_secret = ${encryptedSecret},
      channel_id = ${channelId}, enabled = ${Boolean(enabled)}, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
  `;

  const integration = await getSlackIntegration(id);
  if (!integration) return NextResponse.json({ error: "Slack 설정을 불러오지 못했습니다." }, { status: 500 });
  const eventsUrl = `${new URL(req.url).origin}/api/integrations/slack/${id}/events`;
  try {
    const auth = await slackCall(integration.token, "auth.test", {}) as { team_id?: string; team?: string; user?: string };
    if (auth.team_id) {
      await sql`UPDATE slack_integrations SET team_id = ${auth.team_id} WHERE bot_id = ${id}`;
    }
    // public 채널이면 자동 참여를 시도하고, 이미 참여했거나 권한이 없으면 무시합니다.
    await slackCall(integration.token, "conversations.join", { channel: integration.channel_id }).catch(() => null);
    await slackCall(integration.token, "chat.postMessage", {
      channel: integration.channel_id,
      text: "✅ IDEAL AI 고객상담 연동이 완료되었습니다.",
    });
    return NextResponse.json({ ok: true, connected: true, teamName: auth.team || null, botUser: auth.user || null, eventsUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Slack 연결에 실패했습니다.", saved: true, eventsUrl }, { status: 502 });
  }
}
