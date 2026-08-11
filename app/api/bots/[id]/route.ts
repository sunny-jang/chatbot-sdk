import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rows } = await sql`SELECT * FROM bots WHERE id = ${id}`;
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, system_prompt, model } = await req.json();
  const { rows } = await sql`
    UPDATE bots SET
      name = COALESCE(${name ?? null}, name),
      system_prompt = COALESCE(${system_prompt ?? null}, system_prompt),
      model = COALESCE(${model ?? null}, model)
    WHERE id = ${id}
    RETURNING *
  `;
  return NextResponse.json(rows[0]);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await sql`DELETE FROM bots WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
