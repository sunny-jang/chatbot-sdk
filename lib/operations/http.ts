import { OperationError } from "./input";
export { OperationError, boundedText, jsonBody } from "./input";
import sql from "../neon";
import { initSchema } from "../db";
import { readTenantId } from "../auth";
import type { AccessDatabase } from "../access/schema";
import { portalUser } from "../customer-portal/auth";
import { customerBot } from "../customer-portal/bots";
import { PortalError } from "../customer-portal/input";

export async function adminBot(
  id: string,
  db: AccessDatabase = sql,
  lock = false,
  allowCustomer = false,
) {
  try {
    return await resolveAdminBot(id, db, lock, allowCustomer);
  } catch (e) {
    if (e instanceof PortalError) throw new OperationError(e.message, e.status);
    throw e;
  }
}
async function resolveAdminBot(
  id: string,
  db: AccessDatabase,
  lock: boolean,
  allowCustomer: boolean,
) {
  const tenantId = await readTenantId();
  if (tenantId) {
    await initSchema();
    const [bot] =
      await db`SELECT * FROM bots WHERE id=${id} AND tenant_id=${tenantId}`;
    if (!bot) throw new OperationError("챗봇을 찾을 수 없습니다.", 404);
    if (lock && !bot.customer_id) {
      // During additive migration, tenant ownership still authorizes unassigned bots.
      await db`SELECT id FROM tenants WHERE id=${tenantId} FOR NO KEY UPDATE`;
      const [current] =
        await db`SELECT * FROM bots WHERE id=${id} AND tenant_id=${tenantId} FOR UPDATE`;
      if (!current) throw new OperationError("챗봇을 찾을 수 없습니다.", 404);
      if (current.customer_id)
        throw new OperationError(
          "챗봇 소속이 변경되었습니다. 다시 시도해주세요.",
          409,
        );
      return { bot: current, tenantId };
    }
    if (lock) {
      const user = await portalUser();
      await customerBot(
        db,
        user.id,
        String(bot.customer_id),
        id,
        "knowledge.manage",
        true,
      );
    }
    return { bot, tenantId };
  }
  if (!allowCustomer) throw new OperationError("Unauthorized", 401);
  const user = await portalUser();
  const [assigned] = await db`SELECT customer_id FROM bots WHERE id=${id}`;
  if (!assigned?.customer_id)
    throw new OperationError("챗봇을 찾을 수 없습니다.", 404);
  // customerBot verifies membership, permission and bot→customer→tenant ownership in one pass.
  const { bot, grant } = await customerBot(
    db,
    user.id,
    String(assigned.customer_id),
    id,
    "knowledge.manage",
    lock,
  );
  return { bot, tenantId: grant.tenant_id };
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
