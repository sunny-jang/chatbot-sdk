import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { encrypt } from "@/lib/crypto";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await sql`DELETE FROM tenants WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, openai_api_key } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  if (openai_api_key !== undefined) {
    const encryptedKey = openai_api_key ? encrypt(openai_api_key) : null;
    await sql`UPDATE tenants SET name = ${name}, openai_api_key = ${encryptedKey} WHERE id = ${id}`;
  } else {
    await sql`UPDATE tenants SET name = ${name} WHERE id = ${id}`;
  }
  return NextResponse.json({ ok: true });
}
