import { randomUUID } from "node:crypto";
import type { AccessDatabase } from "./schema";
import { normalizeIdentityEmail } from "./policy";

type LegacyTenant = {
  id: string;
  name: string;
  email: string | null;
  password_hash: string | null;
  oauth_provider: string | null;
  oauth_sub: string | null;
  is_admin: boolean | null;
};
export type MigrationCheck = { code: string; count: number };
export class MigrationBlocked extends Error {
  constructor(public readonly checks: MigrationCheck[]) {
    super(
      "이관 사전 검사 실패: " +
        checks.map((c) => `${c.code}=${c.count}`).join(", "),
    );
  }
}

export function inspectLegacyIdentities(
  tenants: readonly LegacyTenant[],
): MigrationCheck[] {
  const emails = new Map<string, number>(),
    accounts = new Map<string, number>();
  let incomplete = 0;
  for (const row of tenants) {
    if (row.email?.trim()) {
      const key = normalizeIdentityEmail(row.email);
      emails.set(key, (emails.get(key) ?? 0) + 1);
    }
    if (Boolean(row.oauth_provider) !== Boolean(row.oauth_sub)) incomplete++;
    if (row.oauth_provider && row.oauth_sub) {
      const key = JSON.stringify([row.oauth_provider, row.oauth_sub]);
      accounts.set(key, (accounts.get(key) ?? 0) + 1);
    }
  }
  return [
    {
      code: "normalized_email_conflicts",
      count: [...emails.values()].filter((n) => n > 1).length,
    },
    {
      code: "oauth_subject_conflicts",
      count: [...accounts.values()].filter((n) => n > 1).length,
    },
    { code: "incomplete_oauth_links", count: incomplete },
  ].filter((c) => c.count > 0);
}

/** Read-only preflight. Does not emit email, hashes, keys, or raw account records. */
export async function inspectAccessMigration(db: AccessDatabase) {
  const tenants = await db<LegacyTenant[]>`
    SELECT id,name,email,password_hash,oauth_provider,oauth_sub,is_admin FROM tenants ORDER BY id`;
  const checks = inspectLegacyIdentities(tenants);
  const [orphans] = await db`SELECT count(*)::int AS count FROM bots b
    LEFT JOIN tenants t ON t.id = b.tenant_id WHERE t.id IS NULL`;
  if (Number(orphans.count))
    checks.push({ code: "orphan_bots", count: Number(orphans.count) });
  return { tenants, checks };
}

/** Must run inside the CLI transaction and advisory lock. Never called from login. */
export async function migrateLegacyAccess(db: AccessDatabase) {
  const { tenants, checks } = await inspectAccessMigration(db);
  if (checks.length) throw new MigrationBlocked(checks);
  let usersCreated = 0,
    customersCreated = 0,
    botsLinked = 0;
  for (const tenant of tenants) {
    const email = tenant.email?.trim()
      ? normalizeIdentityEmail(tenant.email)
      : null;
    const [conflict] = email
      ? await db`SELECT id FROM users
      WHERE email=${email} AND legacy_tenant_id IS DISTINCT FROM ${tenant.id}`
      : [];
    if (conflict)
      throw new MigrationBlocked([
        { code: "existing_user_email_conflict", count: 1 },
      ]);
    let [user] =
      await db`SELECT id FROM users WHERE legacy_tenant_id=${tenant.id}`;
    if (!user) {
      [user] =
        await db`INSERT INTO users(id,legacy_tenant_id,name,email,password_hash,is_platform_admin)
        VALUES(${randomUUID()},${tenant.id},${tenant.name},${email},${tenant.password_hash},${tenant.is_admin === true})
        RETURNING id`;
      usersCreated++;
    }
    // Existing credentials, verification, role revocations and profile edits are never overwritten on re-run.
    if (tenant.oauth_provider && tenant.oauth_sub) {
      const [account] = await db`SELECT user_id FROM user_accounts
        WHERE provider=${tenant.oauth_provider} AND provider_subject=${tenant.oauth_sub}`;
      if (account && account.user_id !== user.id) {
        throw new MigrationBlocked([
          { code: "existing_oauth_owner_conflict", count: 1 },
        ]);
      }
      const [existingProvider] =
        await db`SELECT provider_subject FROM user_accounts
        WHERE user_id=${user.id} AND provider=${tenant.oauth_provider}`;
      if (
        existingProvider &&
        existingProvider.provider_subject !== tenant.oauth_sub
      ) {
        throw new MigrationBlocked([
          { code: "existing_user_provider_conflict", count: 1 },
        ]);
      }
      await db`INSERT INTO user_accounts(provider,provider_subject,user_id)
        VALUES(${tenant.oauth_provider},${tenant.oauth_sub},${user.id}) ON CONFLICT DO NOTHING`;
    }
    const [owner] = await db`SELECT user_id FROM partner_memberships
      WHERE tenant_id=${tenant.id} AND status='active'`;
    if (owner && owner.user_id !== user.id)
      throw new MigrationBlocked([
        { code: "existing_partner_owner_conflict", count: 1 },
      ]);
    await db`INSERT INTO partner_memberships(tenant_id,user_id)
      VALUES(${tenant.id},${user.id}) ON CONFLICT DO NOTHING`;
    let [customer] =
      await db`SELECT id FROM customers WHERE tenant_id=${tenant.id} AND is_default=TRUE`;
    if (!customer) {
      [customer] = await db`INSERT INTO customers(id,tenant_id,name,is_default)
        VALUES(${randomUUID()},${tenant.id},'우리 회사',TRUE) RETURNING id`;
      customersCreated++;
    }
    const bots = await db`UPDATE bots SET customer_id=${customer.id}
      WHERE tenant_id=${tenant.id} AND customer_id IS NULL RETURNING id`;
    botsLinked += bots.length;
  }
  return {
    tenantsInspected: tenants.length,
    usersCreated,
    customersCreated,
    botsLinked,
  };
}
