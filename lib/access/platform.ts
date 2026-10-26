import { compare, hash } from "bcryptjs";
import type { AccessDatabase } from "./schema";
import { PortalError, email as normalizeEmail, password as validPassword, text } from "../customer-portal/validation";
import { isMasterHost } from "../master-host";

/**
 * Platform masters are common identities with users.is_platform_admin. They need no agency
 * workspace: a master may exist without legacy_tenant_id, and such a master can only sign in on
 * the master host. Agency owners flagged through ADMIN_EMAILS keep working during the transition.
 */
export async function platformReady(db: AccessDatabase) {
  const [r] = await db`SELECT to_regclass('users') AS users`;
  return Boolean(r?.users);
}

export async function createPlatformSchema(db: AccessDatabase) {
  await db`CREATE TABLE IF NOT EXISTS platform_audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    target_id TEXT,
    detail TEXT,
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
  )`;
}

export async function platformAudit(
  db: AccessDatabase,
  actorUserId: string | null,
  action: string,
  targetId: string | null,
  detail: string | null = null,
) {
  await db`INSERT INTO platform_audit_logs(id,actor_user_id,action,target_id,detail) VALUES(${crypto.randomUUID()},${actorUserId},${action},${targetId},${detail})`;
}

/** Live check for a session: the identity must still be an active platform master. */
export async function isPlatformAdminUser(db: AccessDatabase, userId: string) {
  if (!(await platformReady(db))) return false;
  const [u] =
    await db`SELECT 1 FROM users WHERE id=${userId} AND status='active' AND is_platform_admin=TRUE`;
  return Boolean(u);
}

/** Owner identity of a tenant session, if provisioned. */
export async function tenantOwnerIsPlatformAdmin(db: AccessDatabase, tenantId: string) {
  if (!(await platformReady(db))) return false;
  const [u] =
    await db`SELECT 1 FROM users WHERE legacy_tenant_id=${tenantId} AND status='active' AND is_platform_admin=TRUE`;
  return Boolean(u);
}

/** Tenantless master login: only on the master host, only for active flagged identities. */
export async function verifyPlatformCredentials(
  db: AccessDatabase,
  emailInput: string,
  passwordInput: string,
  host: string | null,
  ip = "unknown",
) {
  if (!isMasterHost(host)) return null;
  if (!(await platformReady(db))) return null;
  let address: string;
  try {
    address = normalizeEmail(emailInput);
  } catch {
    return null;
  }
  // Ten attempts per email+address per minute, like the customer login.
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address))),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const bucket = `master-login:${digest}:${ip}:${Math.floor(Date.now() / 60000)}`;
  const [rate] =
    await db`INSERT INTO api_rate_limits(bucket_key,request_count,expires_at) VALUES(${bucket},1,EXTRACT(EPOCH FROM NOW())::BIGINT+120) ON CONFLICT(bucket_key) DO UPDATE SET request_count=api_rate_limits.request_count+1 RETURNING request_count`;
  if (Number(rate.request_count) > 10) return null;
  const [user] =
    await db`SELECT id,name,email,password_hash,auth_version FROM users WHERE email=${address} AND status='active' AND is_platform_admin=TRUE AND legacy_tenant_id IS NULL`;
  if (!user?.password_hash || !(await compare(passwordInput, String(user.password_hash)))) return null;
  return {
    id: String(user.id),
    name: String(user.name),
    email: String(user.email),
    authVersion: Number(user.auth_version),
  };
}

export async function listPlatformAdmins(db: AccessDatabase) {
  if (!(await platformReady(db))) return [];
  return db`SELECT u.id,u.name,u.email,u.created_at,u.legacy_tenant_id,t.name AS tenant_name FROM users u LEFT JOIN tenants t ON t.id=u.legacy_tenant_id WHERE u.is_platform_admin=TRUE AND u.status='active' ORDER BY u.created_at,u.id`;
}

/**
 * Add a master. An existing verified identity gets the flag; otherwise a tenantless identity is
 * created with the initial password the acting master sets. Never creates an agency workspace.
 */
export async function addPlatformAdmin(
  db: AccessDatabase,
  actorUserId: string,
  input: Record<string, unknown>,
) {
  const address = normalizeEmail(input.email);
  const [actor] =
    await db`SELECT 1 FROM users WHERE id=${actorUserId} AND status='active' AND is_platform_admin=TRUE`;
  if (!actor) throw new PortalError("마스터 권한이 필요합니다.", 403);
  await db`SELECT pg_advisory_xact_lock(hashtextextended(${"identity:" + address},0))`;
  let [user] = await db`SELECT id,is_platform_admin,status FROM users WHERE email=${address} FOR UPDATE`;
  if (user) {
    if (user.status !== "active") throw new PortalError("비활성 계정입니다.", 409);
    if (user.is_platform_admin) throw new PortalError("이미 마스터입니다.", 409);
    await db`UPDATE users SET is_platform_admin=TRUE WHERE id=${user.id}`;
  } else {
    const [legacy] = await db`SELECT 1 FROM tenants WHERE lower(btrim(email))=${address}`;
    if (legacy)
      throw new PortalError("기존 에이전시 이메일입니다. 그 계정으로 먼저 로그인해 이관을 마쳐주세요.", 409);
    const name = text(input.name, "이름", 80),
      secret = validPassword(input.password);
    [user] =
      await db`INSERT INTO users(id,name,email,password_hash,email_verified_at,is_platform_admin) VALUES(${crypto.randomUUID()},${name},${address},${await hash(secret, 12)},EXTRACT(EPOCH FROM NOW())::BIGINT,TRUE) RETURNING id,is_platform_admin,status`;
  }
  await platformAudit(db, actorUserId, "master.add", String(user.id), address);
  return { id: String(user.id), email: address };
}

/** Remove a master. Never yourself, never the last one; the identity and any agency stay intact. */
export async function removePlatformAdmin(db: AccessDatabase, actorUserId: string, userId: string) {
  if (actorUserId === userId) throw new PortalError("자기 자신의 마스터 권한은 해제할 수 없습니다.", 400);
  const [actor] =
    await db`SELECT 1 FROM users WHERE id=${actorUserId} AND status='active' AND is_platform_admin=TRUE`;
  if (!actor) throw new PortalError("마스터 권한이 필요합니다.", 403);
  await db`SELECT pg_advisory_xact_lock(hashtextextended('platform-admins',0))`;
  const [count] =
    await db`SELECT count(*)::int AS n FROM users WHERE is_platform_admin=TRUE AND status='active'`;
  if (Number(count.n) <= 1) throw new PortalError("마지막 마스터는 해제할 수 없습니다.", 409);
  // A tenantless master's session is purely a platform session, so it ends; an agency owner keeps working.
  const changed =
    await db`UPDATE users SET is_platform_admin=FALSE,auth_version=CASE WHEN legacy_tenant_id IS NULL THEN auth_version+1 ELSE auth_version END WHERE id=${userId} AND is_platform_admin=TRUE RETURNING id,legacy_tenant_id`;
  if (!changed.length) throw new PortalError("마스터를 찾을 수 없습니다.", 404);
  if (changed[0].legacy_tenant_id)
    await db`UPDATE tenants SET is_admin=FALSE WHERE id=${changed[0].legacy_tenant_id}`;
  await platformAudit(db, actorUserId, "master.remove", userId);
}

/**
 * Deleting an agency is allowed only after it is deactivated and holds nothing but its own
 * provisioning rows; the console must send the agency name back as confirmation.
 */
export async function deleteEmptyTenant(
  db: AccessDatabase,
  actorUserId: string | null,
  tenantId: string,
  confirmName: unknown,
) {
  const [tenant] =
    await db`SELECT id,name,subscription_status FROM tenants WHERE id=${tenantId} FOR UPDATE`;
  if (!tenant) throw new PortalError("에이전시를 찾을 수 없습니다.", 404);
  if (tenant.subscription_status !== "inactive")
    throw new PortalError("먼저 구독을 중지(비활성)한 뒤 삭제할 수 있습니다.", 409);
  const same = (value: string) => value.normalize("NFC").trim();
  if (typeof confirmName !== "string" || same(confirmName) !== same(String(tenant.name)))
    throw new PortalError("확인을 위해 에이전시 이름을 정확히 입력해주세요.", 400);
  const [bots] = await db`SELECT count(*)::int AS n FROM bots WHERE tenant_id=${tenantId}`;
  if (Number(bots.n) > 0)
    throw new PortalError("챗봇이 남아 있는 에이전시는 삭제할 수 없습니다. 에이전시가 챗봇을 먼저 정리해야 합니다.", 409);
  if (await platformReady(db)) {
    const [extra] =
      await db`SELECT count(*)::int AS n FROM customers WHERE tenant_id=${tenantId} AND is_default=FALSE`;
    if (Number(extra.n) > 0)
      throw new PortalError("고객사가 남아 있는 에이전시는 삭제할 수 없습니다.", 409);
    const [members] =
      await db`SELECT count(*)::int AS n FROM customer_memberships m JOIN customers c ON c.id=m.customer_id WHERE c.tenant_id=${tenantId}`;
    if (Number(members.n) > 0)
      throw new PortalError("담당자 계정이 연결된 에이전시는 삭제할 수 없습니다.", 409);
    await db`DELETE FROM access_audit_logs WHERE tenant_id=${tenantId}`;
    await db`DELETE FROM customer_invitations WHERE customer_id IN (SELECT id FROM customers WHERE tenant_id=${tenantId})`;
    await db`DELETE FROM customers WHERE tenant_id=${tenantId}`;
    await db`DELETE FROM partner_memberships WHERE tenant_id=${tenantId}`;
    // The owner identity is detached, never deleted: other tables (reset tokens, messages, audit rows,
    // memberships in other agencies) may reference it. Identities with nothing left are disabled.
    await db`UPDATE users u SET legacy_tenant_id=NULL,auth_version=auth_version+1,
      status=CASE WHEN u.is_platform_admin OR EXISTS(SELECT 1 FROM customer_memberships m WHERE m.user_id=u.id AND m.status='active') THEN u.status ELSE 'disabled' END
      WHERE u.legacy_tenant_id=${tenantId}`;
  }
  await db`DELETE FROM tenants WHERE id=${tenantId}`;
  if (await platformReady(db))
    await platformAudit(db, actorUserId, "tenant.delete", tenantId, String(tenant.name));
}
