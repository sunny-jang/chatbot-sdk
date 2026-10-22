import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { portalUser } from "@/lib/customer-portal/auth";
import { body, failure, sameOrigin } from "@/lib/customer-portal/input";
import { createInvitation } from "@/lib/customer-portal/management";
import { customerPortalOrigin } from "@/lib/customer-portal/mail";
import { enforceRateLimit } from "@/lib/support";
type Context = { params: Promise<{ customerId: string }> };
export async function POST(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const { customerId } = await params,
      user = await portalUser(),
      input = await body(req);
    if (!(await enforceRateLimit("customer-invite:" + user.id, req, 10)))
      return Response.json(
        { error: "잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    const origin = customerPortalOrigin(new URL(req.url).origin);
    const result = await sql.begin((tx) =>
      createInvitation(
        tx as unknown as AccessDatabase,
        user.id,
        customerId,
        input,
      ),
    );
    return Response.json(
      { id: result.id, url: `${origin}/customer/invite/${result.token}` },
      { status: 201 },
    );
  } catch (e) {
    return failure(e);
  }
}
