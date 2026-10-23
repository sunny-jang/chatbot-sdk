"use client";
import { useEffect, useState } from "react";
type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: number;
};
export default function Members({
  customerId,
  owner,
  portal = false,
}: {
  customerId: string;
  owner: boolean;
  portal?: boolean;
}) {
  const [items, setItems] = useState<Member[]>([]),
    [invitations, setInvitations] = useState<Invitation[]>([]),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("agent"),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const base = `/api/${portal ? "customer" : "customers"}/${customerId}`;
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      try {
        const r = await fetch(base + "/members", {
          signal: c.signal,
          cache: "no-store",
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setItems(d.items);
        setInvitations(d.invitations);
      } catch (e) {
        if (!c.signal.aborted) {
          setItems([]);
          setInvitations([]);
          setError(
            e instanceof Error ? e.message : "담당자를 불러오지 못했습니다.",
          );
        }
      }
    }
    void load();
    return () => c.abort();
  }, [base, revision]);
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setUrl("");
    try {
      const r = await fetch(base + "/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setUrl(d.url);
      setEmail("");
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "초대를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function update(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(base + "/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cp-panel">
      <h2>담당자 초대·관리</h2>
      <p className="cp-note">
        담당자는 자기 계정으로 고객사 전용 상담함에 로그인합니다. 초대 링크는
        72시간 유효하며 이메일 확인을 거쳐 수락합니다.
      </p>
      {error && (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}
      <form className="cp-row" onSubmit={invite}>
        <label>
          초대할 이메일
          <input
            className="cp-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          역할
          <select
            className="cp-input"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="agent">상담 담당자</option>
            {owner && <option value="admin">고객사 관리자</option>}
          </select>
        </label>
        <button className="cp-button" disabled={busy}>
          초대 링크 만들기
        </button>
      </form>
      {url && (
        <div className="cp-callout" role="status">
          <strong style={{ fontSize: 13 }}>초대 링크가 만들어졌습니다</strong>
          <input
            className="cp-input"
            value={url}
            readOnly
            onFocus={(e) => e.target.select()}
            aria-label="초대 링크"
          />
          <div className="cp-row">
            <button
              type="button"
              className="cp-button"
              onClick={() => void navigator.clipboard.writeText(url)}
            >
              링크 복사
            </button>
            <span className="cp-note">
              초대한 담당자에게 직접 전달해주세요. 72시간 뒤 만료됩니다.
            </span>
          </div>
        </div>
      )}
      <div className="cp-table-wrap">
        <table className="cp-table">
          <thead>
            <tr>
              <th>담당자</th>
              <th>역할</th>
              <th>접근 상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.name}
                  <small>{m.email}</small>
                </td>
                <td>{m.role === "admin" ? "고객사 관리자" : "상담 담당자"}</td>
                <td>
                  <span className={`cp-chip ${m.status === "active" ? "ok" : "muted"}`}>
                    {m.status === "active" ? "사용 중" : "해제"}
                  </span>
                </td>
                <td>
                  {m.status === "active" && (owner || m.role === "agent") && (
                    <button
                      className="cp-link"
                      disabled={busy}
                      onClick={() =>
                        void update({ userId: m.id, revoke: true })
                      }
                    >
                      접근 해제
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <p className="cp-note">아직 연결된 담당자가 없습니다.</p>
      )}
      {invitations.length > 0 && <h3>최근 초대</h3>}
      {invitations.length > 0 && (
        <ul className="cp-list">
          {invitations.map((i) => (
            <li key={i.id}>
              <span>
                {i.email}
                <small style={{ marginLeft: 8 }}>
                  {i.role === "admin" ? "고객사 관리자" : "상담 담당자"}
                </small>
              </span>
              <span className="cp-row" style={{ gap: 10 }}>
                <span
                  className={`cp-chip ${i.status === "pending" ? "warn" : i.status === "accepted" ? "ok" : "muted"}`}
                >
                  {(
                    {
                      pending: "수락 대기",
                      accepted: "수락 완료",
                      revoked: "취소",
                      expired: "만료",
                    } as Record<string, string>
                  )[i.status] || i.status}
                </span>
                {i.status === "pending" && (owner || i.role === "agent") && (
                  <button
                    type="button"
                    className="cp-link"
                    disabled={busy}
                    onClick={() => void update({ invitationId: i.id })}
                  >
                    초대 취소
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
