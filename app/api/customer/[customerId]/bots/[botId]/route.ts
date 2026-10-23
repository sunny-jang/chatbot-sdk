import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { portalUser } from "@/lib/customer-portal/auth";
import { body, failure, sameOrigin } from "@/lib/customer-portal/input";
import { customerBot, configureCustomerBot } from "@/lib/customer-portal/bots";
import { enforceRateLimit } from "@/lib/support";
type C = { params: Promise<{ customerId: string; botId: string }> };
export async function GET(_: Request, { params }: C) {
  try {
    const p = await params,
      user = await portalUser();
    return Response.json(
      (await customerBot(sql, user.id, p.customerId, p.botId)).bot,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request, { params }: C) {
  try {
    sameOrigin(req);
    const p = await params,
      user = await portalUser(),
      input = await body(req);
    if (!(await enforceRateLimit("customer-bot-settings:" + user.id, req, 30)))
      return Response.json(
        { error: "잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    await sql.begin((tx) =>
      configureCustomerBot(
        tx as unknown as AccessDatabase,
        user.id,
        p.customerId,
        p.botId,
        input,
      ),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
