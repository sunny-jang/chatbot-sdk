"use client";

import { useState } from "react";

type Tenant = {
  id: string;
  name: string;
  api_key: string;
  created_at: number;
  bot_count: number;
  plan: "starter" | "growth" | "pro" | "enterprise";
  subscription_status: "active" | "inactive";
  enterprise_bot_limit: number | null;
  enterprise_monthly_session_limit: number | null;
  monthly_session_count: number;
};

function sessionLimit(tenant: Tenant) {
  if (tenant.plan === "starter") return 1_000;
  if (tenant.plan === "growth") return 5_000;
  if (tenant.plan === "pro") return 10_000;
  return tenant.enterprise_monthly_session_limit;
}

function usageBadgeStyle(tenant: Tenant) {
  const limit = sessionLimit(tenant);
  const percent = limit ? (tenant.monthly_session_count / limit) * 100 : 0;
  if (percent >= 100) return { backgroundColor: "#fef2f2", color: "#b91c1c" };
  if (percent >= 90) return { backgroundColor: "#fff1f2", color: "#be123c" };
  if (percent >= 80) return { backgroundColor: "#fffbeb", color: "#b45309" };
  return { backgroundColor: "#ecfdf5", color: "#047857" };
}

export default function AdminClient({ initialTenants }: { initialTenants: Tenant[] }) {
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
      setTenants((prev) => [{
        ...data,
        bot_count: 0,
        plan: "starter",
        subscription_status: "active",
        enterprise_bot_limit: null,
        enterprise_monthly_session_limit: null,
        monthly_session_count: 0,
      }, ...prev]);
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

  async function updatePlan(
    tenant: Tenant,
    changes: Partial<Pick<Tenant, "plan" | "subscription_status" | "enterprise_bot_limit" | "enterprise_monthly_session_limit">>,
  ) {
    const next = { ...tenant, ...changes };
    if (next.plan === "enterprise" && !next.enterprise_bot_limit) {
      next.enterprise_bot_limit = Math.max(10, next.bot_count);
    }
    if (next.plan === "enterprise" && !next.enterprise_monthly_session_limit) {
      next.enterprise_monthly_session_limit = 50_000;
    }
    const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: next.plan,
        subscription_status: next.subscription_status,
        enterprise_bot_limit: next.enterprise_bot_limit,
        enterprise_monthly_session_limit: next.enterprise_monthly_session_limit,
      }),
    });
    if (!res.ok) return;
    const saved = await res.json();
    setTenants((prev) => prev.map((item) => item.id === tenant.id ? { ...item, ...saved } : item));
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#1a1040" }}>계정 관리</h1>
        <p className="text-sm mt-1" style={{ color: "#9b8fc0" }}>고객사 계정을 생성하고 관리합니다</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl p-5 border" style={{ backgroundColor: "#fff", borderColor: "#e8e6ff" }}>
          <p className="text-sm mb-1" style={{ color: "#9b8fc0" }}>총 고객사</p>
          <p className="text-3xl font-bold" style={{ color: "#1a1040" }}>{tenants.length}</p>
        </div>
        <div className="rounded-xl p-5 border" style={{ backgroundColor: "#fff", borderColor: "#e8e6ff" }}>
          <p className="text-sm mb-1" style={{ color: "#9b8fc0" }}>총 챗봇</p>
          <p className="text-3xl font-bold" style={{ color: "#1a1040" }}>{tenants.reduce((s, t) => s + t.bot_count, 0)}</p>
        </div>
      </div>

      {/* New tenant form */}
      <div className="rounded-xl p-6 mb-5 border" style={{ backgroundColor: "#fff", borderColor: "#e8e6ff" }}>
        <h2 className="font-semibold mb-4" style={{ color: "#2d1b69" }}>새 고객사 추가</h2>
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="고객사 이름"
            required
            className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ border: "1px solid #d4cfff", backgroundColor: "#faf9ff", color: "#1a1040" }}
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-5 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: "#6949f4" }}
          >
            {creating ? "생성 중..." : "생성"}
          </button>
        </form>
      </div>

      {/* New API key reveal */}
      {newApiKey && (
        <div className="rounded-xl p-5 mb-5 border" style={{ backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold mb-1" style={{ color: "#15803d" }}>
                ✅ "{newApiKey.name}" 생성 완료 — API 키를 지금 복사해두세요
              </p>
              <p className="font-mono text-sm break-all" style={{ color: "#166534" }}>{newApiKey.key}</p>
              <p className="text-xs mt-1" style={{ color: "#4ade80" }}>이 창을 닫으면 전체 키는 다시 확인할 수 없습니다</p>
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(newApiKey.key)}
              className="ml-4 px-3 py-1.5 text-xs rounded-lg shrink-0 text-white"
              style={{ backgroundColor: "#16a34a" }}
            >
              복사
            </button>
          </div>
          <button
            onClick={() => setNewApiKey(null)}
            className="mt-3 text-xs"
            style={{ color: "#86efac" }}
          >
            닫기
          </button>
        </div>
      )}

      {/* Tenant list */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "#fff", borderColor: "#e8e6ff" }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: "#e8e6ff" }}>
          <h2 className="font-semibold" style={{ color: "#2d1b69" }}>고객사 목록</h2>
        </div>

        {tenants.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm" style={{ color: "#b8aee0" }}>
            아직 등록된 고객사가 없어요
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "#f0eeff" }}>
            {tenants.map((t) => (
              <div key={t.id} className="px-6 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium" style={{ color: "#1a1040" }}>{t.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "#ede9ff", color: "#6d28d9" }}>
                      봇 {t.bot_count}개
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={usageBadgeStyle(t)}>
                      이번 달 세션 {t.monthly_session_count.toLocaleString("ko-KR")} / {sessionLimit(t)?.toLocaleString("ko-KR") ?? "한도 설정 필요"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs" style={{ color: "#9b8fc0" }}>
                      {t.api_key.slice(0, 12)}••••••••••••••••
                    </span>
                    <button
                      onClick={() => copyKey(t.api_key, t.id)}
                      className="text-xs transition-colors"
                      style={{ color: copiedId === t.id ? "#6949f4" : "#b8aee0" }}
                    >
                      {copiedId === t.id ? "✅ 복사됨" : "복사"}
                    </button>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "#c4b8e0" }}>
                    {new Date(Number(t.created_at) * 1000).toLocaleDateString("ko-KR")} 등록
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      value={t.plan}
                      onChange={(event) => updatePlan(t, { plan: event.target.value as Tenant["plan"] })}
                      className="rounded-lg border px-2 py-1.5 text-xs bg-white"
                      style={{ borderColor: "#d4cfff", color: "#4c3b78" }}
                      aria-label={`${t.name} 플랜`}
                    >
                      <option value="starter">스타터 · 1개</option>
                      <option value="growth">그로스 · 3개</option>
                      <option value="pro">프로 · 5개</option>
                      <option value="enterprise">엔터프라이즈 · 협의</option>
                    </select>
                    {t.plan === "enterprise" && (
                      <>
                        <label className="flex items-center gap-1 text-xs" style={{ color: "#7565a7" }}>
                          챗봇
                          <input type="number" min={1} defaultValue={t.enterprise_bot_limit ?? 10} onBlur={(event) => updatePlan(t, { enterprise_bot_limit: Math.max(1, Number(event.target.value) || 1) })} className="w-16 rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: "#d4cfff" }} />개
                        </label>
                        <label className="flex items-center gap-1 text-xs" style={{ color: "#7565a7" }}>
                          월 세션
                          <input type="number" min={1} defaultValue={t.enterprise_monthly_session_limit ?? 50000} onBlur={(event) => updatePlan(t, { enterprise_monthly_session_limit: Math.max(1, Number(event.target.value) || 1) })} className="w-24 rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: "#d4cfff" }} />건
                        </label>
                      </>
                    )}
                    <select
                      value={t.subscription_status}
                      onChange={(event) => updatePlan(t, { subscription_status: event.target.value as Tenant["subscription_status"] })}
                      className="rounded-lg border px-2 py-1.5 text-xs bg-white"
                      style={{ borderColor: "#d4cfff", color: t.subscription_status === "active" ? "#15803d" : "#b91c1c" }}
                      aria-label={`${t.name} 구독 상태`}
                    >
                      <option value="active">구독 활성</option>
                      <option value="inactive">구독 중지</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(t.id, t.name)}
                  className="text-sm transition-colors shrink-0"
                  style={{ color: "#f87171" }}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
