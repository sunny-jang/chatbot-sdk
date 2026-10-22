import { PortalError, failure } from "@/lib/customer-portal/input";
import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema, Bot } from "@/lib/db";
import { randomUUID } from "crypto";
import { getBotLimit, normalizePlan, PLAN_CONFIG } from "@/lib/plans";
import { readTenantId } from "@/lib/auth";

async function getTenantId() {
  return (await readTenantId()) ?? null;
}

export async function GET() {
  await initSchema();
  const tenantId = await getTenantId();
  if (!tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows =
    await sql`SELECT * FROM bots WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`;
  return NextResponse.json(rows as unknown as Bot[]);
}

export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await initSchema();
    const { name, type, system_prompt, model, customer_id } = await req.json();
    if (!name || !type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 },
      );
    }
    const tenantRows = await sql`
    SELECT plan, subscription_status, enterprise_bot_limit
    FROM tenants WHERE id = ${tenantId}
  `;
    const tenant = tenantRows[0] as
      | {
          plan?: string;
          subscription_status?: string;
          enterprise_bot_limit?: number | null;
        }
      | undefined;
    if (!tenant)
      return NextResponse.json(
        { error: "계정을 찾을 수 없습니다." },
        { status: 404 },
      );
    if (tenant.subscription_status !== "active") {
      return NextResponse.json(
        {
          error: "구독이 비활성 상태입니다. 관리자에게 문의해주세요.",
          code: "SUBSCRIPTION_INACTIVE",
        },
        { status: 403 },
      );
    }

    const plan = normalizePlan(tenant.plan);
    const limit = getBotLimit(plan, tenant.enterprise_bot_limit);
    const countRows =
      await sql`SELECT COUNT(*)::int AS count FROM bots WHERE tenant_id = ${tenantId}`;
    const current = Number(countRows[0]?.count ?? 0);

    if (limit === null) {
      return NextResponse.json(
        {
          error:
            "엔터프라이즈 챗봇 한도가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.",
          code: "ENTERPRISE_LIMIT_NOT_SET",
          plan,
          current,
        },
        { status: 409 },
      );
    }
    if (current >= limit) {
      return NextResponse.json(
        {
          error: `${PLAN_CONFIG[plan].name} 플랜은 챗봇을 최대 ${limit}개까지 만들 수 있습니다.`,
          code: "BOT_LIMIT_REACHED",
          plan,
          limit,
          current,
        },
        { status: 409 },
      );
    }

    const [schema] = await sql`SELECT to_regclass('customers') AS customers`;
    let customerId: string | null = null;
    if (schema.customers) {
      const rows = customer_id
        ? await sql`SELECT id FROM customers WHERE id=${String(customer_id)} AND tenant_id=${tenantId} AND status='active'`
        : await sql`SELECT id FROM customers WHERE tenant_id=${tenantId} AND is_default=TRUE AND status='active'`;
      if (customer_id && !rows[0])
        return NextResponse.json(
          { error: "고객사를 확인해주세요." },
          { status: 404 },
        );
      customerId = rows[0] ? String(rows[0].id) : null;
    } else if (customer_id)
      return NextResponse.json(
        { error: "고객사 기능의 데이터 준비가 필요합니다." },
        { status: 503 },
      );
    const id = randomUUID();
    const rows = await sql.begin(async (tx) => {
      const [currentTenant] =
        await tx`SELECT plan,subscription_status,enterprise_bot_limit FROM tenants WHERE id=${tenantId} FOR NO KEY UPDATE`;
      if (!currentTenant || currentTenant.subscription_status !== "active")
        throw new PortalError("구독 상태를 확인해주세요.", 403);
      const currentLimit = getBotLimit(
        normalizePlan(currentTenant.plan),
        currentTenant.enterprise_bot_limit,
      );
      const [total] =
        await tx`SELECT count(*)::int AS count FROM bots WHERE tenant_id=${tenantId}`;
      if (currentLimit === null || Number(total.count) >= currentLimit)
        throw new PortalError("챗봇 한도에 도달했습니다.", 403);
      if (schema.customers) {
        if (!customerId)
          throw new PortalError("활성 고객사를 선택해주세요.", 409);
        const [customer] =
          await tx`SELECT id FROM customers WHERE id=${customerId} AND tenant_id=${tenantId} AND status='active' FOR UPDATE`;
        if (!customer)
          throw new PortalError("활성 고객사를 확인해주세요.", 404);
      }
      const inserted = await tx`
    INSERT INTO bots (id, tenant_id, name, type, system_prompt, model, public_token)
    VALUES (${id}, ${tenantId}, ${name}, ${type}, ${system_prompt ?? null}, ${model ?? "gpt-4o-mini"}, ${`ibt-${randomUUID().replaceAll("-", "")}`})
    RETURNING *
  `;
      if (schema.customers)
        await tx`UPDATE bots SET customer_id=${customerId} WHERE id=${id}`;
      return inserted;
    });
    return NextResponse.json(rows[0] as unknown as Bot, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
