"use client";
import { useEffect, useState } from "react";
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
  new: "신규",
  in_progress: "처리 중",
  completed: "완료",
};
export default function CustomerRequests({
  customerId,
}: {
  customerId: string;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [status, setStatus] = useState(""),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(false),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const endpoint = `/api/customer/${customerId}/requests`;
  useEffect(() => {
    if (denied) return;
    const c = new AbortController();
    async function load() {
      try {
        const r = await fetch(
          endpoint + "?" + new URLSearchParams({ status, q }),
          { signal: c.signal, cache: "no-store" },
        );
        if ([401, 403, 404].includes(r.status)) {
          setDenied(true);
          setItems([]);
          setDetail(null);
          setNote("");
          return;
        }
        if (!r.ok) throw Error("접수 목록을 불러오지 못했습니다.");
        setItems((await r.json()).items);
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
  }, [endpoint, status, q, revision, denied]);
  useEffect(() => {
    if (!selected || denied) return;
    const c = new AbortController();
    async function load() {
      try {
        const r = await fetch(
          endpoint + "?requestId=" + encodeURIComponent(selected),
          { signal: c.signal, cache: "no-store" },
        );
        if ([401, 403, 404].includes(r.status)) {
          setDenied(true);
          setDetail(null);
          setNote("");
          return;
        }
        if (!r.ok) throw Error();
        setDetail(await r.json());
      } catch {
        if (!c.signal.aborted) setError("신청 내용을 불러오지 못했습니다.");
      }
    }
    void load();
    return () => c.abort();
  }, [endpoint, selected, revision, denied]);
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
        setItems([]);
        setDetail(null);
        setNote("");
        return;
      }
      if (!r.ok) throw Error((await r.json()).error || "저장하지 못했습니다.");
      setNote("");
      setRevision((v) => v + 1);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  if (denied)
    return (
      <div className="cp-panel">
        <h1>고객사 접근 권한이 변경되었습니다</h1>
        <a className="cp-link" href="/customer">
          고객사 다시 선택
        </a>
      </div>
    );
  return (
    <div>
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
      <div className="cp-panel">
        <div className="cp-row">
          <label>
            처리 상태{" "}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">전체</option>
              {Object.entries(labels).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            신청 검색
            <input
              className="cp-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름·문의 내용·접수번호"
            />
          </label>
          <span className="cp-note">최근 100건</span>
        </div>
        <div className="cp-table-wrap">
          <table className="cp-table">
            <thead>
              <tr>
                <th>신청자·문의</th>
                <th>챗봇</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="cp-link"
                      onClick={() => {
                        setSelected(r.id);
                        setDetail(null);
                        setNote("");
                      }}
                    >
                      {r.name} · {r.message.slice(0, 70)}
                    </button>
                  </td>
                  <td>{r.bot_name}</td>
                  <td>{labels[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!items.length && (
          <p className="cp-note">이 조건에 맞는 신청이 없습니다.</p>
        )}
      </div>
      {detail && detail.id === selected && (
        <section className="cp-panel cp-details">
          <h2>
            {detail.name}님의{" "}
            {detail.kind === "quote" ? "견적 요청" : "상담 신청"}
          </h2>
          <p>{detail.receipt}</p>
          <p>{detail.email || detail.phone || "연락처 없음"}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{detail.message}</p>
          <label>
            처리 상태{" "}
            <select
              disabled={busy}
              value={detail.status}
              onChange={(e) => void update({ status: e.target.value })}
            >
              {Object.entries(labels).map(([v, t]) => (
                <option value={v} key={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <h3>내부 메모</h3>
          {detail.notes.map((n, i) => (
            <p key={i} style={{ whiteSpace: "pre-wrap" }}>
              {n.content}
            </p>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void update({ action: "note", note });
            }}
          >
            <label>
              새 메모
              <textarea
                className="cp-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={3000}
              />
            </label>
            <button className="cp-button" disabled={busy || !note.trim()}>
              메모 저장
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
