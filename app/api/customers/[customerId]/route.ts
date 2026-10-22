import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { portalUser, customerAccess } from "@/lib/customer-portal/auth";
import { body, failure, sameOrigin } from "@/lib/customer-portal/input";
import { updateCustomer } from "@/lib/customer-portal/customers";
import { enforceRateLimit } from "@/lib/support";
type Context = { params: Promise<{ customerId: string }> };
export async function GET(_: Request, { params }: Context) {
  try {
    const { customerId } = await params;
    await customerAccess(customerId, "customer.read");
    const [item] =
      await sql`SELECT id,name,website,status FROM customers WHERE id=${customerId}`;
    return Response.json(item);
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
    if (!(await enforceRateLimit("customer-settings:" + user.id, req, 30)))
      return Response.json(
        { error: "잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    await sql.begin((tx) =>
      updateCustomer(
        tx as unknown as AccessDatabase,
        user.id,
        customerId,
        input,
      ),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
