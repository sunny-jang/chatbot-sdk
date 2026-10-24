import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { customerAccess, portalUser } from "@/lib/customer-portal/auth";
import {
  body,
  failure,
  sameOrigin,
  PortalError,
} from "@/lib/customer-portal/input";
import { mutateCustomerRequest } from "@/lib/customer-portal/requests";
type Context = { params: Promise<{ customerId: string }> };
export async function GET(req: Request, { params }: Context) {
  try {
    const { customerId } = await params,
      { grant } = await customerAccess(customerId, "requests.read");
    const p = new URL(req.url).searchParams,
      id = p.get("requestId");
    if (id) {
      const [r] =
        await sql`SELECT r.id,r.receipt,r.kind,r.name,r.company,r.email,r.phone,r.message,r.status,r.created_at,b.name AS bot_name,r.bot_id,r.session_id FROM customer_requests r JOIN bots b ON b.id=r.bot_id AND b.tenant_id=r.tenant_id WHERE r.id=${id} AND b.customer_id=${customerId} AND r.tenant_id=${grant.tenant_id}`;
      if (!r) throw new PortalError("접수를 찾을 수 없습니다.", 404);
      const notes =
        await sql`SELECT content,created_at FROM request_notes WHERE request_id=${id} ORDER BY created_at,id`;
      return Response.json({ ...r, notes });
    }
    const status = p.get("status") || "",
      q = (p.get("q") || "").trim().slice(0, 100),
      search = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
    if (status && !["new", "in_progress", "completed"].includes(status))
      throw new PortalError("상태를 확인해주세요.");
    const items =
      await sql`SELECT r.id,r.receipt,r.name,r.kind,r.status,r.message,r.created_at,b.name AS bot_name FROM customer_requests r JOIN bots b ON b.id=r.bot_id AND b.tenant_id=r.tenant_id WHERE r.tenant_id=${grant.tenant_id} AND b.customer_id=${customerId} AND (${status}='' OR r.status=${status}) AND (${q}='' OR concat_ws(' ',r.name,r.message,r.receipt) ILIKE ${search}) ORDER BY r.created_at DESC,r.id LIMIT 100`;
    return Response.json({ items });
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
      mutateCustomerRequest(
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
