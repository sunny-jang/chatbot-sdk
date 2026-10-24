"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type Customer = {
  id: string;
  name: string;
  website: string | null;
  status: string;
  bots: number;
  members: number;
};
export default function Customers({ portalOrigin }: { portalOrigin: string }) {
  const [items, setItems] = useState<Customer[]>([]),
    [name, setName] = useState(""),
    [site, setSite] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      try {
        const r = await fetch("/api/customers", {
          signal: c.signal,
          cache: "no-store",
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setItems(d.items);
        setError("");
      } catch (e) {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : "목록을 불러오지 못했습니다.",
          );
      }
    }
    void load();
    return () => c.abort();
  }, [revision]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, website: site }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setName("");
      setSite("");
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-page">
      <header className="workspace-page-heading">
        <div>
          <h1>고객사 관리</h1>
          <p>에이전시가 관리하는 사업장과 고객사 전용 상담함을 연결하세요.</p>
        </div>
      </header>
      {error && (
        <p role="alert" className="cp-error">
          {error}
        </p>
      )}
      <section className="cp-panel">
        <h2>새 고객사 추가</h2>
        <form className="cp-row" onSubmit={create}>
          <label>
            고객사 이름
            <input
              className="cp-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            홈페이지 주소
            <input
              className="cp-input"
              type="url"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="https://"
            />
          </label>
          <button className="cp-button" disabled={busy || !name.trim()}>
            고객사 추가
          </button>
        </form>
      </section>
      <div className="cp-customer-list">
        {items.map((c) => (
          <section className="cp-customer" key={c.id}>
            <strong>{c.name}</strong>
            <p>
              {c.bots}개 챗봇 · {c.members}명 담당자
            </p>
            <p className="cp-note">
              {c.website || "홈페이지 미등록"}
              {c.status !== "active" ? " · 비활성" : ""}
            </p>
            <div className="cp-row">
              <Link className="cp-link" href={`/customers/${c.id}`}>
                챗봇·담당자 관리
              </Link>
              <Link
                className="cp-link"
                href={`${portalOrigin}/customer/${c.id}/support`}
              >
                고객사 상담함 열기
              </Link>
            </div>
          </section>
        ))}
      </div>
      {!items.length && !error && (
        <p>고객사를 추가하면 전용 상담함을 준비할 수 있습니다.</p>
      )}
    </div>
  );
}
