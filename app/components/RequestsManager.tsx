"use client";
import { useCallback, useEffect, useState } from "react";
type Item = {
  id: string;
  receipt: string;
  kind: string;
  name: string;
  company: string;
  message: string;
  status: string;
  created_at: number;
};
type Detail = Item & {
  email: string;
  phone: string;
  consent_text: string;
  summary: string;
  retention_days: number;
  notes: { id: string; content: string; created_at: number }[];
  jobs: { channel: string; status: string; last_error: string | null }[];
  messages: { sender_type: string; content: string; created_at: number }[];
};
const labels: Record<string, string> = {
  new: "신규",
  in_progress: "처리 중",
  completed: "완료",
  quote: "견적 요청",
  consultation: "상담 신청",
};
export default function RequestsManager({ botId }: { botId: string }) {
  const [items, setItems] = useState<Item[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [status, setStatus] = useState("all"),
    [kind, setKind] = useState("all"),
    [search, setSearch] = useState(""),
    [days, setDays] = useState(90),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/bots/${botId}/requests?status=${status}&kind=${kind}&search=${encodeURIComponent(search)}&page=${page}&days=${days}`,
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setItems(d.items);
      setTotal(d.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [botId, status, kind, search, page, days]);
  const select = useCallback(
    async (id: string) => {
      setError("");
      try {
        const r = await fetch(
          `/api/bots/${botId}/requests?requestId=${encodeURIComponent(id)}`,
        );
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setDetail(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : "조회 실패");
      }
    },
    [botId],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("requestId");
    if (!id) return;
    const timer = setTimeout(() => void select(id), 0);
    return () => clearTimeout(timer);
  }, [select]);
  async function change(data: Record<string, string>) {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/bots/${botId}/requests`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: detail.id, ...data }),
      });
      if (!r.ok) throw Error((await r.json()).error);
      setNote("");
      await select(detail.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setBusy(false);
    }
  }
  const input = "border border-gray-200 rounded-lg p-2 text-sm",
    button = input + " disabled:opacity-40";
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-lg font-bold mb-4">접수 관리</h2>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          aria-label="신청 검색"
          placeholder="이름·문의·접수번호 검색"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className={input}
        />
        <select
          aria-label="접수 상태"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className={input}
        >
          <option value="all">전체 상태</option>
          {["new", "in_progress", "completed"].map((s) => (
            <option key={s} value={s}>
              {labels[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="신청 유형"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
          className={input}
        >
          <option value="all">전체 유형</option>
          <option value="quote">견적 요청</option>
          <option value="consultation">상담 신청</option>
        </select>
        <select
          aria-label="조회 기간"
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setPage(1);
          }}
          className={input}
        >
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              최근 {d}일
            </option>
          ))}
        </select>
        <button
          className={button}
          onClick={() => {
            void load();
            if (detail) void select(detail.id);
          }}
        >
          새로고침
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-600 text-sm my-2">
          {error}
        </p>
      )}
      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          {loading ? (
            <p className="p-6 text-gray-500">불러오는 중...</p>
          ) : items.length ? (
            items.map((i) => (
              <button
                key={i.id}
                onClick={() => select(i.id)}
                className={`block w-full text-left border border-gray-200 rounded-lg p-3 mb-2 ${detail?.id === i.id ? "bg-violet-50 border-violet-300" : ""}`}
              >
                <div className="flex justify-between text-sm">
                  <b>
                    {i.name} · {labels[i.kind]}
                  </b>
                  <span>{labels[i.status]}</span>
                </div>
                <p className="text-sm mt-1 truncate">{i.message}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {new Date(Number(i.created_at) * 1000).toLocaleString(
                    "ko-KR",
                    { timeZone: "Asia/Seoul" },
                  )}
                </p>
              </button>
            ))
          ) : (
            <p className="p-8 text-center text-gray-500">
              접수된 신청이 없습니다.
            </p>
          )}
          <div className="flex gap-3 items-center text-sm mt-4">
            <button
              disabled={page === 1}
              className={button}
              onClick={() => setPage(page - 1)}
            >
              이전
            </button>
            <span>
              {page}페이지 · {total}건
            </span>
            <button
              disabled={page * 20 >= total}
              className={button}
              onClick={() => setPage(page + 1)}
            >
              다음
            </button>
          </div>
        </div>
        {detail ? (
          <article className="border border-gray-200 rounded-xl p-4">
            <h3 className="font-bold">
              {detail.name} · {labels[detail.kind]}
            </h3>
            <p className="text-xs break-all text-gray-500 my-2">
              접수번호: {detail.receipt}
            </p>
            <p className="text-sm">
              회사: {detail.company || "미입력"}
              <br />
              이메일: {detail.email || "미입력"}
              <br />
              전화: {detail.phone || "미입력"}
            </p>
            <p className="whitespace-pre-wrap text-sm my-4">{detail.message}</p>
            <label className="text-sm">
              처리 상태
              <select
                className={input + " ml-2"}
                disabled={busy}
                value={detail.status}
                onChange={(e) => change({ status: e.target.value })}
              >
                {["new", "in_progress", "completed"].map((s) => (
                  <option key={s} value={s}>
                    {labels[s]}
                  </option>
                ))}
              </select>
            </label>
            {detail.summary && (
              <details open className="mt-4 bg-violet-50 p-3 rounded-lg">
                <summary>대화 요약·발췌</summary>
                <p className="text-sm whitespace-pre-wrap mt-2">
                  {detail.summary}
                </p>
              </details>
            )}
            <details className="my-4">
              <summary className="text-sm">
                이전 대화 ({detail.messages.length}건)
              </summary>
              {detail.messages.map((m, i) => (
                <p
                  key={i}
                  className="text-sm whitespace-pre-wrap py-2 border-b"
                >
                  {(
                    {
                      customer: "고객",
                      bot: "챗봇",
                      agent: "상담원",
                      system: "안내",
                    } as Record<string, string>
                  )[m.sender_type] || "메시지"}
                  : {m.content}
                </p>
              ))}
            </details>
            <details className="my-4">
              <summary className="text-sm">동의 기록·보유 기간</summary>
              <p className="text-xs whitespace-pre-wrap mt-2">
                {detail.consent_text}
                <br />
                동의:{" "}
                {new Date(Number(detail.created_at) * 1000).toLocaleString(
                  "ko-KR",
                  { timeZone: "Asia/Seoul" },
                )}
                <br />
                보유: {detail.retention_days}일
              </p>
            </details>
            <div className="text-sm border-t pt-3">
              알림:{" "}
              {detail.jobs
                .map(
                  (j) =>
                    `${({ local: "접수 후 처리", slack: "Slack", telegram: "Telegram" } as Record<string, string>)[j.channel] || j.channel}: ${({ pending: "대기", processing: "처리 중", sent: "완료", failed: "실패" } as Record<string, string>)[j.status] || j.status}`,
                )
                .join(" / ") || "대기"}
              {detail.jobs.some((j) => j.status === "failed") && (
                <button
                  disabled={busy}
                  className={button + " ml-2"}
                  onClick={() => change({ action: "retry" })}
                >
                  실패 알림 재시도
                </button>
              )}
            </div>
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void change({ action: "note", note });
              }}
            >
              <label className="text-sm">
                내부 메모
                <textarea
                  className={input + " w-full mt-1"}
                  required
                  maxLength={3000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !note.trim()}
                className={button + " mt-2"}
              >
                메모 저장
              </button>
            </form>
            {detail.notes.map((n) => (
              <p
                key={n.id}
                className="text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded-lg mt-2"
              >
                {n.content}
              </p>
            ))}
          </article>
        ) : (
          <p className="text-gray-400 text-center p-12">
            신청을 선택하면 내용을 확인할 수 있습니다.
          </p>
        )}
      </div>
    </section>
  );
}
