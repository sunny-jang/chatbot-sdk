import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema, Bot } from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET() {
  await initSchema();
  const rows = await sql`SELECT * FROM bots ORDER BY created_at DESC`;
  return NextResponse.json(rows as Bot[]);
}

export async function POST(req: Request) {
  const { name, type, system_prompt, model } = await req.json();
  if (!name || !type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }
  await initSchema();
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO bots (id, name, type, system_prompt, model)
    VALUES (${id}, ${name}, ${type}, ${system_prompt ?? null}, ${model ?? "gpt-4o-mini"})
    RETURNING *
  `;
  return NextResponse.json(rows[0] as Bot, { status: 201 });
}
