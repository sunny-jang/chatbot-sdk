import OpenAI from "openai";
import { generateGeminiContent } from "@/lib/gemini";

const systemInstruction = `당신은 AI 챗봇의 시스템 프롬프트를 작성하는 전문가입니다.
사용자가 서비스 설명을 제공하면, 해당 서비스에 맞는 효과적인 챗봇 시스템 프롬프트를 작성해주세요.

작성 원칙:
- 챗봇의 역할과 목적을 명확히 정의
- 말투와 응대 방식을 구체적으로 지정 (친절하고 전문적으로)
- 답변 범위와 한계를 설정
- 한국어로 작성
- 시스템 프롬프트만 출력 (설명이나 전문, 후문 없이)`;

export async function generateSystemPrompt(options: {
  description: string;
  model: string;
  openaiKey: string | null;
  geminiKey: string | null;
}) {
  if (options.model.startsWith("gemini-")) {
    const key = options.geminiKey ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini API 키를 설정에서 등록해주세요.");
    const result = await generateGeminiContent({
      apiKey: key,
      model: options.model,
      systemInstruction,
      contents: [{ role: "user", parts: [{ text: `다음 서비스에 맞는 챗봇 시스템 프롬프트를 작성해주세요:\n\n${options.description}` }] }],
    });
    return result.text;
  }

  const openai = new OpenAI({ apiKey: options.openaiKey ?? process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: options.model || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: `다음 서비스에 맞는 챗봇 시스템 프롬프트를 작성해주세요:\n\n${options.description}` },
    ],
  });
  return completion.choices[0].message.content ?? "";
}
