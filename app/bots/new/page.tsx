"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewBotPage() {
  const router = useRouter();
  const [type, setType] = useState<"qa" | "ai">("qa");
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, system_prompt: systemPrompt, model }),
      });
      const bot = await res.json();
      router.push(`/bots/${bot.id}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">새 챗봇 만들기</h2>
      <p className="text-sm text-gray-500 mb-6">챗봇 유형과 기본 설정을 입력하세요</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 타입 선택 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">챗봇 유형</label>
          <div className="grid grid-cols-2 gap-3">
            {(["qa", "ai"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`p-4 border-2 rounded-xl text-left transition-all ${
                  type === t
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="text-2xl mb-1">{t === "qa" ? "📚" : "✨"}</div>
                <div className="font-medium text-gray-900 text-sm">
                  {t === "qa" ? "Q&A 봇" : "AI 봇"}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {t === "qa"
                    ? "질문/답변 세트로 응답"
                    : "OpenAI가 자유롭게 응답"}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 이름 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            챗봇 이름 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 고객지원 봇"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* AI 봇 전용 설정 */}
        {type === "ai" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                시스템 프롬프트
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="예: 당신은 친절한 고객지원 상담원입니다. 항상 공손하게 답변해주세요."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">모델</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="gpt-4o-mini">gpt-4o-mini (빠름, 저렴)</option>
                <option value="gpt-4o">gpt-4o (고성능)</option>
                <option value="gpt-4.1">gpt-4.1</option>
              </select>
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={loading || !name}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "생성 중..." : "챗봇 생성"}
        </button>
      </form>
    </div>
  );
}
