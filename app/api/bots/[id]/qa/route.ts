import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { randomUUID } from "crypto";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const pairs = db
    .prepare("SELECT id, bot_id, question, answer, created_at FROM qa_pairs WHERE bot_id = ? ORDER BY created_at DESC")
    .all(id);
  return NextResponse.json(pairs);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { question, answer } = await req.json();

  if (!question || !answer) {
    return NextResponse.json({ error: "question and answer are required" }, { status: 400 });
  }

  const embedding = await getEmbedding(question);

  const db = getDb();
  const qaId = randomUUID();
  db.prepare(
    "INSERT INTO qa_pairs (id, bot_id, question, answer, embedding) VALUES (?, ?, ?, ?, ?)"
  ).run(qaId, id, question, answer, JSON.stringify(embedding));

  const pair = db
    .prepare("SELECT id, bot_id, question, answer, created_at FROM qa_pairs WHERE id = ?")
    .get(qaId);
  return NextResponse.json(pair, { status: 201 });
}
