import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema, QaPair } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import { readTenantId } from "@/lib/auth";

async function getTenantId() {
  return (await readTenantId()) ?? null;
}

async function botBelongsToTenant(botId: string, tenantId: string) {
  const rows =
    await sql`SELECT id FROM bots WHERE id = ${botId} AND tenant_id = ${tenantId}`;
  return !!rows[0];
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> },
) {
  await initSchema();
  const tenantId = await getTenantId();
  if (!tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, qaId } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existing =
    await sql`SELECT id FROM qa_pairs WHERE id=${qaId} AND bot_id=${id}`;
  if (!existing[0])
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { question, answer, folder_id } = await req.json();
  if (
    folder_id &&
    !(
      await sql`SELECT id FROM qa_folders WHERE id=${folder_id} AND bot_id=${id}`
    )[0]
  )
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });

  let embeddingJson: string | null = null;
  if (question) {
    const apiKey = await getTenantApiKeyByTenantId(tenantId!);
    const vec = await getEmbedding(question, apiKey);
    embeddingJson = JSON.stringify(vec);
  }

  const rows = await sql`
    UPDATE qa_pairs SET
      question  = COALESCE(${question ?? null}, question),
      answer    = COALESCE(${answer ?? null}, answer),
      folder_id = COALESCE(${folder_id === undefined ? null : folder_id || null}, folder_id),
      embedding = COALESCE(${embeddingJson}, embedding)
    WHERE id = ${qaId} AND bot_id = ${id}
    RETURNING id, bot_id, folder_id, question, answer, created_at
  `;
  if (!rows[0])
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rows[0] as unknown as QaPair);
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> },
) {
  await initSchema();
  const tenantId = await getTenantId();
  if (!tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, qaId } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const removed =
    await sql`DELETE FROM qa_pairs WHERE id = ${qaId} AND bot_id = ${id} RETURNING id`;
  if (!removed[0])
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
