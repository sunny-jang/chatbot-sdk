"use client";
import { useState } from "react";
import { useApiQuery, useInvalidate } from "@/lib/query/api";
import { SkeletonList } from "@/app/components/Skeleton";
type Bot = {
  id: string;
  name: string;
  customer_id: string;
  customer_name: string;
};
type Demo = {
  id: string;
  customer_name: string;
  bot_name: string;
  site_url: string;
  expires_at: number;
  revoked_at: number | null;
  request_count: number;
  max_requests: number;
};
export default function DemoManager() {
  const [botId, setBotId] = useState(""),
    [website, setWebsite] = useState(""),
    [hours, setHours] = useState(24),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [link, setLink] = useState(""),
    [copied, setCopied] = useState(false);
  const query = useApiQuery<{ items: Demo[]; bots: Bot[] }>(["demos"], "/api/demos");
  const invalidate = useInvalidate();
  const items = query.data?.items ?? [];
  const bots = query.data?.bots ?? [];
  const shownError = error || query.error?.message || "";
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setLink("");
    setCopied(false);
    try {
      const bot = bots.find((b) => b.id === botId);
      if (!bot) throw Error("챗봇을 선택해주세요.");
      const r = await fetch("/api/demos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            botId,
            customerId: bot.customer_id,
            website,
            hours,
          }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setLink(d.url);
      await invalidate(["demos"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "데모를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/demos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setLink("");
      await invalidate(["demos"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "해제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-page">
      <header className="workspace-page-heading">
        <div>
          <h1>고객사 홈페이지 데모</h1>
          <p>
            홈페이지 위에 실제 챗봇을 띄워보고, 설치 전에 고객에게 공유하세요.
          </p>
        </div>
      </header>
      {shownError && (
        <p className="cp-error" role="alert">
          {shownError}
        </p>
      )}
      <section className="cp-panel">
        <h2>새 데모 만들기</h2>
        <form className="cp-details" onSubmit={create}>
          <label>
            고객사·챗봇
            <select
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              required
            >
              <option value="">선택해주세요</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.customer_name} / {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            홈페이지 주소
            <input
              className="cp-input"
              type="url"
              required
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://www.example.com"
            />
          </label>
          <label>
            공유 기간
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              <option value={1}>1시간</option>
              <option value={24}>24시간</option>
              <option value={72}>3일</option>
              <option value={168}>7일</option>
            </select>
          </label>
          <p className="cp-note">
            데모당 최대 100회 체험. AI 호출은 등록된 모델 키를 사용하며 비용이
            발생할 수 있습니다. 운영 대화·신청·월 세션 과금과 분리되며 실제
            상담원 연결·외부 알림은 보내지 않습니다. 만료·해제 후 데이터는 정리
            작업으로 삭제됩니다.
          </p>
          <button className="cp-button" disabled={busy}>
            {busy ? "처리 중…" : "데모 만들기"}
          </button>
        </form>
      </section>
      {link && (
        <section className="cp-panel">
          <h2>공유 링크가 준비됐어요</h2>
          <p className="cp-note">
            링크는 지금 한 번 표시됩니다. 복사해 보관하거나 새 데모를
            생성해주세요.
          </p>
          <input
            className="cp-input"
            aria-label="데모 공유 링크"
            readOnly
            value={link}
          />
          <div className="cp-row">
            <button
              className="cp-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  setError("링크를 직접 선택해 복사해주세요.");
                }
              }}
            >
              {copied ? "복사했습니다" : "링크 복사"}
            </button>
            <a
              className="cp-link"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
            >
              데모 열기
            </a>
          </div>
        </section>
      )}
      <section className="cp-panel">
        <h2>생성한 데모</h2>
        {query.isPending ? (
          <SkeletonList rows={3} label="데모 목록을 불러오는 중입니다." />
        ) : (
        <div className="cp-table-wrap">
          <table className="cp-table">
            <thead>
              <tr>
                <th>고객사·챗봇</th>
                <th>홈페이지</th>
                <th>만료</th>
                <th>체험</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.customer_name}
                    <br />
                    {d.bot_name}
                  </td>
                  <td>{d.site_url}</td>
                  <td>
                    {new Date(Number(d.expires_at) * 1000).toLocaleString(
                      "ko-KR",
                      { timeZone: "Asia/Seoul" },
                    )}
                  </td>
                  <td>
                    {d.request_count}/{d.max_requests}
                  </td>
                  <td>
                    {d.revoked_at ? (
                      "해제됨"
                    ) : (
                      <button
                        className="cp-link"
                        disabled={busy}
                        onClick={() => void revoke(d.id)}
                      >
                        링크 해제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {!query.isPending && !items.length && <p className="cp-note">아직 만든 데모가 없습니다.</p>}
      </section>
    </div>
  );
}
