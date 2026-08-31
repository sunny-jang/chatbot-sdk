import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { encrypt } from "@/lib/crypto";
import { normalizePlan } from "@/lib/plans";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await sql`DELETE FROM tenants WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, openai_api_key, plan, subscription_status, enterprise_bot_limit } = await req.json();

  if (plan !== undefined || subscription_status !== undefined || enterprise_bot_limit !== undefined) {
    const normalizedPlan = normalizePlan(plan);
    const status = subscription_status === "inactive" ? "inactive" : "active";
    const customLimit = normalizedPlan === "enterprise" && Number(enterprise_bot_limit) > 0
      ? Math.floor(Number(enterprise_bot_limit))
      : null;
    const rows = await sql`
      UPDATE tenants
      SET plan = ${normalizedPlan}, subscription_status = ${status}, enterprise_bot_limit = ${customLimit}
      WHERE id = ${id}
      RETURNING plan, subscription_status, enterprise_bot_limit
    `;
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  }

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  if (openai_api_key !== undefined) {
    const encryptedKey = openai_api_key ? encrypt(openai_api_key) : null;
    await sql`UPDATE tenants SET name = ${name}, openai_api_key = ${encryptedKey} WHERE id = ${id}`;
  } else {
    await sql`UPDATE tenants SET name = ${name} WHERE id = ${id}`;
  }
  return NextResponse.json({ ok: true });
}
