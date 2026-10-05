import { randomUUID } from "crypto";
import { after } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { enforceRateLimit } from "@/lib/support";
import { failure, jsonBody, OperationError } from "@/lib/operations/http";
import { requestSettings } from "@/lib/operations/settings";
import { validateRequest } from "@/lib/operations/request-validation";
import { processJobs } from "@/lib/operations/jobs";
export const maxDuration = 60;
type Context = { params: Promise<{ botId: string }> };
async function publicBot(req: Request, id: string) {
  await initSchema();
  const rows =
    await sql`SELECT b.*,t.subscription_status FROM bots b JOIN tenants t ON t.id=b.tenant_id WHERE b.id=${id}`;
  const bot = rows[0];
  if (
    !bot ||
    !bot.public_token ||
    req.headers.get("x-bot-token") !== bot.public_token
  )
    throw new OperationError("챗봇 인증에 실패했습니다.", 401);
  if (bot.subscription_status !== "active")
    throw new OperationError("구독이 비활성 상태입니다.", 403);
  return bot;
}
export async function GET(req: Request, { params }: Context) {
  try {
    const { botId } = await params;
    const bot = await publicBot(req, botId);
    return Response.json(requestSettings(bot.request_settings));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, { params }: Context) {
  try {
    const { botId } = await params;
    const bot = await publicBot(req, botId);
    if (!(await enforceRateLimit(botId, req, 10)))
      throw new OperationError(
        "신청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        429,
      );
    const settings = requestSettings(bot.request_settings);
    const input = await jsonBody(req);
    let data = validateRequest(input, settings);
    const result = await sql.begin(async (tx) => {
      const locked =
        await tx`SELECT b.request_settings,t.subscription_status FROM bots b JOIN tenants t ON t.id=b.tenant_id WHERE b.id=${botId} FOR UPDATE OF b`;
      const current = requestSettings(locked[0]?.request_settings);
      const existing =
        await tx`SELECT receipt,payload_hash FROM customer_requests WHERE bot_id=${botId} AND idempotency_key=${data.key}`;
      if (existing[0]) {
        if (existing[0].payload_hash !== data.hash)
          throw new OperationError(
            "같은 제출 키로 다른 내용을 제출할 수 없습니다.",
            409,
          );
        return String(existing[0].receipt);
      }
      if (
        locked[0]?.subscription_status !== "active" ||
        !current[data.kind as "quote" | "consultation"] ||
        current.consentVersion !== settings.consentVersion
      )
        throw new OperationError(
          "폼 설정이 변경되었습니다. 다시 열어주세요.",
          409,
        );
      data = validateRequest(input, current);
      if (
        data.sessionId &&
        !(
          await tx`SELECT id FROM chat_sessions WHERE id=${data.sessionId} AND bot_id=${botId} AND tenant_id=${bot.tenant_id}`
        )[0]
      )
        throw new OperationError("대화 세션을 확인해주세요.", 400);
      const id = randomUUID(),
        receipt = `REQ-${randomUUID()}`;
      await tx`INSERT INTO customer_requests(id,receipt,bot_id,tenant_id,session_id,kind,name,company,email,phone,message,consent_text,consent_version,retention_days,idempotency_key,payload_hash)
      VALUES(${id},${receipt},${botId},${bot.tenant_id},${data.sessionId},${data.kind},${data.name},${data.company},${data.email},${data.phone},${data.message},${current.consentText},${current.consentVersion},${current.retentionDays},${data.key},${data.hash})`;
      await tx`INSERT INTO operation_jobs(id,bot_id,kind,target_id,channel) VALUES(${randomUUID()},${botId},'request_notification',${id},'local')`;
      return receipt;
    });
    after(async () => {
      await processJobs().catch(() => undefined);
    });
    return Response.json({ ok: true, receipt: result }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
