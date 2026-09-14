import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getTelegramIntegration, telegramCall, type TelegramApiError } from "@/lib/support";
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
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const origin = forwardedHost ? `${forwardedProto || "https"}://${forwardedHost}` : new URL(req.url).origin;
  const webhookUrl = `${origin}/api/integrations/telegram/${id}/webhook`;
  try {
    const bot = await telegramCall(integration.token, "getMe", {}) as { id: number; username?: string };

    // 상담 건마다 Forum Topic을 만들기 때문에, 주제(Topics)가 켜진 슈퍼그룹과 봇의 주제 관리 권한이 필요합니다.
    // 저장 단계에서 텔레그램에 직접 확인해 설정 오류를 바로 알려줍니다.
    const rejectSetup = (error: string, detail: Record<string, unknown> = {}) => {
      console.warn(`[telegram] 연결 검사 실패 (bot ${id}): ${error}`, detail);
      return NextResponse.json({ error, saved: true, ...detail }, { status: 400 });
    };
    let chatId = integration.chat_id;
    const migratedChatId = (error: unknown) => (error as TelegramApiError).parameters?.migrate_to_chat_id;
    type TelegramChat = { id: number; type: string; is_forum?: boolean; title?: string };
    let chat: TelegramChat;
    try {
      chat = await telegramCall(integration.token, "getChat", { chat_id: chatId }) as TelegramChat;
    } catch (error) {
      const next = migratedChatId(error);
      // 웹 텔레그램 주소(#-4242797864)나 t.me/c/4242797864 링크의 번호에는 슈퍼그룹 접두어 -100이 빠져 있습니다.
      // 그대로 입력해도 연결되도록 -100을 붙여 한 번 더 찾아봅니다.
      const digits = chatId.replace(/^-/, "");
      const withPrefix = /^\d+$/.test(digits) && !digits.startsWith("100") ? `-100${digits}` : null;
      const prefixed = !next && withPrefix
        ? await telegramCall(integration.token, "getChat", { chat_id: withPrefix }).catch(() => null) as TelegramChat | null
        : null;
      if (next) {
        chatId = String(next);
        chat = await telegramCall(integration.token, "getChat", { chat_id: chatId }) as TelegramChat;
      } else if (prefixed && withPrefix) {
        chatId = withPrefix;
        chat = prefixed;
      } else {
        throw new Error(`Telegram 그룹을 찾을 수 없습니다. Chat ID와 봇의 그룹 참여 여부를 확인해주세요. (${error instanceof Error ? error.message : "getChat 실패"})`);
      }
    }
    if (chat.type === "group") {
      // 주제를 켜면 일반 그룹이 새 ID의 슈퍼그룹으로 바뀝니다. 예전 ID로 저장했다면 텔레그램이 새 ID를 알려줍니다.
      const next = await telegramCall(integration.token, "sendChatAction", { chat_id: chatId, action: "typing" })
        .then(() => undefined)
        .catch((error) => migratedChatId(error));
      if (!next) {
        return rejectSetup("일반 그룹입니다. 텔레그램 그룹 편집에서 주제(Topics)를 켠 뒤 다시 저장해주세요.", { chatType: chat.type });
      }
      chatId = String(next);
      chat = await telegramCall(integration.token, "getChat", { chat_id: chatId }) as TelegramChat;
    }
    // 업그레이드로 바뀐 새 Chat ID는 이후 검사 결과와 관계없이 바로 저장합니다.
    // 권한만 고치고 다시 저장할 때 예전 ID로 되돌아가지 않게 하기 위해서입니다.
    if (chatId !== integration.chat_id) {
      await sql`UPDATE telegram_integrations SET chat_id = ${chatId}, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE bot_id = ${id}`;
      integration.chat_id = chatId;
    }
    if (chat.type !== "supergroup") {
      return rejectSetup("Telegram 그룹(주제가 켜진 슈퍼그룹)의 Chat ID를 입력해주세요. 개인 채팅이나 채널은 사용할 수 없습니다.", { chatType: chat.type });
    }
    if (!chat.is_forum) {
      return rejectSetup("그룹의 주제(Topics)가 꺼져 있습니다. 텔레그램 그룹 편집에서 주제를 켠 뒤 다시 저장해주세요.", { chatId, chatType: chat.type, isForum: Boolean(chat.is_forum) });
    }
    // getChatMember의 can_manage_topics는 선택 항목이라 권한이 있어도 비어 올 수 있습니다.
    // 권한 값으로 판단하지 않고, 실제로 테스트 주제를 만들어 확인합니다. 권한 값은 로그용으로만 남깁니다.
    const member = await telegramCall(integration.token, "getChatMember", { chat_id: chatId, user_id: bot.id })
      .catch(() => null) as { status: string; can_manage_topics?: boolean } | null;
    let testTopicId: number;
    try {
      const topic = await telegramCall(integration.token, "createForumTopic", { chat_id: chatId, name: "✅ IDEAL AI 연동 테스트" }) as { message_thread_id: number };
      testTopicId = topic.message_thread_id;
    } catch (error) {
      return rejectSetup(
        `봇이 그룹에 주제를 만들지 못했습니다. 봇을 관리자로 지정하고 '주제 관리(Manage Topics)' 권한을 켠 뒤 저장했는지 확인해주세요. (텔레그램 응답: ${error instanceof Error ? error.message : "createForumTopic 실패"})`,
        { chatId, memberStatus: member?.status ?? null, canManageTopics: member?.can_manage_topics ?? null },
      );
    }

    let webhookRegistered = false;
    if (!origin.includes("localhost") && !origin.includes("127.0.0.1")) {
      await telegramCall(integration.token, "setWebhook", { url: webhookUrl, secret_token: webhookSecret });
      webhookRegistered = true;
      console.info(`[telegram] 웹훅 등록 완료 (bot ${id}): ${webhookUrl}`);
    } else {
      // localhost에서는 텔레그램이 접속할 수 없어 웹훅 등록을 건너뜁니다. 답장 수신은 공개 주소(실서버·터널)에서 저장해야 합니다.
      console.info(`[telegram] 웹훅 등록 건너뜀 (bot ${id}): ${origin} 은 외부에서 접속할 수 없는 주소입니다.`);
    }
    await telegramCall(integration.token, "sendMessage", {
      chat_id: integration.chat_id,
      message_thread_id: testTopicId,
      text: "✅ IDEAL AI 고객상담 연동이 완료되었습니다.\n앞으로 상담 요청이 들어오면 이 그룹에 상담 건별 주제가 만들어집니다. 이 테스트 주제는 삭제해도 됩니다.",
    });
    return NextResponse.json({ ok: true, connected: true, botUsername: bot.username || null, chatId: integration.chat_id, webhookRegistered, webhookUrl });
  } catch (error) {
    // 저장·테스트 실패 원인을 서버 로그에서도 확인할 수 있게 남깁니다. (토큰은 기록하지 않음)
    console.error(`[telegram] 연결 저장·테스트 실패 (bot ${id}):`, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Telegram 연결에 실패했습니다.", saved: true, webhookUrl }, { status: 502 });
  }
}
