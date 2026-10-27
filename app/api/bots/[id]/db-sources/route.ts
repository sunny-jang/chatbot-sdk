import { readDbSources, manageDbSources } from "@/lib/db-sources/handlers";
import { readTenantId } from "@/lib/auth";
import { failure, sameOrigin } from "@/lib/customer-portal/input";
import { enforceRateLimit } from "@/lib/support";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export const GET = (req: Request, ctx: Context) => readDbSources(req, ctx);
export async function POST(req: Request, ctx: Context) {
  try {
    // 데스크 경로와 같은 보호: 같은 출처 요청만, 가져오기 단계 호출을 고려해 분당 120회.
    sameOrigin(req);
    const tenantId = await readTenantId();
    if (tenantId && !(await enforceRateLimit("agency-db:" + tenantId, req, 120)))
      return Response.json({ error: "잠시 후 다시 시도해주세요." }, { status: 429 });
    return manageDbSources(req, ctx);
  } catch (e) {
    return failure(e);
  }
}
