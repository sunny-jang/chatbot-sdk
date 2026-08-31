import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import AdminClient from "./AdminClient";

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
};

export default async function AdminPage() {
  await initSchema();
  const tenants = (await sql`
    SELECT t.id, t.name, t.api_key, t.created_at, t.plan,
           t.subscription_status, t.enterprise_bot_limit,
           COUNT(b.id)::int AS bot_count
    FROM tenants t
    LEFT JOIN bots b ON b.tenant_id = t.id
    GROUP BY t.id, t.name, t.api_key, t.created_at, t.plan,
             t.subscription_status, t.enterprise_bot_limit
    ORDER BY t.created_at DESC
  `) as unknown as TenantRow[];

  return <AdminClient initialTenants={tenants} />;
}
