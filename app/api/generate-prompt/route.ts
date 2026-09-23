import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getTenantApiKeysByTenantId } from "@/lib/tenantKey";
import { generateSystemPrompt } from "@/lib/promptGeneration";

export async function POST(req: Request) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { description, model } = await req.json();
  if (!description?.trim()) {
    return NextResponse.json({ error: "서비스 설명을 입력해주세요" }, { status: 400 });
  }

  const keys = await getTenantApiKeysByTenantId(tenantId);
  const systemPrompt = await generateSystemPrompt({ description, model: model || "gpt-4o-mini", openaiKey: keys.openai, geminiKey: keys.gemini });
  return NextResponse.json({ systemPrompt });
}
