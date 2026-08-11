import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { Document } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
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
    SELECT id, bot_id, title, content, created_at
    FROM documents WHERE bot_id = ${id} ORDER BY created_at DESC
  `;
  return NextResponse.json(rows as unknown as Document[]);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { title, content } = await req.json();
  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 });
  }

  const embedding = await getEmbedding(content.slice(0, 8000));
  const docId = randomUUID();
  const rows = await sql`
    INSERT INTO documents (id, bot_id, title, content, embedding)
    VALUES (${docId}, ${id}, ${title}, ${content}, ${JSON.stringify(embedding)})
    RETURNING id, bot_id, title, content, created_at
  `;
  return NextResponse.json(rows[0] as unknown as Document, { status: 201 });
}
