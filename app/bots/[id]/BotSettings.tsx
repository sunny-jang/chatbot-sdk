"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "@/lib/db";

export default function BotSettings({ bot }: { bot: Bot }) {
  const router = useRouter();
  const [name, setName] = useState(bot.name);
  const [systemPrompt, setSystemPrompt] = useState(bot.system_prompt ?? "");
  const [model, setModel] = useState(bot.model);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/bots/${bot.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, system_prompt: systemPrompt, model }),
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
    <form onSubmit={handleSave} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
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

      <div className="flex items-center justify-between pt-1">
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
