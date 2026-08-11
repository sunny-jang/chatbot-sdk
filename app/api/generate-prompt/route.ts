import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import OpenAI from "openai";

export async function POST(req: Request) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
