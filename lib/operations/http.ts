import { OperationError } from "./input";
export { OperationError, boundedText, jsonBody } from "./input";
import sql from "../neon";
import { initSchema } from "../db";
import { readTenantId } from "../auth";
import type { AccessDatabase } from "../access/schema";
import { portalUser } from "../customer-portal/auth";
import { customerBot } from "../customer-portal/bots";
import { resolveBotAccess } from "../access/queries";
import { PortalError } from "../customer-portal/input";

export async function adminBot(
  id: string,
  db: AccessDatabase = sql,
  lock = false,
  allowCustomer = false,
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
  try {
    const user = await portalUser(),
      grant = await resolveBotAccess(db, user.id, id, "knowledge.manage");
    if (!grant) throw new OperationError("챗봇을 찾을 수 없습니다.", 404);
    await customerBot(
      db,
      user.id,
      grant.customer_id,
      id,
      "knowledge.manage",
      lock,
    );
    const [bot] =
      await db`SELECT * FROM bots WHERE id=${id} AND customer_id=${grant.customer_id} AND tenant_id=${grant.tenant_id}`;
    if (!bot) throw new OperationError("챗봇을 찾을 수 없습니다.", 404);
    return { bot, tenantId: grant.tenant_id };
  } catch (e) {
    if (e instanceof PortalError) throw new OperationError(e.message, e.status);
    throw e;
  }
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
