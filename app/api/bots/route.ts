import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { initSchema, Bot } from "@/lib/db";
import { randomUUID } from "crypto";

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

  const { name, type, system_prompt, model } = await req.json();
  if (!name || !type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }
  await initSchema();
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO bots (id, tenant_id, name, type, system_prompt, model)
    VALUES (${id}, ${tenantId}, ${name}, ${type}, ${system_prompt ?? null}, ${model ?? "gpt-4o-mini"})
    RETURNING *
  `;
  return NextResponse.json(rows[0] as unknown as Bot, { status: 201 });
}
