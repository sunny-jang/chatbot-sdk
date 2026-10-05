import { OperationError } from "./input";
export { OperationError, boundedText, jsonBody } from "./input";
import sql from "../neon";
import { initSchema } from "../db";
import { readTenantId } from "../auth";

export async function adminBot(id: string) {
  const tenantId = await readTenantId();
  if (!tenantId) throw new OperationError("로그인이 필요합니다.", 401);
  await initSchema();
  const rows =
    await sql`SELECT * FROM bots WHERE id=${id} AND tenant_id=${tenantId}`;
  if (!rows[0]) throw new OperationError("챗봇을 찾을 수 없습니다.", 404);
  return { bot: rows[0], tenantId };
}
export function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof OperationError
          ? error.message
          : "처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
    },
    { status: error instanceof OperationError ? error.status : 500 },
  );
}
