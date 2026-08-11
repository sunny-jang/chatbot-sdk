import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { QaPair } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import { randomUUID } from "crypto";

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

async function botBelongsToTenant(botId: string, tenantId: string) {
  const rows = await sql`SELECT id FROM bots WHERE id = ${botId} AND tenant_id = ${tenantId}`;
  return !!rows[0];
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await sql`
    SELECT id, bot_id, question, answer, created_at
    FROM qa_pairs WHERE bot_id = ${id} ORDER BY created_at DESC
  `;
  return NextResponse.json(rows as unknown as QaPair[]);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { question, answer } = await req.json();
  if (!question || !answer) {
    return NextResponse.json({ error: "question and answer are required" }, { status: 400 });
  }
  const apiKey = await getTenantApiKeyByTenantId(tenantId);
  const embedding = await getEmbedding(question, apiKey);
  const qaId = randomUUID();
  const rows = await sql`
    INSERT INTO qa_pairs (id, bot_id, question, answer, embedding)
    VALUES (${qaId}, ${id}, ${question}, ${answer}, ${JSON.stringify(embedding)})
    RETURNING id, bot_id, question, answer, created_at
  `;
  return NextResponse.json(rows[0] as unknown as QaPair, { status: 201 });
}
