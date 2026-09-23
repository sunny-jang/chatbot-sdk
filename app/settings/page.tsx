"use client";

import { useState, useEffect } from "react";
import HelpButton from "@/app/HelpButton";

const HELP = {
  title: "설정 사용방법",
  sections: [
    {
      heading: "AI API 키",
      items: [
        "사용할 AI 제공업체의 API 키를 등록하면 챗봇별 모델 설정에 따라 해당 키가 사용됩니다.",
        "키를 등록하지 않으면 해당 제공업체의 AI 채팅을 사용할 수 없습니다.",
        "OpenAI 키는 platform.openai.com, Gemini 키는 Google AI Studio에서 발급받을 수 있습니다.",
      ],
    },
    {
      heading: "보안",
      items: [
        "API 키는 AES-256으로 암호화되어 저장됩니다.",
        "키의 앞 8자만 화면에 표시되며 전체 키는 다시 볼 수 없습니다.",
      ],
    },
  ],
};

export default function SettingsPage() {
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [provider, setProvider] = useState<"openai" | "gemini">("openai");
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showInput, setShowInput] = useState(false);

  useEffect(() => {
    fetch("/api/tenants/settings")
      .then((r) => r.json())
      .then((d) => {
        setHasKey(d.openai?.hasKey ?? false);
        setMaskedKey(d.openai?.maskedKey ?? null);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/tenants/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, [`${provider}_api_key`]: newKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "저장 실패" });
      } else {
        setHasKey(true);
        setMaskedKey(newKey.trim().slice(0, 8) + "••••••••••••••••••••");
        setNewKey("");
        setShowInput(false);
        setMessage({ type: "success", text: `${provider === "gemini" ? "Gemini" : "OpenAI"} API 키가 저장되었습니다.` });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm("API 키를 삭제하면 서버 기본 키를 사용합니다. 계속하시겠어요?")) return;
    setSaving(true);
    setMessage(null);
    try {
      await fetch("/api/tenants/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, [`${provider}_api_key`]: "" }),
      });
      setHasKey(false);
      setMaskedKey(null);
      setShowInput(false);
      setMessage({ type: "success", text: "API 키가 삭제되었습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">설정</h2>
          <p className="text-sm text-gray-500 mt-1">워크스페이스 환경을 관리하세요</p>
        </div>
        <HelpButton content={HELP} />
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="font-semibold text-gray-900">AI API 키</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              챗봇 설정에서 선택한 모델의 제공업체 키가 사용됩니다.
            </p>
          </div>
          <span
            className={`shrink-0 ml-4 px-2.5 py-1 text-xs font-medium rounded-full ${
              hasKey
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {hasKey ? "등록됨" : "미등록"}
          </span>
        </div>

        <div className="mt-4 flex gap-2 border-b border-gray-100">
          {(["openai", "gemini"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setProvider(item);
                setNewKey("");
                setShowInput(false);
                fetch("/api/tenants/settings").then((r) => r.json()).then((d) => {
                  setHasKey(d[item]?.hasKey ?? false);
                  setMaskedKey(d[item]?.maskedKey ?? null);
                });
              }}
              className={`px-3 py-2 text-sm font-medium border-b-2 ${provider === item ? "border-purple-600 text-purple-700" : "border-transparent text-gray-400"}`}
            >
              {item === "openai" ? "OpenAI (GPT)" : "Google Gemini"}
            </button>
          ))}
        </div>

        {hasKey && maskedKey && (
          <div className="mt-4 flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
            <span className="font-mono text-sm text-gray-600 flex-1">{maskedKey}</span>
            <button
              onClick={() => setShowInput(true)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              변경
            </button>
            <button
              onClick={handleRemove}
              disabled={saving}
              className="text-xs text-red-500 hover:text-red-600 font-medium"
            >
              삭제
            </button>
          </div>
        )}

        {(!hasKey || showInput) && (
          <form onSubmit={handleSave} className="mt-4 space-y-3">
            <input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={provider === "gemini" ? "Gemini API 키를 입력하세요" : "sk-proj-..."}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving || !newKey.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
              {showInput && (
                <button
                  type="button"
                  onClick={() => { setShowInput(false); setNewKey(""); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg transition-colors"
                >
                  취소
                </button>
              )}
            </div>
          </form>
        )}

        {message && (
          <p
            className={`mt-3 text-sm ${
              message.type === "success" ? "text-green-600" : "text-red-600"
            }`}
          >
            {message.type === "success" ? "✅ " : "❌ "}
            {message.text}
          </p>
        )}

        <div className="mt-5 pt-4 border-t border-gray-100 space-y-1">
          <p className="text-xs text-gray-400">
            키는 AES-256 암호화되어 저장됩니다. 사용할 모델의 키를 등록해야 AI 채팅이 가능합니다.
          </p>
          <p className="text-xs text-amber-600 font-medium">
            ※ 챗봇 설정에서 GPT 또는 Gemini 모델을 선택할 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
