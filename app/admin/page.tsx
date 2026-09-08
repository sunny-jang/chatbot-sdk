import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import AdminClient from "./AdminClient";
import { getMonthlySessionLimit, normalizePlan } from "@/lib/plans";
import { getMonthlySessionUsage } from "@/lib/monthlyUsage";

export const dynamic = "force-dynamic";

type TenantRow = {
  id: string;
  name: string;
  api_key: string;
  created_at: number;
  bot_count: number;
  plan: "starter" | "growth" | "pro" | "enterprise";
  subscription_status: "active" | "inactive";
  enterprise_bot_limit: number | null;
  enterprise_monthly_session_limit: number | null;
  monthly_session_count: number;
};

export default async function AdminPage() {
  await initSchema();
  const tenantRows = (await sql`
    SELECT t.id, t.name, t.api_key, t.created_at, t.plan,
           t.subscription_status, t.enterprise_bot_limit, t.enterprise_monthly_session_limit,
           COUNT(b.id)::int AS bot_count
    FROM tenants t
    LEFT JOIN bots b ON b.tenant_id = t.id
    GROUP BY t.id, t.name, t.api_key, t.created_at, t.plan,
             t.subscription_status, t.enterprise_bot_limit, t.enterprise_monthly_session_limit
    ORDER BY t.created_at DESC
  `) as unknown as Omit<TenantRow, "monthly_session_count">[];

  const tenants = await Promise.all(tenantRows.map(async (tenant) => {
    const plan = normalizePlan(tenant.plan);
    const limit = getMonthlySessionLimit(plan, tenant.enterprise_monthly_session_limit);
    const usage = limit === null ? null : await getMonthlySessionUsage(tenant.id, limit);
    return { ...tenant, monthly_session_count: usage?.used ?? 0 };
  }));

  return <AdminClient initialTenants={tenants} />;
}
