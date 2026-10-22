"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function Settings({
  customerId,
  initialName,
  initialWebsite,
  status,
  owner = false,
}: {
  customerId: string;
  initialName: string;
  initialWebsite: string | null;
  status: string;
  owner?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName),
    [website, setWebsite] = useState(initialWebsite || ""),
    [state, setState] = useState(status),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const r = await fetch(
        owner
          ? `/api/customers/${customerId}`
          : `/api/customer/${customerId}/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            website,
            ...(owner ? { status: state } : {}),
          }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cp-panel">
      <h2>고객사 정보</h2>
      <form className="cp-details" onSubmit={save}>
        <label>
          고객사 이름
          <input
            className="cp-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label>
          홈페이지 주소
          <input
            className="cp-input"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://"
          />
        </label>
        {owner && (
          <label>
            운영 상태
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
            </select>
            <p className="cp-note">
              연결된 챗봇·활성 담당자·미완료 상담이 있으면 비활성화할 수
              없습니다.
            </p>
          </label>
        )}
        <button className="cp-button" disabled={busy}>
          {busy ? "저장 중…" : "정보 저장"}
        </button>
        {error && (
          <p className="cp-error" role="alert">
            {error}
          </p>
        )}
        {saved && <p role="status">저장했습니다.</p>}
      </form>
    </section>
  );
}
