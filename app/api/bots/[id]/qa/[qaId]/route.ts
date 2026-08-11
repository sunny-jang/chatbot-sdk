import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> }
) {
  const { qaId } = await params;
  const { question, answer } = await req.json();
  const db = getDb();

  let embedding: string | undefined;
  if (question) {
    const vec = await getEmbedding(question);
    embedding = JSON.stringify(vec);
  }

  db.prepare(
    `UPDATE qa_pairs SET
      question = COALESCE(?, question),
      answer = COALESCE(?, answer),
      embedding = COALESCE(?, embedding)
     WHERE id = ?`
  ).run(question ?? null, answer ?? null, embedding ?? null, qaId);

  const pair = db
    .prepare("SELECT id, bot_id, question, answer, created_at FROM qa_pairs WHERE id = ?")
    .get(qaId);
  return NextResponse.json(pair);
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> }
) {
  const { qaId } = await params;
  const db = getDb();
  db.prepare("DELETE FROM qa_pairs WHERE id = ?").run(qaId);
  return NextResponse.json({ ok: true });
}
