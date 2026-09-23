import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { getTenantApiKeysByTenantId } from "@/lib/tenantKey";
import { generateSystemPrompt } from "@/lib/promptGeneration";
import { readTenantId } from "@/lib/auth";

async function getTenantId() {
  return (await readTenantId()) ?? null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const rows = await sql`SELECT id, model FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { description } = await req.json();
  if (!description?.trim()) {
    return NextResponse.json({ error: "서비스 설명을 입력해주세요" }, { status: 400 });
  }

  const keys = await getTenantApiKeysByTenantId(tenantId);
  const systemPrompt = await generateSystemPrompt({
    description,
    model: (rows[0] as { model?: string }).model || "gpt-4o-mini",
    openaiKey: keys.openai,
    geminiKey: keys.gemini,
  });
  return NextResponse.json({ systemPrompt });
}
