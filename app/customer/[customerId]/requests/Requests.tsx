"use client";
import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useInvalidate } from "@/lib/query/api";
import { SkeletonList, SkeletonPanel } from "@/app/components/Skeleton";
type Item = {
  id: string;
  name: string;
  receipt: string;
  kind: string;
  message: string;
  status: string;
  bot_name: string;
  created_at: number;
};
type Detail = Item & {
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: { content: string; created_at: number }[];
};
const labels: Record<string, string> = {
  new: "접수",
  in_progress: "처리 중",
  completed: "답변 완료",
};
const chipTone: Record<string, string> = {
  new: "warn",
  in_progress: "",
  completed: "ok",
};
const when = (t: number) =>
  new Date(Number(t) * 1000).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
/** 상태 변경은 API가 "상태 변경: new → in_progress" 메모로 남깁니다. 히스토리에서는 사람 말로 보여줍니다. */
function historyEntry(content: string) {
  const m = /^상태 변경:\s*(\w+)\s*→\s*(\w+)\s*$/.exec(content.trim());
  if (!m) return { title: "상담 메모", body: content, system: false };
  return {
    title: `상태 변경: ${labels[m[1]] ?? m[1]} → ${labels[m[2]] ?? m[2]}`,
    body: "",
    system: true,
  };
}
/** 고객사 권한이 바뀌어 401·403·404가 오면 재시도하지 않고 권한 안내 화면으로 바꾼다. */
class DeniedError extends Error {}
async function fetchRequests<T>(
  url: string,
  signal: AbortSignal,
  failMessage: string,
): Promise<T> {
  const r = await fetch(url, { signal, cache: "no-store" });
  if ([401, 403, 404].includes(r.status)) throw new DeniedError(failMessage);
  if (!r.ok) throw Error(failMessage);
  return (await r.json()) as T;
}
const retryUnlessDenied = (count: number, error: Error) =>
  !(error instanceof DeniedError) && count < 1;
function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}
export default function CustomerRequests({
  customerId,
}: {
  customerId: string;
}) {
  const [status, setStatus] = useState(""),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState(""),
    [note, setNote] = useState(""),
    [actionError, setActionError] = useState(""),
    [denied, setDenied] = useState(false),
    [busy, setBusy] = useState(false);
  const endpoint = `/api/customer/${customerId}/requests`;
  const requestsKey = ["customer", customerId, "requests"] as const;
  const invalidate = useInvalidate();
  const listQuery = useQuery<{ items: Item[] }, Error>({
    queryKey: [...requestsKey, "list", { status, q }],
    queryFn: async ({ signal }) => {
      try {
        return await fetchRequests<{ items: Item[] }>(
          endpoint + "?" + new URLSearchParams({ status, q }),
          signal,
          "접수 목록을 불러오지 못했습니다.",
        );
      } catch (e) {
        if (e instanceof DeniedError) setDenied(true);
        throw e;
      }
    },
    enabled: !denied,
    placeholderData: keepPreviousData,
    retry: retryUnlessDenied,
  });
  const detailQuery = useQuery<Detail, Error>({
    queryKey: [...requestsKey, "detail", selected],
    queryFn: async ({ signal }) => {
      try {
        return await fetchRequests<Detail>(
          endpoint + "?requestId=" + encodeURIComponent(selected),
          signal,
          "신청 내용을 불러오지 못했습니다.",
        );
      } catch (e) {
        if (e instanceof DeniedError) setDenied(true);
        throw e;
      }
    },
    enabled: Boolean(selected) && !denied,
    retry: retryUnlessDenied,
  });
  const items = listQuery.data?.items ?? [];
  const detail = selected ? (detailQuery.data ?? null) : null;
  const error =
    actionError ||
    listQuery.error?.message ||
    (selected ? detailQuery.error?.message : "") ||
    "";
  async function update(input: Record<string, string>) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const r = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: selected, ...input }),
      });
      if ([401, 403, 404].includes(r.status)) {
        setDenied(true);
        setNote("");
        return;
      }
      if (!r.ok) throw Error((await r.json()).error || "저장하지 못했습니다.");
      setNote("");
      setActionError("");
      await invalidate(requestsKey);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  if (denied)
    return (
      <div className="cp-panel">
        <h1>고객사 접근 권한이 변경되었습니다</h1>
        <Link className="cp-link" href="/customer">
          고객사 다시 선택
        </Link>
      </div>
    );
  return (
    <div className="cp-requests">
      <header className="workspace-page-heading">
        <div>
          <h1>문의·견적</h1>
          <p>우리 회사로 접수된 신청을 확인하고 처리하세요.</p>
        </div>
      </header>
      {error && (
        <p role="alert" className="cp-error">
          {error}
        </p>
      )}
      <div className="cp-panel cp-filterbar">
        <label>
          처리 상태
          <select
            className="cp-input"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setActionError("");
            }}
          >
            <option value="">전체</option>
            {Object.entries(labels).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="cp-filterbar-search">
          신청 검색
          <span className="cp-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              className="cp-input"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActionError("");
              }}
              placeholder="이름·문의 내용·접수번호로 검색하세요."
            />
          </span>
        </label>
        <span className="cp-note cp-filterbar-count">
          {items.length ? `${items.length}건` : ""} · 최근 100건
        </span>
      </div>

      <div className="cp-panel cp-request-list">
        <div className="cp-request-head" aria-hidden="true">
          <span>신청자·문의</span>
          <span>챗봇</span>
          <span>접수일</span>
          <span>상태</span>
          <span />
        </div>
        {listQuery.isPending ? (
          <SkeletonList rows={5} label="접수 목록을 불러오는 중입니다." />
        ) : (
          items.map((r) => (
          <button
            key={r.id}
            type="button"
            className="cp-request-row"
            aria-pressed={r.id === selected}
            onClick={() => {
              setSelected(r.id);
              setNote("");
            }}
          >
            <span className="cp-request-main">
              <span className="cp-request-icon">
                <DocIcon />
              </span>
              <span>
                <strong>
                  {r.name} <i>·</i> {r.message.slice(0, 70)}
                </strong>
                <small>
                  {r.receipt}
                  <i>|</i>
                  {r.kind === "quote" ? "견적 요청" : "상담 신청"}
                  <span
                    className={`cp-chip cp-chip-inline ${chipTone[r.status] ?? "muted"}`}
                  >
                    {labels[r.status] ?? r.status}
                  </span>
                </small>
              </span>
            </span>
            <span className="cp-request-cell cp-request-bot">{r.bot_name}</span>
            <span className="cp-request-cell cp-request-date">
              {when(r.created_at)}
            </span>
            <span className="cp-request-cell cp-request-status">
              <span className={`cp-chip ${chipTone[r.status] ?? "muted"}`}>
                {labels[r.status] ?? r.status}
              </span>
            </span>
            <span className="cp-request-chevron" aria-hidden="true">
              ›
            </span>
          </button>
          ))
        )}
        {!listQuery.isPending && !items.length && (
          <p className="cp-note cp-request-empty">
            이 조건에 맞는 신청이 없습니다.
          </p>
        )}
      </div>

      {selected && detailQuery.isPending && (
        <SkeletonPanel
          className="cp-panel"
          lines={5}
          label="신청 내용을 불러오는 중입니다."
        />
      )}
      {detail && detail.id === selected && (
        <div className="cp-request-detail">
          <section className="cp-panel">
            <header className="cp-detail-head">
              <span className="cp-request-icon">
                <DocIcon />
              </span>
              <h2>
                {detail.name}님의{" "}
                {detail.kind === "quote" ? "견적 요청" : "상담 신청"}
              </h2>
              <span className="cp-detail-meta">
                <span>
                  접수번호 <b>{detail.receipt}</b>
                </span>
                <i>|</i>
                <span>
                  접수일 <b>{when(detail.created_at)}</b>
                </span>
              </span>
            </header>
            <dl className="cp-facts">
              <div>
                <dt>신청자명</dt>
                <dd>{detail.name}</dd>
              </div>
              <div>
                <dt>연락처</dt>
                <dd>
                  {detail.email || detail.phone || "없음"}
                  {detail.email && detail.phone && (
                    <small>{detail.phone}</small>
                  )}
                </dd>
              </div>
              {detail.company && (
                <div>
                  <dt>회사</dt>
                  <dd>{detail.company}</dd>
                </div>
              )}
              <div className="cp-facts-wide">
                <dt>문의 내용</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{detail.message}</dd>
              </div>
            </dl>
            <h3>상태 변경</h3>
            <div className="cp-segment" role="group" aria-label="처리 상태">
              {Object.entries(labels).map(([v, t]) => (
                <button
                  key={v}
                  type="button"
                  disabled={busy}
                  aria-pressed={detail.status === v}
                  onClick={() =>
                    detail.status !== v && void update({ status: v })
                  }
                >
                  {t}
                </button>
              ))}
            </div>
            <form
              className="cp-memo-form"
              onSubmit={(e) => {
                e.preventDefault();
                void update({ action: "note", note });
              }}
            >
              <label>
                새 메모
                <textarea
                  className="cp-input"
                  rows={4}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={3000}
                  placeholder="상담 내용을 기록해 주세요."
                />
              </label>
              <div className="cp-memo-foot">
                <button className="cp-button" disabled={busy || !note.trim()}>
                  메모 저장
                </button>
                <small>{note.length}/3000</small>
              </div>
            </form>
          </section>
          <aside className="cp-panel cp-history">
            <h3>상담 히스토리</h3>
            <ol>
              <li>
                <strong>신청 접수</strong>
                <time>{when(detail.created_at)}</time>
                <p>
                  {detail.bot_name} 챗봇의{" "}
                  {detail.kind === "quote" ? "견적 요청" : "상담 신청"} 폼으로
                  접수되었습니다.
                </p>
              </li>
              {detail.notes.map((n, i) => {
                const e = historyEntry(n.content);
                return (
                  <li key={i} className={e.system ? "system" : undefined}>
                    <strong>{e.title}</strong>
                    <time>{when(n.created_at)}</time>
                    {e.body && (
                      <p style={{ whiteSpace: "pre-wrap" }}>{e.body}</p>
                    )}
                  </li>
                );
              })}
              {!detail.notes.some((n) => !historyEntry(n.content).system) && (
                <li className="muted">
                  <strong>상담 메모</strong>
                  <p>아직 작성된 메모가 없습니다.</p>
                </li>
              )}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
}
