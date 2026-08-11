import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import OpenAI from "openai";

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const rows = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { description } = await req.json();
  if (!description?.trim()) {
    return NextResponse.json({ error: "서비스 설명을 입력해주세요" }, { status: 400 });
  }

  const apiKey = await getTenantApiKeyByTenantId(tenantId);
  const openai = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `당신은 AI 챗봇의 시스템 프롬프트를 작성하는 전문가입니다.
사용자가 서비스 설명을 제공하면, 해당 서비스에 맞는 효과적인 챗봇 시스템 프롬프트를 작성해주세요.

작성 원칙:
- 챗봇의 역할과 목적을 명확히 정의
- 말투와 응대 방식을 구체적으로 지정 (친절하고 전문적으로)
- 답변 범위와 한계를 설정
- 한국어로 작성
- 시스템 프롬프트만 출력 (설명이나 전문, 후문 없이)`,
      },
      {
        role: "user",
        content: `다음 서비스에 맞는 챗봇 시스템 프롬프트를 작성해주세요:\n\n${description}`,
      },
    ],
  });

  const systemPrompt = completion.choices[0].message.content ?? "";
  return NextResponse.json({ systemPrompt });
}
