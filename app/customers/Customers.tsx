"use client";
import { useState } from "react";
import Link from "next/link";
import { useApiQuery, useInvalidate } from "@/lib/query/api";
import { SkeletonList } from "@/app/components/Skeleton";
type Customer = {
  id: string;
  name: string;
  website: string | null;
  status: string;
  bots: number;
  members: number;
};
export default function Customers({ portalOrigin }: { portalOrigin: string }) {
  const [name, setName] = useState(""),
    [site, setSite] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const query = useApiQuery<{ items: Customer[] }>(["customers"], "/api/customers");
  const invalidate = useInvalidate();
  const items = query.data?.items ?? [];
  const shownError = error || query.error?.message || "";
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
      setError("");
      await invalidate(["customers"]);
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
      {shownError && (
        <p role="alert" className="cp-error">
          {shownError}
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
      {query.isPending ? (
        <SkeletonList rows={3} label="고객사 목록을 불러오는 중입니다." />
      ) : (
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
      )}
      {!query.isPending && !items.length && !shownError && (
        <p>고객사를 추가하면 전용 상담함을 준비할 수 있습니다.</p>
      )}
    </div>
  );
}
