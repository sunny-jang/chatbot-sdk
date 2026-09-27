export type GeminiMessage = {
  role: "user" | "model";
  parts: { text: string }[];
};

export type GeminiResponse = {
  text: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export async function generateGeminiContent(options: {
  apiKey: string;
  model: string;
  systemInstruction?: string;
  contents: GeminiMessage[];
}): Promise<GeminiResponse> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(options.systemInstruction
          ? { systemInstruction: { parts: [{ text: options.systemInstruction }] } }
          : {}),
        contents: options.contents,
      }),
    },
  );

  if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
  const data = await response.json() as {
    modelVersion?: string;
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  return {
    text,
    model: data.modelVersion ?? options.model,
    inputTokens: data.usageMetadata?.promptTokenCount ?? null,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
  };
}
