import { randomUUID } from "node:crypto";
import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { portalUser } from "@/lib/customer-portal/auth";
import {
  body,
  failure,
  sameOrigin,
  text,
  PortalError,
} from "@/lib/customer-portal/input";
import {
  customerBot,
  knowledgeKind,
  listKnowledge,
  mutateKnowledge,
} from "@/lib/customer-portal/bots";
import { getEmbedding } from "@/lib/embeddings";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import { enforceRateLimit } from "@/lib/support";
import { logoMime } from "@/lib/widget-presentation";
type C = {
  params: Promise<{ customerId: string; botId: string; resource: string[] }>;
};
export const maxDuration = 120;
export async function GET(req: Request, { params }: C) {
  try {
    const p = await params,
      user = await portalUser(),
      [resource] = p.resource;
    if (p.resource.length !== 1)
      throw new PortalError("기능을 찾을 수 없습니다.", 404);
    if (resource === "analytics") {
      await customerBot(sql, user.id, p.customerId, p.botId, "analytics.read");
      const raw = Number(new URL(req.url).searchParams.get("days") || 30),
        days = Number.isFinite(raw)
          ? Math.min(365, Math.max(1, Math.floor(raw)))
          : 30;
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const [summary] =
        await sql`SELECT count(*)::int AS messages,count(DISTINCT session_id)::int AS sessions,count(*) FILTER(WHERE refused)::int AS refused,COALESCE(avg(latency_ms),0)::float AS latency FROM chat_logs WHERE bot_id=${p.botId} AND created_at>=${since}`;
      const [requests] =
        await sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='new')::int AS pending FROM customer_requests WHERE bot_id=${p.botId} AND created_at>=${since}`;
      return Response.json({ summary, requests, days });
    }
    if (resource === "logs") {
      await customerBot(sql, user.id, p.customerId, p.botId, "analytics.read");
      return Response.json(
        await sql`SELECT id,session_id,user_message,bot_reply,created_at FROM chat_logs WHERE bot_id=${p.botId} ORDER BY created_at DESC,id DESC LIMIT 100`,
      );
    }
    return Response.json(
      await listKnowledge(
        sql,
        user.id,
        p.customerId,
        p.botId,
        knowledgeKind(resource),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
async function mutate(req: Request, { params }: C) {
  try {
    sameOrigin(req);
    const p = await params,
      user = await portalUser();
    if (p.resource.length > 2)
      throw new PortalError("기능을 찾을 수 없습니다.", 404);
    const [resource, id] = p.resource;
    if (!(await enforceRateLimit("customer-knowledge:" + user.id, req, 30)))
      return Response.json(
        { error: "잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    if (resource === "logo") {
      await customerBot(sql, user.id, p.customerId, p.botId, "bot.configure");
      let logo: string | null = null;
      if (req.method !== "DELETE") {
        const file = (await req.formData()).get("file");
        if (!(file instanceof File) || file.size > 2 * 1024 * 1024)
          throw new PortalError("2MB 이하 이미지 파일을 선택해주세요.");
        const bytes = new Uint8Array(await file.arrayBuffer()),
          mime = logoMime(bytes);
        if (!mime || mime !== file.type)
          throw new PortalError(
            "PNG·JPG·GIF·WebP 이미지만 사용할 수 있습니다.",
          );
        logo = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
      }
      await sql.begin(async (tx) => {
        const { grant } = await customerBot(
          tx as unknown as AccessDatabase,
          user.id,
          p.customerId,
          p.botId,
          "bot.configure",
          true,
        );
        await tx`UPDATE bots SET logo_url=${logo} WHERE id=${p.botId} AND customer_id=${p.customerId}`;
        await tx`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${user.id},${grant.tenant_id},${p.customerId},'bot.logo',${p.botId},'success')`;
      });
      return Response.json({ logo_url: logo });
    }
    const kind = knowledgeKind(resource),
      { grant } = await customerBot(
        sql,
        user.id,
        p.customerId,
        p.botId,
        "knowledge.manage",
      );
    const input = req.method === "DELETE" ? {} : await body(req, 220000);
    let embedding: number[] | null = null;
    if (req.method !== "DELETE" && ["docs", "qa"].includes(kind)) {
      const content =
        kind === "docs"
          ? text(input.content, "본문", 50000)
          : text(input.question, "질문", 2000);
      embedding = await getEmbedding(
        content.slice(0, 8000),
        await getTenantApiKeyByTenantId(grant.tenant_id),
      );
    }
    const result = await sql.begin((tx) =>
      mutateKnowledge(
        tx as unknown as AccessDatabase,
        user.id,
        p.customerId,
        p.botId,
        kind,
        req.method,
        input,
        id || null,
        embedding,
      ),
    );
    return Response.json(result, { status: req.method === "POST" ? 201 : 200 });
  } catch (e) {
    return failure(e);
  }
}
export const POST = mutate;
export const PUT = mutate;
export const DELETE = mutate;
