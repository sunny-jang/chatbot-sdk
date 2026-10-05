import { randomUUID } from "crypto";
import sql from "@/lib/neon";
import {
  adminBot,
  boundedText,
  failure,
  jsonBody,
  OperationError,
} from "@/lib/operations/http";
import { requestSettings } from "@/lib/operations/settings";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { bot } = await adminBot(id);
    return Response.json({
      summaryEnabled: bot.summary_enabled,
      requests: requestSettings(bot.request_settings),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { bot } = await adminBot(id);
    const body = await jsonBody(req);
    const summary =
      body.summaryEnabled === undefined
        ? Boolean(bot.summary_enabled)
        : body.summaryEnabled;
    if (typeof summary !== "boolean")
      throw new OperationError("요약 설정을 확인해주세요.");
    let settings = requestSettings(bot.request_settings);
    if (body.requests) {
      const next = requestSettings(body.requests);
      if (
        typeof next.quote !== "boolean" ||
        typeof next.consultation !== "boolean" ||
        typeof next.company !== "boolean" ||
        !["either", "email", "phone"].includes(next.contact)
      )
        throw new OperationError("폼 설정을 확인해주세요.");
      if (
        !Number.isInteger(next.retentionDays) ||
        next.retentionDays < 1 ||
        next.retentionDays > 365
      )
        throw new OperationError("보유 기간은 1~365일로 설정해주세요.");
      next.consentText = boundedText(
        next.consentText,
        "개인정보 안내",
        5000,
        next.quote || next.consultation,
      );
      next.consentVersion =
        next.consentText === settings.consentText &&
        next.contact === settings.contact &&
        next.company === settings.company &&
        next.retentionDays === settings.retentionDays
          ? settings.consentVersion
          : randomUUID();
      settings = next;
    }
    await sql`UPDATE bots SET summary_enabled=${summary},request_settings=${sql.json(settings)} WHERE id=${id}`;
    return Response.json({ summaryEnabled: summary, requests: settings });
  } catch (e) {
    return failure(e);
  }
}
