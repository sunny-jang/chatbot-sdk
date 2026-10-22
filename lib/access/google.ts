import { randomUUID } from 'node:crypto';
import type { AccessDatabase } from './schema';
import { provisionAgencyOwner } from './provision';
import { PortalError, email, text } from '../customer-portal/input';

/** Receives only the server-validated OAuth profile, never a browser-supplied identity. */
export async function googleIdentity(db: AccessDatabase, profile: {
  subject: string; email: string; name: string; verified: boolean;
}, customerOnly: boolean) {
  if (profile.verified !== true) throw new PortalError('검증된 Google 이메일이 필요합니다.', 403);
  const address = email(profile.email), subject = text(profile.subject, 'Google 계정', 300);
  await db`SELECT pg_advisory_xact_lock(hashtextextended(${"google:" + subject},0))`;
  await db`SELECT pg_advisory_xact_lock(hashtextextended(${"identity:" + address},0))`;
  const [ready] = await db`SELECT to_regclass('user_accounts') AS accounts`;
  if (!ready.accounts) throw new PortalError('계정 이관을 먼저 완료해주세요.', 503);
  let [user] = await db`SELECT u.* FROM user_accounts a JOIN users u ON u.id=a.user_id WHERE a.provider='google' AND a.provider_subject=${subject} FOR UPDATE OF u`;
  if (!user) {
    const [legacy] = await db`SELECT id FROM tenants WHERE oauth_provider='google' AND oauth_sub=${subject}`;
    if (legacy) {
      await provisionAgencyOwner(db, String(legacy.id));
      [user] = await db`SELECT * FROM users WHERE legacy_tenant_id=${legacy.id} FOR UPDATE`;
    }
  }
  if (!user) {
    [user] = await db`SELECT * FROM users WHERE email=${address} FOR UPDATE`;
    if (user && !user.email_verified_at)
      throw new PortalError('기존 계정으로 로그인하고 이메일 확인을 마친 뒤 Google을 연결해주세요.', 409);
  }
  if (!user) {
    const [legacyEmail] = await db`SELECT id FROM tenants WHERE lower(btrim(email))=${address}`;
    if (legacyEmail) throw new PortalError('기존 계정으로 로그인하고 계정 이관을 확인해주세요.',409);
    if (customerOnly) {
      const [invite] = await db`SELECT i.id FROM customer_invitations i JOIN customers c ON c.id=i.customer_id WHERE i.email=${address} AND i.status='pending' AND i.expires_at>EXTRACT(EPOCH FROM NOW()) AND c.status='active' LIMIT 1`;
      if (!invite) throw new PortalError('초대받은 Google 계정으로 로그인해주세요.',403);
      [user] = await db`INSERT INTO users(id,name,email,email_verified_at) VALUES(${randomUUID()},${text(profile.name || address,'이름',80)},${address},EXTRACT(EPOCH FROM NOW())::bigint) RETURNING *`;
    } else {
      const tenantId = randomUUID();
      await db`INSERT INTO tenants(id,name,email,api_key,oauth_provider,oauth_sub) VALUES(${tenantId},${text(profile.name || address,'이름',80)},${address},${'iai-'+randomUUID().replace(/-/g,'')},'google',${subject})`;
      await provisionAgencyOwner(db,tenantId);
      [user] = await db`SELECT * FROM users WHERE legacy_tenant_id=${tenantId} FOR UPDATE`;
    }
  }
  if (!user || user.status !== 'active') throw new PortalError('사용할 수 없는 계정입니다.',403);
  const [linked] = await db`SELECT provider_subject FROM user_accounts WHERE user_id=${user.id} AND provider='google'`;
  if (linked && linked.provider_subject !== subject) throw new PortalError('다른 Google 계정이 이미 연결되어 있습니다.',409);
  await db`INSERT INTO user_accounts(provider,provider_subject,user_id) VALUES('google',${subject},${user.id}) ON CONFLICT DO NOTHING`;
  await db`UPDATE users SET email_verified_at=COALESCE(email_verified_at,EXTRACT(EPOCH FROM NOW())::bigint) WHERE id=${user.id}`;
  const [owner] = await db`SELECT p.tenant_id FROM partner_memberships p WHERE p.user_id=${user.id} AND p.status='active' AND p.tenant_id=${user.legacy_tenant_id ?? null}`;
  return { id:String(user.id), name:String(user.name), email:String(user.email), authVersion:Number(user.auth_version), tenantId:owner ? String(owner.tenant_id) : null };
}
