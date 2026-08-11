import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET() {
  const db = getDb();
  const bots = db.prepare("SELECT * FROM bots ORDER BY created_at DESC").all();
  return NextResponse.json(bots);
}

export async function POST(req: Request) {
  const { name, type, system_prompt, model } = await req.json();

  if (!name || !type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }

  const db = getDb();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO bots (id, name, type, system_prompt, model) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name, type, system_prompt ?? null, model ?? "gpt-4o-mini");

  const bot = db.prepare("SELECT * FROM bots WHERE id = ?").get(id);
  return NextResponse.json(bot, { status: 201 });
}
