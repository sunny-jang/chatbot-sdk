import type { AccessDatabase } from "./schema";
import { provisionAgencyOwner } from "./provision";
import { PortalError, email, text } from "../customer-portal/validation";

/** Short reasons the login page can explain without leaking which accounts exist. */
export type GoogleIdentityReason =
  | "unverified"
  | "migration"
  | "verify_existing"
  | "legacy_email"
  | "no_invitation"
  | "disabled"
  | "other_google";
export class GoogleIdentityError extends PortalError {
  constructor(
    public reason: GoogleIdentityReason,
    message: string,
    status: number,
  ) {
    super(message, status);
  }
}
export const GOOGLE_IDENTITY_MESSAGES: Record<GoogleIdentityReason, string> = {
  unverified: "검증된 Google 이메일이 필요합니다.",
  migration: "계정 이관을 먼저 완료해주세요.",
  verify_existing:
    "기존 계정으로 로그인하고 이메일 확인을 마친 뒤 Google을 연결해주세요.",
  legacy_email: "기존 에이전시 계정으로 로그인한 뒤 계정 이관을 확인해주세요.",
  no_invitation: "초대받은 Google 계정으로 로그인해주세요.",
  disabled: "사용할 수 없는 계정입니다.",
  other_google: "다른 Google 계정이 이미 연결되어 있습니다.",
};
export function isGoogleIdentityReason(
  value: unknown,
): value is GoogleIdentityReason {
  return typeof value === "string" && Object.hasOwn(GOOGLE_IDENTITY_MESSAGES, value);
}
const fail = (reason: GoogleIdentityReason, status: number) =>
  new GoogleIdentityError(reason, GOOGLE_IDENTITY_MESSAGES[reason], status);

export type GoogleProfile = {
  subject: string;
  email: string;
  name: string;
  verified: boolean;
};

/**
 * Receives only the server-validated OAuth profile, never a browser-supplied identity.
 * Resolution order: linked subject → legacy tenant subject → verified email → new identity.
 * Unverified same-email users and legacy tenant emails are never merged silently.
 * `customerOnly` creates an identity only for a pending invitation and never a workspace.
 */
export async function googleIdentity(
  db: AccessDatabase,
  profile: GoogleProfile,
  customerOnly: boolean,
) {
  if (profile.verified !== true) throw fail("unverified", 403);
  const address = email(profile.email),
    subject = text(profile.subject, "Google 계정", 300),
    name = text(profile.name || address, "이름", 80);
  await db`SELECT pg_advisory_xact_lock(hashtextextended(${"google:" + subject},0))`;
  await db`SELECT pg_advisory_xact_lock(hashtextextended(${"identity:" + address},0))`;
  const [ready] =
    await db`SELECT to_regclass('user_accounts') AS accounts,to_regclass('customers') AS customers`;
  if (!ready.accounts || !ready.customers) throw fail("migration", 503);
  let [user] =
    await db`SELECT u.* FROM user_accounts a JOIN users u ON u.id=a.user_id WHERE a.provider='google' AND a.provider_subject=${subject} FOR UPDATE OF u`;
  if (!user) {
    const [legacy] =
      await db`SELECT id FROM tenants WHERE oauth_provider='google' AND oauth_sub=${subject}`;
    if (legacy) {
      await provisionAgencyOwner(db, String(legacy.id));
      [user] =
        await db`SELECT * FROM users WHERE legacy_tenant_id=${legacy.id} FOR UPDATE`;
    }
  }
  if (!user) {
    [user] = await db`SELECT * FROM users WHERE email=${address} FOR UPDATE`;
    if (user && !user.email_verified_at) throw fail("verify_existing", 409);
  }
  if (!user) {
    const [legacyEmail] =
      await db`SELECT id FROM tenants WHERE lower(btrim(email))=${address}`;
    if (legacyEmail) throw fail("legacy_email", 409);
    if (customerOnly) {
      const [invite] =
        await db`SELECT i.id FROM customer_invitations i JOIN customers c ON c.id=i.customer_id WHERE i.email=${address} AND i.status='pending' AND i.expires_at>EXTRACT(EPOCH FROM NOW()) AND c.status='active' LIMIT 1`;
      if (!invite) throw fail("no_invitation", 403);
      [user] =
        await db`INSERT INTO users(id,name,email,email_verified_at) VALUES(${crypto.randomUUID()},${name},${address},EXTRACT(EPOCH FROM NOW())::bigint) RETURNING *`;
    } else {
      const tenantId = crypto.randomUUID();
      await db`INSERT INTO tenants(id,name,email,api_key,oauth_provider,oauth_sub) VALUES(${tenantId},${name},${address},${"iai-" + crypto.randomUUID().replace(/-/g, "")},'google',${subject})`;
      await provisionAgencyOwner(db, tenantId);
      [user] =
        await db`SELECT * FROM users WHERE legacy_tenant_id=${tenantId} FOR UPDATE`;
    }
  }
  if (!user || user.status !== "active") throw fail("disabled", 403);
  const [linked] =
    await db`SELECT provider_subject FROM user_accounts WHERE user_id=${user.id} AND provider='google'`;
  if (linked && linked.provider_subject !== subject)
    throw fail("other_google", 409);
  await db`INSERT INTO user_accounts(provider,provider_subject,user_id) VALUES('google',${subject},${user.id}) ON CONFLICT DO NOTHING`;
  await db`UPDATE users SET email_verified_at=COALESCE(email_verified_at,EXTRACT(EPOCH FROM NOW())::bigint) WHERE id=${user.id}`;
  const [owner] = user.legacy_tenant_id
    ? await db`SELECT tenant_id FROM partner_memberships WHERE user_id=${user.id} AND status='active' AND tenant_id=${user.legacy_tenant_id}`
    : [];
  return {
    id: String(user.id),
    name: String(user.name),
    email: String(user.email),
    authVersion: Number(user.auth_version),
    tenantId: owner ? String(owner.tenant_id) : null,
  };
}
