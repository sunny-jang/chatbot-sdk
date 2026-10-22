import { randomUUID } from "node:crypto";
import type { AccessDatabase } from "../access/schema";
import { resolveCustomerAccess } from "../access/queries";
import { PortalError, text, website } from "./input";
export async function updateCustomer(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  input: Record<string, unknown>,
) {
  const [c] =
    await db`SELECT c.id,c.tenant_id,c.status FROM customers c WHERE c.id=${customerId} FOR UPDATE`;
  if (!c) throw new PortalError("고객사를 찾을 수 없습니다.", 404);
  const [owner] =
    await db`SELECT 1 FROM users u JOIN partner_memberships p ON p.user_id=u.id WHERE u.id=${userId} AND u.status='active' AND p.tenant_id=${c.tenant_id} AND p.status='active'`;
  const grant =
    owner ||
    (await resolveCustomerAccess(db, userId, customerId, "customer.update"));
  if (!grant) throw new PortalError("고객사를 찾을 수 없습니다.", 404);
  if (
    input.status !== undefined &&
    !["active", "inactive"].includes(String(input.status))
  )
    throw new PortalError("상태를 확인해주세요.");
  if (input.status !== undefined && !owner)
    throw new PortalError("활성 상태는 에이전시에서 변경할 수 있습니다.", 403);
  const name =
    input.name === undefined ? null : text(input.name, "고객사 이름");
  const site = input.website === undefined ? undefined : website(input.website);
  if (input.status === "inactive" && c.status !== "inactive") {
    const [busy] =
      await db`SELECT EXISTS(SELECT 1 FROM bots WHERE customer_id=${customerId}) AS bots,
      EXISTS(SELECT 1 FROM customer_memberships WHERE customer_id=${customerId} AND status='active') AS members,
      EXISTS(SELECT 1 FROM support_handoffs h JOIN bots b ON b.id=h.bot_id WHERE b.customer_id=${customerId} AND h.status<>'closed') AS support`;
    if (busy.bots || busy.members || busy.support)
      throw new PortalError(
        "연결된 챗봇·활성 담당자·미완료 상담을 정리한 뒤 비활성화해주세요.",
        409,
      );
    await db`UPDATE customer_invitations SET status='revoked' WHERE customer_id=${customerId} AND status='pending'`;
  }
  await db`UPDATE customers SET name=COALESCE(${name},name),website=CASE WHEN ${site !== undefined} THEN ${site ?? null} ELSE website END,status=COALESCE(${input.status === undefined ? null : String(input.status)},status) WHERE id=${customerId}`;
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${userId},${c.tenant_id},${customerId},'customer.update',${customerId},'success')`;
}
/** Record only a scoped denial; never persist request payloads, passwords or invitation tokens. */
export async function recordDenied(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  action: string,
) {
  const grant = await resolveCustomerAccess(
    db,
    userId,
    customerId,
    "customer.read",
  );
  if (!grant) return;
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${userId},${grant.tenant_id},${customerId},${action},${customerId},'denied')`;
}
