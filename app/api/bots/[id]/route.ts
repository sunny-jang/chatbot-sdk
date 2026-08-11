import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { Bot } from "@/lib/db";

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const rows = await sql`SELECT * FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rows[0] as unknown as Bot);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const check = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!check[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { name, system_prompt, model } = await req.json();
  const rows = await sql`
    UPDATE bots SET
      name = COALESCE(${name ?? null}, name),
      system_prompt = COALESCE(${system_prompt ?? null}, system_prompt),
      model = COALESCE(${model ?? null}, model)
    WHERE id = ${id}
    RETURNING *
  `;
  return NextResponse.json(rows[0] as unknown as Bot);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await sql`DELETE FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  return NextResponse.json({ ok: true });
}
