import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { QaPair } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> }
) {
  const { qaId } = await params;
  const { question, answer } = await req.json();

  let embeddingJson: string | null = null;
  if (question) {
    const vec = await getEmbedding(question);
    embeddingJson = JSON.stringify(vec);
  }

  const rows = await sql`
    UPDATE qa_pairs SET
      question  = COALESCE(${question ?? null}, question),
      answer    = COALESCE(${answer ?? null}, answer),
      embedding = COALESCE(${embeddingJson}, embedding)
    WHERE id = ${qaId}
    RETURNING id, bot_id, question, answer, created_at
  `;
  return NextResponse.json(rows[0] as QaPair);
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> }
) {
  const { qaId } = await params;
  await sql`DELETE FROM qa_pairs WHERE id = ${qaId}`;
  return NextResponse.json({ ok: true });
}
