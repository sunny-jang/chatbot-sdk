import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const bot = db.prepare("SELECT * FROM bots WHERE id = ?").get(id);
  if (!bot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(bot);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, system_prompt, model } = await req.json();
  const db = getDb();
  db.prepare(
    "UPDATE bots SET name = COALESCE(?, name), system_prompt = COALESCE(?, system_prompt), model = COALESCE(?, model) WHERE id = ?"
  ).run(name ?? null, system_prompt ?? null, model ?? null, id);
  const bot = db.prepare("SELECT * FROM bots WHERE id = ?").get(id);
  return NextResponse.json(bot);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM bots WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
