"use client";
import { useState } from "react";
type Master = {
  id: string;
  name: string;
  email: string;
  legacy_tenant_id: string | null;
  tenant_name: string | null;
};
/** Who operates the platform. Adding creates a tenantless identity; removing never touches the agency. */
export default function MastersPanel({
  initial,
  selfId,
  ready,
}: {
  initial: Master[];
  selfId: string | null;
  ready: boolean;
}) {
  const [masters, setMasters] = useState(initial),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  // The server flags an existing identity and ignores name/password; new identities need both.
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/masters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...(name ? { name } : {}), ...(password ? { password } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      const list = await (await fetch("/api/admin/masters")).json();
      setMasters(list);
      setEmail("");
      setName("");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string, label: string) {
    if (!confirm(`${label}의 마스터 권한을 해제할까요? 계정과 에이전시 공간은 그대로 남습니다.`)) return;
    setError("");
    const r = await fetch("/api/admin/masters", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: id }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(d.error ?? "해제하지 못했습니다.");
      return;
    }
    setMasters((prev) => prev.filter((m) => m.id !== id));
  }
  return (
    <section className="workspace-panel" style={{ marginTop: 28 }}>
      <header>
        <div>
          <h2>플랫폼 마스터</h2>
          <p>
            이 콘솔에 들어올 수 있는 계정입니다. 마스터는 에이전시 공간 없이도 존재하며, 에이전시 데이터 안으로는 들어가지 않습니다.
          </p>
        </div>
      </header>
      {!ready ? (
        <p className="workspace-list-note">
          계정 이관(공통 신원)이 적용되면 여기서 마스터를 추가·해제할 수 있습니다. 지금은 ADMIN_EMAILS로 지정합니다.
        </p>
      ) : (
        <>
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>에이전시</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {masters.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      {m.id === selfId && <p>현재 로그인</p>}
                    </td>
                    <td>{m.email}</td>
                    <td>{m.tenant_name ?? "없음 (플랫폼 전용)"}</td>
                    <td style={{ textAlign: "right" }}>
                      {m.id !== selfId && (
                        <button
                          type="button"
                          className="workspace-filter-tabs"
                          style={{ color: "var(--danger)", fontSize: 13 }}
                          onClick={() => void remove(m.id, m.name)}
                        >
                          권한 해제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form onSubmit={add} style={{ padding: "16px 20px", display: "grid", gap: 10, borderTop: "1px solid var(--line-soft)" }}>
            <strong style={{ fontSize: 14 }}>마스터 추가</strong>
            <div className="workspace-search" style={{ flexWrap: "wrap" }}>
              <input type="email" required placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input placeholder="이름 (새 계정일 때)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              <input type="password" placeholder="초기 비밀번호 (새 계정일 때, 12자 이상)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              {/* .workspace-search button would repaint this white; keep the primary look explicit. */}
              <button
                className="workspace-primary"
                disabled={busy}
                style={{ background: "var(--brand)", color: "#fff", borderColor: "var(--brand)", flex: "none" }}
              >
                {busy ? "처리 중…" : "마스터 추가"}
              </button>
            </div>
            <p className="workspace-list-note" style={{ padding: 0 }}>
              이미 있는 계정 이메일이면 권한만 켜고 이름·비밀번호는 무시합니다. 없으면 에이전시 공간 없는 마스터 계정을 만들며, 새 마스터는 master 주소에서만 로그인합니다. 초기 비밀번호는 전달 후 본인이 바꾸게 안내하세요.
            </p>
            {error && <p className="auth-error" role="alert">{error}</p>}
          </form>
        </>
      )}
    </section>
  );
}
