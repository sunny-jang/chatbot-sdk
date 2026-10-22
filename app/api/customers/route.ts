import { randomUUID } from "node:crypto";
import sql from "@/lib/neon";
import { agencyOwner } from "@/lib/customer-portal/auth";
import {
  body,
  failure,
  sameOrigin,
  text,
  website,
} from "@/lib/customer-portal/input";
export async function GET() {
  try {
    const { tenantId } = await agencyOwner();
    const items =
      await sql`SELECT c.id,c.name,c.website,c.status,(SELECT count(*)::int FROM bots b WHERE b.customer_id=c.id AND b.tenant_id=c.tenant_id) AS bots,(SELECT count(*)::int FROM customer_memberships m WHERE m.customer_id=c.id AND m.status='active') AS members FROM customers c WHERE c.tenant_id=${tenantId} ORDER BY c.created_at,c.id`;
    return Response.json({ items });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { tenantId } = await agencyOwner(),
      input = await body(req),
      name = text(input.name, "고객사 이름"),
      site = website(input.website),
      id = randomUUID();
    await sql`INSERT INTO customers(id,tenant_id,name,website) VALUES(${id},${tenantId},${name},${site})`;
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
