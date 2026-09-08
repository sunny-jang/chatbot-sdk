import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { randomUUID } from "crypto";

async function getTenantId() {
  return (await cookies()).get("tenant_id")?.value ?? null;
}

async function ownsBot(botId: string, tenantId: string) {
  const rows = await sql`SELECT id FROM bots WHERE id = ${botId} AND tenant_id = ${tenantId}`;
  return Boolean(rows[0]);
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownsBot(id, tenantId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await sql`
    SELECT id, bot_id, name, created_at
    FROM qa_folders WHERE bot_id = ${id} ORDER BY name ASC
  `);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownsBot(id, tenantId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const folderId = randomUUID();
  const rows = await sql`
    INSERT INTO qa_folders (id, bot_id, name)
    VALUES (${folderId}, ${id}, ${name.trim()})
    RETURNING id, bot_id, name, created_at
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
