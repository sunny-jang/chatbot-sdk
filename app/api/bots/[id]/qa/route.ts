import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { QaPair } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { randomUUID } from "crypto";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`
    SELECT id, bot_id, question, answer, created_at
    FROM qa_pairs WHERE bot_id = ${id} ORDER BY created_at DESC
  `;
  return NextResponse.json(rows as unknown as QaPair[]);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { question, answer } = await req.json();
  if (!question || !answer) {
    return NextResponse.json({ error: "question and answer are required" }, { status: 400 });
  }
  const embedding = await getEmbedding(question);
  const qaId = randomUUID();
  const rows = await sql`
    INSERT INTO qa_pairs (id, bot_id, question, answer, embedding)
    VALUES (${qaId}, ${id}, ${question}, ${answer}, ${JSON.stringify(embedding)})
    RETURNING id, bot_id, question, answer, created_at
  `;
  return NextResponse.json(rows[0] as unknown as QaPair, { status: 201 });
}
