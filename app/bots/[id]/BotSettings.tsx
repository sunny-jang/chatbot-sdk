"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "@/lib/db";

export default function BotSettings({ bot }: { bot: Bot }) {
  const router = useRouter();
  const [name, setName] = useState(bot.name);
  const [systemPrompt, setSystemPrompt] = useState(bot.system_prompt ?? "");
  const [model, setModel] = useState(bot.model);
  const [widgetTitle, setWidgetTitle] = useState(bot.widget_title ?? "");
  const [widgetColor, setWidgetColor] = useState(bot.widget_color ?? "#2563eb");
  const [greeting, setGreeting] = useState(bot.greeting_message ?? "");
  const [serviceDesc, setServiceDesc] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleGenerate() {
    if (!serviceDesc.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}/generate-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: serviceDesc }),
      });
      const data = await res.json();
      if (data.systemPrompt) setSystemPrompt(data.systemPrompt);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/bots/${bot.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        system_prompt: systemPrompt,
        model,
        widget_title: widgetTitle || null,
        widget_color: widgetColor,
        greeting_message: greeting || null,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm(`"${bot.name}" 챗봇을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
    router.push("/");
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* 기본 설정 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-900">기본 설정</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">챗봇 이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {bot.type === "ai" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">서비스 설명</label>
              <div className="flex gap-2">
                <textarea
                  value={serviceDesc}
                  onChange={(e) => setServiceDesc(e.target.value)}
                  rows={2}
                  placeholder="예) 강남구 소재 피부과 클리닉 챗봇입니다. 진료 예약, 시술 안내, 가격 문의에 응대합니다."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                />
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !serviceDesc.trim()}
                  className="shrink-0 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg disabled:opacity-40 transition-colors leading-tight"
                >
                  {generating ? (
                    <span className="flex flex-col items-center gap-0.5">
                      <span>생성 중</span>
                      <span>...</span>
                    </span>
                  ) : (
                    <span className="flex flex-col items-center gap-0.5">
                      <span>✨ 프롬프트</span>
                      <span>생성</span>
                    </span>
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">시스템 프롬프트</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
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
      </div>

      {/* 위젯 커스터마이징 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-900">위젯 설정</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">위젯 제목</label>
            <input
              type="text"
              value={widgetTitle}
              onChange={(e) => setWidgetTitle(e.target.value)}
              placeholder={bot.name}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">비워두면 챗봇 이름 사용</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">테마 색상</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={widgetColor}
                onChange={(e) => setWidgetColor(e.target.value)}
                className="w-10 h-9 rounded border border-gray-300 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={widgetColor}
                onChange={(e) => setWidgetColor(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">인사말</label>
          <input
            type="text"
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            placeholder="안녕하세요! 무엇을 도와드릴까요?"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">위젯을 열면 처음 표시되는 메시지</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
        >
          {deleting ? "삭제 중..." : "챗봇 삭제"}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saved ? "✓ 저장됨" : saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}
