import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { agencyOwner } from "@/lib/customer-portal/auth";
import { body, failure, sameOrigin, text } from "@/lib/customer-portal/input";
import {
  requireDemoSchema,
  checkDemoSite,
  createDemo,
  revokeDemo,
} from "@/lib/demo/store";
import { demoBackgroundsAvailable } from "@/lib/demo/backgrounds";
import { enforceRateLimit } from "@/lib/support";
export async function GET() {
  try {
    const { tenantId } = await agencyOwner();
    await requireDemoSchema(sql);
    // 배경 테이블을 못 쓰더라도 데모 목록은 보여줍니다.
    const hasBackground = (await demoBackgroundsAvailable(sql))
      ? sql`EXISTS(SELECT 1 FROM demo_backgrounds g WHERE g.demo_id=d.id)`
      : sql`FALSE`;
    const items =
      await sql`SELECT d.id,d.customer_id,d.bot_id,d.site_url,d.expires_at,d.revoked_at,d.created_at,d.request_count,d.max_requests,c.name AS customer_name,b.name AS bot_name,${hasBackground} AS has_background FROM customer_demos d JOIN customers c ON c.id=d.customer_id JOIN bots b ON b.id=d.bot_id WHERE d.tenant_id=${tenantId} ORDER BY d.created_at DESC,d.id LIMIT 100`;
    const bots =
      await sql`SELECT b.id,b.name,b.customer_id,c.name AS customer_name FROM bots b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id AND c.status='active' WHERE b.tenant_id=${tenantId} ORDER BY c.name,b.name`;
    return Response.json({ items, bots });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { user, tenantId } = await agencyOwner();
    await requireDemoSchema(sql);
    if (!(await enforceRateLimit("create-demo:" + user.id, req, 10)))
      return Response.json(
        { error: "잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    const input = await body(req),
      url = await checkDemoSite(input.website),
      customerId = text(input.customerId, "고객사", 200),
      botId = text(input.botId, "챗봇", 200);
    const result = await sql.begin((tx) =>
      createDemo(
        tx as unknown as AccessDatabase,
        user.id,
        tenantId,
        customerId,
        botId,
        url,
        typeof input.hours === "number" ? input.hours : 24,
      ),
    );
    return Response.json(
      {
        id: result.id,
        url: `${process.env.AUTH_URL || new URL(req.url).origin}/demo/${result.token}`,
      },
      { status: 201 },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request) {
  try {
    sameOrigin(req);
    const { user, tenantId } = await agencyOwner();
    await requireDemoSchema(sql);
    if (!(await enforceRateLimit("manage-demo:" + user.id, req, 30)))
      return Response.json(
        { error: "잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    const input = await body(req);
    await sql.begin((tx) =>
      revokeDemo(
        tx as unknown as AccessDatabase,
        user.id,
        tenantId,
        text(input.id, "데모", 200),
      ),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
