import sql from "@/lib/neon";
import { readLookups as read, manageLookups as manage } from "@/lib/db-lookups/handlers";
import { portalUser } from "@/lib/customer-portal/auth";
import { customerBot } from "@/lib/customer-portal/bots";
import { failure, sameOrigin } from "@/lib/customer-portal/input";
import { enforceRateLimit } from "@/lib/support";
type C = { params: Promise<{ customerId: string; botId: string }> };
export const maxDuration = 30;
async function handle(req: Request, { params }: C, mutation: boolean) {
  try {
    const p = await params,
      user = await portalUser();
    await customerBot(sql, user.id, p.customerId, p.botId, "knowledge.manage");
    if (mutation) {
      sameOrigin(req);
      if (!(await enforceRateLimit("customer-lookup:" + user.id, req, 60)))
        return Response.json({ error: "잠시 후 다시 시도해주세요." }, { status: 429 });
    }
    return (mutation ? manage : read)(req, { params: Promise.resolve({ id: p.botId }) }, true);
  } catch (e) {
    return failure(e);
  }
}
export const GET = (r: Request, c: C) => handle(r, c, false);
export const POST = (r: Request, c: C) => handle(r, c, true);
