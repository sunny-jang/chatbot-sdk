import { randomUUID } from "node:crypto";
import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { readPublicDemo, reserveDemoTurn } from "@/lib/demo/store";
import { answerDemo } from "@/lib/demo/answer";
import { body, failure, PortalError, text } from "@/lib/customer-portal/input";
import {
  widgetTitle,
  widgetColor,
  widgetLogo,
  DEFAULT_WIDGET_COLOR,
} from "@/lib/widget-presentation";
import { getSupportStatus } from "@/lib/supportHours";
import { normalizeProactive } from "@/lib/proactive";
import { enforceRateLimit } from "@/lib/support";
import { requestSettings } from "@/lib/operations/settings";
import { validateRequest } from "@/lib/operations/request-validation";
import { OperationError } from "@/lib/operations/input";
type C = { params: Promise<{ token: string; path: string[] }> };
export const maxDuration = 60;
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers });
async function resolve(req: Request, params: C["params"]) {
  const p = await params,
    demo = await readPublicDemo(sql, p.token),
    path = p.path.join("/");
  if (req.method !== "GET" && req.headers.get("x-bot-token") !== p.token)
    throw new PortalError("데모 인증에 실패했습니다.", 401);
  return { ...p, demo, path };
}
export async function GET(req: Request, { params }: C) {
  try {
    const { demo, path } = await resolve(req, params);
    if (path === "chatbot-default.svg")
      return Response.redirect(new URL("/chatbot-default.svg", req.url));
    if (path === `api/widget/${demo.bot_id}`) {
      const [bot] =
        await sql`SELECT name,type,widget_title,widget_color,greeting_message,logo_url,support_mode,support_hours,force_unattended,qa_handoff_always FROM bots WHERE id=${demo.bot_id}`;
      const folders =
        await sql`SELECT id,name FROM qa_folders WHERE bot_id=${demo.bot_id} ORDER BY name`;
      const pairs =
        await sql`SELECT id,folder_id,question,answer FROM qa_pairs WHERE bot_id=${demo.bot_id} ORDER BY created_at,id`;
      const loose = pairs.filter((q) => q.folder_id === null);
      if (loose.length)
        folders.push({ id: "__uncategorized", name: "자주 묻는 질문" });
      const status = getSupportStatus({ ...bot, support_mode: "hybrid" });
      return json({
        title:
          widgetTitle(bot.widget_title) || widgetTitle(bot.name) || "고객 상담",
        color: widgetColor(bot.widget_color) || DEFAULT_WIDGET_COLOR,
        logo: widgetLogo(bot.logo_url),
        type: bot.type,
        greeting: bot.greeting_message,
        proactive: { ...normalizeProactive(null), enabled: false },
        supportMode: bot.support_mode,
        supportAvailable: status.live,
        supportHoursText: status.hoursText,
        supportUnavailableReason: status.reason,
        qaHandoffAlways: bot.qa_handoff_always !== false,
        qaFolders: folders
          .map((f) => ({
            id: f.id,
            name: f.name,
            questions: pairs
              .filter((q) =>
                f.id === "__uncategorized"
                  ? q.folder_id === null
                  : q.folder_id === f.id,
              )
              .map((q) => ({
                id: q.id,
                question: q.question,
                answer: q.answer,
              })),
          }))
          .filter((f) => f.questions.length),
      });
    }
    if (path === `api/chat/${demo.bot_id}/requests`) {
      const [bot] =
        await sql`SELECT request_settings FROM bots WHERE id=${demo.bot_id}`;
      return json(requestSettings(bot.request_settings));
    }
    if (path === `api/chat/${demo.bot_id}/handoff`) {
      const sessionId = text(
        new URL(req.url).searchParams.get("sessionId"),
        "대화",
        200,
      );
      const turns =
        await sql`SELECT id,question,reply,created_at FROM demo_turns WHERE demo_id=${demo.id} AND session_id=${sessionId} AND state='completed' ORDER BY sequence DESC LIMIT 50`;
      return json({
        exists: !!turns.length,
        status: "ai",
        messages: turns.reverse().flatMap((t) => [
          {
            id: t.id + ":q",
            sender_type: "customer",
            content: t.question,
            created_at: t.created_at,
          },
          {
            id: t.id + ":a",
            sender_type: "bot",
            content: t.reply,
            created_at: t.created_at,
          },
        ]),
      });
    }
    throw new PortalError("데모 기능을 찾을 수 없습니다.", 404);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, { params }: C) {
  let turnId: string | null = null;
  try {
    const { token, demo, path } = await resolve(req, params);
    if (!(await enforceRateLimit("demo:" + demo.id, req, 20)))
      throw new PortalError("잠시 후 다시 시도해주세요.", 429);
    if (path === `api/chat/${demo.bot_id}/handoff`)
      throw new PortalError(
        "데모에서는 실제 상담원에게 연결하지 않습니다. 설치 후 상담 담당자 연결을 이용할 수 있습니다.",
        409,
      );
    if (path === `api/chat/${demo.bot_id}/requests`) {
      const input = await body(req),
        [bot] =
          await sql`SELECT request_settings FROM bots WHERE id=${demo.bot_id}`,
        settings = requestSettings(bot.request_settings),
        data = validateRequest(input, settings);
      const receipt = await sql.begin(async (tx) => {
        await tx`SELECT id FROM tenants WHERE id=${demo.tenant_id} FOR NO KEY UPDATE`;
        await tx`SELECT id FROM customer_demos WHERE id=${demo.id} FOR UPDATE`;
        await readPublicDemo(tx as unknown as AccessDatabase, token);
        const [prior] =
          await tx`SELECT receipt,payload_hash FROM demo_requests WHERE demo_id=${demo.id} AND request_key=${data.key}`;
        if (prior) {
          if (prior.payload_hash !== data.hash)
            throw new PortalError(
              "같은 키로 다른 내용을 제출할 수 없습니다.",
              409,
            );
          return String(prior.receipt);
        }
        const [current] =
          await tx`SELECT request_count,max_requests FROM customer_demos WHERE id=${demo.id}`;
        if (Number(current.request_count) >= Number(current.max_requests))
          throw new PortalError("데모 체험 한도에 도달했습니다.", 429);
        const receipt = "DEMO-" + randomUUID();
        await tx`INSERT INTO demo_requests(id,demo_id,request_key,payload_hash,kind,receipt) VALUES(${randomUUID()},${demo.id},${data.key},${data.hash},${data.kind},${receipt})`;
        await tx`UPDATE customer_demos SET request_count=request_count+1 WHERE id=${demo.id}`;
        return receipt;
      });
      return json({ receipt, demo: true, ok: true }, 201);
    }
    if (path !== `api/chat/${demo.bot_id}`)
      throw new PortalError("데모 기능을 찾을 수 없습니다.", 404);
    const input = await body(req),
      message = text(input.message, "질문", 2000),
      sessionId = text(input.sessionId, "대화", 200),
      requestId = input.requestId
        ? text(input.requestId, "요청", 100)
        : randomUUID(),
      qaId = input.qaId ? text(input.qaId, "질문", 200) : null;
    const reserved = await sql.begin((tx) =>
      reserveDemoTurn(
        tx as unknown as AccessDatabase,
        token,
        sessionId,
        requestId,
        message,
        qaId,
      ),
    );
    if (reserved.duplicate) return json({ reply: reserved.reply, demo: true });
    turnId = reserved.id;
    const result = await answerDemo(reserved.demo, message, qaId, sessionId);
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM customer_demos WHERE id=${demo.id} FOR UPDATE`;
      await readPublicDemo(tx as unknown as AccessDatabase, token);
      await tx`UPDATE demo_turns SET reply=${result.reply},state='completed' WHERE id=${reserved.id}`;
    });
    return json({ ...result, demo: true, handoffAvailable: false });
  } catch (e) {
    if (turnId)
      await sql`UPDATE demo_turns SET state='failed' WHERE id=${turnId} AND state='pending'`.catch(
        () => {},
      );
    return failure(
      e instanceof OperationError ? new PortalError(e.message, e.status) : e,
    );
  }
}
