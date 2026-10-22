import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { customerAccess, portalUser } from "@/lib/customer-portal/auth";
import { body, failure, sameOrigin } from "@/lib/customer-portal/input";
import { updateMember } from "@/lib/customer-portal/management";
type Context = { params: Promise<{ customerId: string }> };
export async function GET(_: Request, { params }: Context) {
  try {
    const { customerId } = await params;
    await customerAccess(customerId, "members.agent");
    const items =
      await sql`SELECT u.id,u.name,u.email,m.role,m.status FROM customer_memberships m JOIN users u ON u.id=m.user_id WHERE m.customer_id=${customerId} ORDER BY m.created_at,u.id`;
    const invitations =
      await sql`SELECT id,email,role,CASE WHEN status='pending' AND expires_at<=EXTRACT(EPOCH FROM NOW()) THEN 'expired' ELSE status END AS status,expires_at FROM customer_invitations WHERE customer_id=${customerId} ORDER BY created_at DESC LIMIT 100`;
    return Response.json({ items, invitations });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const { customerId } = await params,
      user = await portalUser(),
      input = await body(req);
    await sql.begin((tx) =>
      updateMember(tx as unknown as AccessDatabase, user.id, customerId, input),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
