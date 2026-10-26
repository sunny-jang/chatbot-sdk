import type { AccessDatabase } from "./schema";
/** Additive provisioning for normal agency signups after the explicit schema migration. No DDL or identity merging. */
export async function provisionAgencyOwner(
  db: AccessDatabase,
  tenantId: string,
) {
  const [ready] =
    await db`SELECT to_regclass('users') AS users,to_regclass('customers') AS customers`;
  if (!ready.users || !ready.customers) return;
  const [tenant] =
    await db`SELECT id,name,email,password_hash,is_admin,oauth_provider,oauth_sub FROM tenants WHERE id=${tenantId} FOR UPDATE`;
  if (!tenant) throw new Error("Workspace missing");
  let [user] =
    await db`SELECT id FROM users WHERE legacy_tenant_id=${tenantId}`;
  if (!user) {
    const address = tenant.email
      ? String(tenant.email).trim().toLowerCase()
      : null;
    const [conflict] = address
      ? await db`SELECT id FROM users WHERE email=${address}`
      : [];
    if (conflict)
      throw new Error(
        "Identity already exists; account linking requires verification",
      );
    [user] =
      await db`INSERT INTO users(id,legacy_tenant_id,name,email,password_hash,is_platform_admin) VALUES(${crypto.randomUUID()},${tenantId},${tenant.name},${address},${tenant.password_hash},${tenant.is_admin === true}) RETURNING id`;
  }
  await db`INSERT INTO partner_memberships(tenant_id,user_id) VALUES(${tenantId},${user.id}) ON CONFLICT DO NOTHING`;
  const [defaultCustomer] =
    await db`SELECT id FROM customers WHERE tenant_id=${tenantId} AND is_default=TRUE`;
  if (!defaultCustomer)
    await db`INSERT INTO customers(id,tenant_id,name,is_default) VALUES(${crypto.randomUUID()},${tenantId},'우리 회사',TRUE)`;
  if (tenant.oauth_provider && tenant.oauth_sub) {
    const [other] =
      await db`SELECT user_id FROM user_accounts WHERE provider=${tenant.oauth_provider} AND provider_subject=${tenant.oauth_sub}`;
    if (other && other.user_id !== user.id)
      throw new Error("OAuth identity conflict");
    await db`INSERT INTO user_accounts(provider,provider_subject,user_id) VALUES(${tenant.oauth_provider},${tenant.oauth_sub},${user.id}) ON CONFLICT DO NOTHING`;
  }
}
