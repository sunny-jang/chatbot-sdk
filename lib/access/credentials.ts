import { compare } from "bcryptjs";
import type { AccessDatabase } from "./schema";

/** Tables never disappear once created, so one positive probe is enough per process. */
let usersTableReady: boolean | null = null;
async function usersReady(db: AccessDatabase) {
  if (usersTableReady) return true;
  const [row] = await db`SELECT to_regclass('users') AS users`;
  usersTableReady = Boolean(row.users);
  return usersTableReady;
}

/**
 * Agency email login checks the common identity's password when the owner's users row exists
 * (so a reset through the customer portal applies everywhere) and falls back to the legacy
 * tenants.password_hash only before migration. Disabled identities never log in.
 */
export async function verifyAgencyCredentials(
  db: AccessDatabase,
  email: string,
  password: string,
) {
  const address = email.trim();
  if (!address || !password || password.length > 200) return null;
  // Exact legacy match first; the normalized match is used only when it is unambiguous.
  const candidates =
    await db`SELECT id,name,email,password_hash FROM tenants WHERE lower(btrim(email))=${address.toLowerCase()} ORDER BY created_at,id`;
  const tenant =
    candidates.find((row) => row.email === address) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (!tenant) return null;
  let hash: string | null = tenant.password_hash ? String(tenant.password_hash) : null,
    userId: string | null = null,
    authVersion: number | null = null;
  if (await usersReady(db)) {
    const [user] =
      await db`SELECT id,password_hash,auth_version,status FROM users WHERE legacy_tenant_id=${tenant.id}`;
    if (user) {
      if (user.status !== "active") return null;
      if (user.password_hash) hash = String(user.password_hash);
      userId = String(user.id);
      authVersion = Number(user.auth_version);
    }
  }
  if (!hash || !(await compare(password, hash))) return null;
  return {
    tenantId: String(tenant.id),
    name: String(tenant.name),
    email: tenant.email ? String(tenant.email) : null,
    userId,
    authVersion,
  };
}

/**
 * Every agency request re-checks the live identity: the owner's users row must be active with an
 * active partner membership, and a session issued before a password reset (auth_version bump) is
 * rejected. Before migration there is no users table and the tenant session stands on its own.
 */
export async function agencySessionValid(
  db: AccessDatabase,
  tenantId: string,
  authVersion: number | null,
) {
  if (!(await usersReady(db))) return true;
  const [user] =
    await db`SELECT u.auth_version,u.status,p.status AS membership FROM users u LEFT JOIN partner_memberships p ON p.user_id=u.id AND p.tenant_id=${tenantId} AND p.status='active' WHERE u.legacy_tenant_id=${tenantId}`;
  // A tenant that was never provisioned (no users row yet) keeps working until its first provisioning.
  if (!user) return true;
  if (user.status !== "active" || !user.membership) return false;
  return authVersion === null || Number(user.auth_version) === authVersion;
}
