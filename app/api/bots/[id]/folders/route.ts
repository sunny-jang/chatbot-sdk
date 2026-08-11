import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { DocFolder } from "@/lib/db";
import { randomUUID } from "crypto";

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

async function botBelongsToTenant(botId: string, tenantId: string) {
  const rows = await sql`SELECT id FROM bots WHERE id = ${botId} AND tenant_id = ${tenantId}`;
  return !!rows[0];
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await sql`
    SELECT id, bot_id, name, parent_id, created_at
    FROM doc_folders WHERE bot_id = ${id} ORDER BY name ASC
  `;
  return NextResponse.json(rows as unknown as DocFolder[]);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { name, parent_id } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const folderId = randomUUID();
  const rows = await sql`
    INSERT INTO doc_folders (id, bot_id, name, parent_id)
    VALUES (${folderId}, ${id}, ${name}, ${parent_id ?? null})
    RETURNING id, bot_id, name, parent_id, created_at
  `;
  return NextResponse.json(rows[0] as unknown as DocFolder, { status: 201 });
}
