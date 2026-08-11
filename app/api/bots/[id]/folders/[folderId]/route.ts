import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; folderId: string }> }
) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, folderId } = await params;
  const check = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!check[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await sql`DELETE FROM doc_folders WHERE id = ${folderId} AND bot_id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; folderId: string }> }
) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, folderId } = await params;
  const check = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!check[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { name } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  await sql`UPDATE doc_folders SET name = ${name} WHERE id = ${folderId} AND bot_id = ${id}`;
  return NextResponse.json({ ok: true });
}
