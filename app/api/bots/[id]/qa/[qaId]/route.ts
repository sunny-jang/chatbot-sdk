import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { initSchema, QaPair } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

async function botBelongsToTenant(botId: string, tenantId: string) {
  const rows = await sql`SELECT id FROM bots WHERE id = ${botId} AND tenant_id = ${tenantId}`;
  return !!rows[0];
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> }
) {
  await initSchema();
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, qaId } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { question, answer, folder_id } = await req.json();

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
    WHERE id = ${qaId}
    RETURNING id, bot_id, folder_id, question, answer, created_at
  `;
  return NextResponse.json(rows[0] as unknown as QaPair);
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> }
) {
  await initSchema();
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, qaId } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await sql`DELETE FROM qa_pairs WHERE id = ${qaId}`;
  return NextResponse.json({ ok: true });
}
