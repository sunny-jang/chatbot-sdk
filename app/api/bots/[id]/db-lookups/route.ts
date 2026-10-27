import { readLookups, manageLookups } from "@/lib/db-lookups/handlers";
import { readTenantId } from "@/lib/auth";
import { failure, sameOrigin } from "@/lib/customer-portal/input";
import { enforceRateLimit } from "@/lib/support";
export const maxDuration = 30;
type Context = { params: Promise<{ id: string }> };
export const GET = (req: Request, ctx: Context) => readLookups(req, ctx);
export async function POST(req: Request, ctx: Context) {
  try {
    sameOrigin(req);
    const tenantId = await readTenantId();
    if (tenantId && !(await enforceRateLimit("agency-lookup:" + tenantId, req, 60)))
      return Response.json({ error: "잠시 후 다시 시도해주세요." }, { status: 429 });
    return manageLookups(req, ctx);
  } catch (e) {
    return failure(e);
  }
}
