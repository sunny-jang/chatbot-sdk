"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Tenant = {
  id: string;
  name: string;
  api_key: string;
  created_at: number;
  bot_count: number;
};

export default function AdminClient({ initialTenants }: { initialTenants: Tenant[] }) {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>(initialTenants);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newApiKey, setNewApiKey] = useState<{ name: string; key: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      setTenants((prev) => [{ ...data, bot_count: 0 }, ...prev]);
      setNewApiKey({ name: data.name, key: data.api_key });
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 고객사를 삭제하시겠어요? 해당 고객사의 모든 봇도 삭제됩니다.`)) return;
    await fetch(`/api/admin/tenants/${id}`, { method: "DELETE" });
    setTenants((prev) => prev.filter((t) => t.id !== id));
  }

  async function copyKey(key: string, id: string) {
    await navigator.clipboard.writeText(key);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">⚙️</span>
          <div>
            <h1 className="font-bold text-white">슈퍼 어드민</h1>
            <p className="text-xs text-slate-400">Ideal AI Chatbot SDK</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          로그아웃
        </button>
      </header>

      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
            <p className="text-sm text-slate-400 mb-1">총 고객사</p>
            <p className="text-3xl font-bold">{tenants.length}</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
            <p className="text-sm text-slate-400 mb-1">총 챗봇</p>
            <p className="text-3xl font-bold">{tenants.reduce((s, t) => s + t.bot_count, 0)}</p>
          </div>
        </div>

        {/* New tenant form */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
          <h2 className="font-semibold mb-4">새 고객사 추가</h2>
          <form onSubmit={handleCreate} className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="고객사 이름"
              required
              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? "생성 중..." : "생성"}
            </button>
          </form>
        </div>

        {/* New API key reveal */}
        {newApiKey && (
          <div className="bg-green-900/30 border border-green-600/40 rounded-xl p-5 mb-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-green-400 mb-1">
                  ✅ "{newApiKey.name}" 생성 완료 — API 키를 지금 복사해두세요
                </p>
                <p className="font-mono text-green-300 text-sm break-all">{newApiKey.key}</p>
                <p className="text-xs text-green-600 mt-1">이 창을 닫으면 전체 키는 다시 확인할 수 없습니다</p>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(newApiKey.key); }}
                className="ml-4 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-xs rounded-lg transition-colors shrink-0"
              >
                복사
              </button>
            </div>
            <button
              onClick={() => setNewApiKey(null)}
              className="mt-3 text-xs text-green-600 hover:text-green-400"
            >
              닫기
            </button>
          </div>
        )}

        {/* Tenant list */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="font-semibold">고객사 목록</h2>
          </div>

          {tenants.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500">
              아직 등록된 고객사가 없어요
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {tenants.map((t) => (
                <div key={t.id} className="px-6 py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white">{t.name}</span>
                      <span className="text-xs text-slate-500 bg-slate-700 px-2 py-0.5 rounded-full">
                        봇 {t.bot_count}개
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">
                        {t.api_key.slice(0, 12)}••••••••••••••••
                      </span>
                      <button
                        onClick={() => copyKey(t.api_key, t.id)}
                        className="text-xs text-slate-500 hover:text-blue-400 transition-colors"
                      >
                        {copiedId === t.id ? "✅ 복사됨" : "복사"}
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {new Date(Number(t.created_at) * 1000).toLocaleDateString("ko-KR")} 등록
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(t.id, t.name)}
                    className="text-sm text-red-500 hover:text-red-400 transition-colors shrink-0"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
