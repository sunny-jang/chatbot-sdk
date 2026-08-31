import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { initSchema, Bot } from "@/lib/db";
import { randomUUID } from "crypto";
import { getBotLimit, normalizePlan, PLAN_CONFIG } from "@/lib/plans";

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

export async function GET() {
  await initSchema();
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await sql`SELECT * FROM bots WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`;
  return NextResponse.json(rows as unknown as Bot[]);
}

export async function POST(req: Request) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initSchema();
  const { name, type, system_prompt, model } = await req.json();
  if (!name || !type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }
  const tenantRows = await sql`
    SELECT plan, subscription_status, enterprise_bot_limit
    FROM tenants WHERE id = ${tenantId}
  `;
  const tenant = tenantRows[0] as {
    plan?: string;
    subscription_status?: string;
    enterprise_bot_limit?: number | null;
  } | undefined;
  if (!tenant) return NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
  if (tenant.subscription_status !== "active") {
    return NextResponse.json({
      error: "구독이 비활성 상태입니다. 관리자에게 문의해주세요.",
      code: "SUBSCRIPTION_INACTIVE",
    }, { status: 403 });
  }

  const plan = normalizePlan(tenant.plan);
  const limit = getBotLimit(plan, tenant.enterprise_bot_limit);
  const countRows = await sql`SELECT COUNT(*)::int AS count FROM bots WHERE tenant_id = ${tenantId}`;
  const current = Number(countRows[0]?.count ?? 0);

  if (limit === null) {
    return NextResponse.json({
      error: "엔터프라이즈 챗봇 한도가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.",
      code: "ENTERPRISE_LIMIT_NOT_SET",
      plan,
      current,
    }, { status: 409 });
  }
  if (current >= limit) {
    return NextResponse.json({
      error: `${PLAN_CONFIG[plan].name} 플랜은 챗봇을 최대 ${limit}개까지 만들 수 있습니다.`,
      code: "BOT_LIMIT_REACHED",
      plan,
      limit,
      current,
    }, { status: 409 });
  }

  const id = randomUUID();
  const rows = await sql`
    INSERT INTO bots (id, tenant_id, name, type, system_prompt, model)
    VALUES (${id}, ${tenantId}, ${name}, ${type}, ${system_prompt ?? null}, ${model ?? "gpt-4o-mini"})
    RETURNING *
  `;
  return NextResponse.json(rows[0] as unknown as Bot, { status: 201 });
}
