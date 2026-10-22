import sql from "@/lib/neon";
import { auth } from "@/auth";
import type { AccessDatabase } from "@/lib/access/schema";
import { requireReady } from "@/lib/customer-portal/auth";
import {
  body,
  failure,
  sameOrigin,
  tokenHash,
} from "@/lib/customer-portal/input";
import { activateInvitation } from "@/lib/customer-portal/management";
import { enforceRateLimit } from "@/lib/support";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    sameOrigin(req);
    await requireReady();
    const { token } = await params,
      input = await body(req);
    if (
      !(await enforceRateLimit("customer-activate:" + tokenHash(token), req, 6))
    )
      return Response.json(
        { error: "잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    const session = await auth();
    let userId = session?.customer_user_id ?? null;
    if (!userId && session?.tenant_id) {
      const [u] =
        await sql`SELECT id FROM users WHERE legacy_tenant_id=${session.tenant_id} AND status='active'`;
      userId = u ? String(u.id) : null;
    }
    const result = await sql.begin((tx) =>
      activateInvitation(tx as unknown as AccessDatabase, token, input, userId),
    );
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return failure(e);
  }
}
