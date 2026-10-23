import { auth } from "@/auth";
import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import {
  resolveCustomerAccess,
  type CustomerGrant,
} from "@/lib/access/queries";
import type { Permission } from "@/lib/access/policy";
import { PortalError } from "./input";
export async function requireReady(db: AccessDatabase = sql) {
  const [r] =
    await db`SELECT to_regclass('users') AS users,to_regclass('customers') AS customers,to_regclass('customer_message_requests') AS messages`;
  if (!r.users || !r.customers || !r.messages)
    throw new PortalError(
      "고객사 기능의 데이터 준비가 필요합니다. 에이전시에 문의해주세요.",
      503,
    );
}
export async function portalUser() {
  const session = await auth();
  if (!session?.customer_user_id && !session?.tenant_id)
    throw new PortalError("로그인이 필요합니다.", 401);
  await requireReady();
  const [user] = session.customer_user_id
    ? await sql`SELECT id,name,email FROM users WHERE id=${session.customer_user_id} AND status='active' AND auth_version=${session.customer_auth_version ?? -1}`
    : await sql`SELECT u.id,u.name,u.email FROM users u JOIN partner_memberships p ON p.user_id=u.id AND p.tenant_id=${session.tenant_id!} AND p.status='active' WHERE u.legacy_tenant_id=${session.tenant_id!} AND u.status='active' AND (${session.agency_auth_version ?? null}::int IS NULL OR u.auth_version=${session.agency_auth_version ?? null})`;
  if (!user) throw new PortalError("사용할 수 있는 계정이 아닙니다.", 403);
  return {
    id: String(user.id),
    name: String(user.name),
    email: user.email ? String(user.email) : null,
  };
}
export async function customerAccess(
  customerId: string,
  permission: Permission = "support.read",
) {
  const user = await portalUser();
  const grant = await resolveCustomerAccess(
    sql,
    user.id,
    customerId,
    permission,
  );
  if (!grant) throw new PortalError("이 고객사에 접근할 수 없습니다.", 404);
  return { user, grant };
}
export async function agencyOwner() {
  const session = await auth();
  if (!session?.tenant_id || session.customer_user_id)
    throw new PortalError("에이전시 계정으로 로그인해주세요.", 403);
  const user = await portalUser();
  return { user, tenantId: session.tenant_id };
}
/** All portal mutations lock the customer before re-reading membership, including revocation. */
export async function lockAccess(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  permission: Permission,
): Promise<CustomerGrant> {
  await db`SELECT id FROM customers WHERE id=${customerId} FOR UPDATE`;
  const grant = await resolveCustomerAccess(db, userId, customerId, permission);
  if (!grant) throw new PortalError("고객사 권한이 변경되었습니다.", 403);
  return grant;
}
