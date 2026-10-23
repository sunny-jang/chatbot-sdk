import sql from "@/lib/neon";
import { customerAccess } from "@/lib/customer-portal/auth";
import { failure } from "@/lib/customer-portal/input";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  try {
    const { customerId } = await params;
    const { grant } = await customerAccess(customerId, "bot.read");
    return Response.json(
      await sql`SELECT id,name,type FROM bots WHERE customer_id=${customerId} AND tenant_id=${grant.tenant_id} ORDER BY name,id`,
    );
  } catch (e) {
    return failure(e);
  }
}
