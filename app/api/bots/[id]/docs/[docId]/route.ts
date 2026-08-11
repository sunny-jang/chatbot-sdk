import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

async function botBelongsToTenant(botId: string, tenantId: string) {
  const rows = await sql`SELECT id FROM bots WHERE id = ${botId} AND tenant_id = ${tenantId}`;
  return !!rows[0];
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
