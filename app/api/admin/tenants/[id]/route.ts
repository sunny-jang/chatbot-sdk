import { NextResponse } from "next/server";
import sql from "@/lib/neon";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await sql`DELETE FROM tenants WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  await sql`UPDATE tenants SET name = ${name} WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
