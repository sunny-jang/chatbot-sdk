import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { readTenantId } from "@/lib/auth";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; folderId: string }> }) {
  const tenantId = (await readTenantId());
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, folderId } = await params;
  const owned = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!owned[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await sql`DELETE FROM qa_folders WHERE id = ${folderId} AND bot_id = ${id}`;
  return NextResponse.json({ ok: true });
}
