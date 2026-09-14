import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { readTenantId } from "@/lib/auth";

async function getTenantId() {
  return (await readTenantId()) ?? null;
}

async function botBelongsToTenant(botId: string, tenantId: string) {
  const rows = await sql`SELECT id FROM bots WHERE id = ${botId} AND tenant_id = ${tenantId}`;
  return !!rows[0];
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, docId } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { folder_id } = await req.json();
  if (folder_id) {
    const folder = await sql`
      SELECT id FROM doc_folders WHERE id = ${folder_id} AND bot_id = ${id}
    `;
    if (!folder[0]) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const rows = await sql`
    UPDATE documents SET folder_id = ${folder_id ?? null}
    WHERE id = ${docId} AND bot_id = ${id}
    RETURNING id, bot_id, folder_id, title, content, created_at
  `;
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, docId } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await sql`DELETE FROM documents WHERE id = ${docId} AND bot_id = ${id}`;
  return NextResponse.json({ ok: true });
}
