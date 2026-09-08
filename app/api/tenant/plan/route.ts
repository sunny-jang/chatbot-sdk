import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { getBotLimit, getMonthlySessionLimit, normalizePlan, PLAN_CONFIG } from "@/lib/plans";
import { getMonthlySessionUsage } from "@/lib/monthlyUsage";

export async function GET() {
  const jar = await cookies();
  const tenantId = jar.get("tenant_id")?.value;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initSchema();
  const rows = await sql`
    SELECT t.plan, t.subscription_status, t.enterprise_bot_limit, t.enterprise_monthly_session_limit,
           COUNT(b.id)::int AS bot_count
    FROM tenants t
    LEFT JOIN bots b ON b.tenant_id = t.id
    WHERE t.id = ${tenantId}
    GROUP BY t.id, t.plan, t.subscription_status, t.enterprise_bot_limit, t.enterprise_monthly_session_limit
  `;
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const plan = normalizePlan(rows[0].plan);
  const limit = getBotLimit(plan, rows[0].enterprise_bot_limit as number | null);
  const monthlyLimit = getMonthlySessionLimit(plan, rows[0].enterprise_monthly_session_limit as number | null);
  const monthlyUsage = monthlyLimit === null ? null : await getMonthlySessionUsage(tenantId, monthlyLimit);
  return NextResponse.json({
    plan,
    plan_name: PLAN_CONFIG[plan].name,
    subscription_status: rows[0].subscription_status,
    enterprise_bot_limit: rows[0].enterprise_bot_limit,
    bot_count: Number(rows[0].bot_count ?? 0),
    bot_limit: limit,
    monthly_session_usage: monthlyUsage,
  });
}
