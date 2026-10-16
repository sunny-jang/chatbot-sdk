"use client";
import { useCallback, useEffect, useState } from "react";
import { filterInbox, draftAfterSend } from "@/lib/workspace-inbox";
type Handoff = {
  id: string;
  session_id: string;
  status: string;
  reason: string | null;
  bot_name: string;
  customer_name: string | null;
  assigned_agent_name: string | null;
  requested_at: number;
  summary: string | null;
  summary_status: string;
  last_message: string | null;
};
type Message = {
  id: string;
  sender_type: string;
  sender_name: string | null;
  content: string;
  created_at: number;
};
const labels: Record<string, string> = {
  waiting: "대기 중",
  active: "상담 중",
  closed: "종료",
};
export default function SupportInbox({
  initialSession,
}: {
  initialSession: string;
}) {
  const [items, setItems] = useState<Handoff[]>([]),
    [selectedId, setSelectedId] = useState(initialSession),
    [filter, setFilter] = useState("waiting"),
    [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{
    session: string;
    rows: Message[];
  }>({ session: "", rows: [] });
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [messageError, setMessageError] = useState("");
  const [acting, setActing] = useState(false),
    [sending, setSending] = useState(false),
    [revision, setRevision] = useState(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch("/api/support/handoffs", {
        cache: "no-store",
        signal,
      });
      if (!r.ok)
        throw new Error("상담 목록을 불러오지 못했어요. 다시 시도해 주세요.");
      const rows: Handoff[] = await r.json();
      setItems(rows);
      setError("");
    } catch (e) {
      if (!signal?.aborted)
        setError(
          e instanceof Error ? e.message : "상담 목록을 불러오지 못했어요.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const first = setTimeout(() => void load(controller.signal), 0);
    const timer = setInterval(() => void load(controller.signal), 5000);
    return () => {
      controller.abort();
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const r = await fetch(
          `/api/support/handoffs?sessionId=${encodeURIComponent(selectedId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!r.ok) throw new Error("대화를 불러오지 못했어요.");
        const rows: Message[] = await r.json();
        if (!controller.signal.aborted) {
          setMessages({ session: selectedId, rows });
          setMessageError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setMessageError("대화를 불러오지 못했어요. 잠시 후 다시 시도합니다.");
      }
    }
    const first = setTimeout(refresh, 0),
      timer = setInterval(refresh, 2500);
    return () => {
      controller.abort();
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [selectedId, revision]);
  const current = items.find((i) => i.session_id === selectedId);
  const text = drafts[selectedId] || "";
  const visible = filterInbox(items, filter, query);
  async function action(action: "accept" | "close") {
    if (!current || acting) return;
    setActing(true);
    try {
      const r = await fetch("/api/support/handoffs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: current.session_id, action }),
      });
      if (!r.ok)
        throw new Error("상담 상태를 변경하지 못했어요. 다시 시도해 주세요.");
      await load();
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "상태를 변경하지 못했어요.");
    } finally {
      setActing(false);
    }
  }
  async function send() {
    if (!current || current.status === "closed" || sending || !text.trim())
      return;
    const session = current.session_id,
      message = text;
    setSending(true);
    try {
      const r = await fetch("/api/support/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session, message }),
      });
      if (!r.ok)
        throw new Error("전송하지 못했어요. 작성한 답변은 유지됩니다.");
      setDrafts((d) => ({
        ...d,
        [session]: draftAfterSend(d[session], message),
      }));
      await load();
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "전송하지 못했어요.");
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="workspace-page">
      <header className="workspace-page-heading">
        <div>
          <h1>상담함</h1>
          <p>대화 맥락을 확인하고, 고객에게 바로 답변하세요.</p>
        </div>
        <span className="inbox-live">5초마다 목록 갱신</span>
      </header>
      {error && (
        <div className="inbox-error" role="alert">
          {error}
          <button onClick={() => void load()}>다시 불러오기</button>
        </div>
      )}
      <div className={`inbox-layout ${current ? "has-selection" : ""}`}>
        <section className="inbox-list" aria-label="상담 목록">
          <div className="inbox-list-tools">
            <nav className="workspace-filter-tabs" aria-label="상담 상태">
              {[
                ["waiting", "대기"],
                ["active", "상담 중"],
                ["closed", "종료"],
                ["", "전체"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={filter === value ? "selected" : ""}
                  aria-pressed={filter === value}
                >
                  {label}
                </button>
              ))}
            </nav>
            <input
              aria-label="고객 또는 챗봇 검색"
              placeholder="고객 또는 챗봇 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p>목록 {visible.length}건 · 최근 상담 200건에서 조회</p>
          </div>
          {loading ? (
            <div className="workspace-empty" role="status">
              상담을 불러오는 중이에요.
            </div>
          ) : visible.length ? (
            visible.map((item) => (
              <button
                key={item.id}
                className={`inbox-item ${selectedId === item.session_id ? "selected" : ""}`}
                aria-pressed={selectedId === item.session_id}
                onClick={() => setSelectedId(item.session_id)}
              >
                <div>
                  <strong>{item.customer_name || "방문 고객"}</strong>
                  <span className={`workspace-status ${item.status}`}>
                    {labels[item.status] || item.status}
                  </span>
                </div>
                <p>{item.bot_name}</p>
                <span className="inbox-preview">
                  {item.last_message || item.reason || "담당자 연결 요청"}
                </span>
              </button>
            ))
          ) : (
            <div className="workspace-empty">
              <strong>표시할 상담이 없어요</strong>
              <p>
                {query
                  ? "검색어나 상태 필터를 바꿔 보세요."
                  : "고객이 담당자 연결을 요청하면 여기에서 확인할 수 있어요."}
              </p>
            </div>
          )}
        </section>
        <section className="inbox-conversation" aria-label="선택한 상담">
          {current ? (
            <>
              <header className="inbox-conversation-header">
                <div>
                  <button
                    className="inbox-back"
                    onClick={() => setSelectedId("")}
                  >
                    목록으로
                  </button>
                  <h2>
                    {current.customer_name || "방문 고객"}{" "}
                    <span className={`workspace-status ${current.status}`}>
                      {labels[current.status]}
                    </span>
                  </h2>
                  <p>
                    {current.bot_name}
                    {current.assigned_agent_name
                      ? ` · 담당 ${current.assigned_agent_name}`
                      : ""}
                  </p>
                </div>
                <div className="inbox-actions">
                  <button
                    className="workspace-primary"
                    disabled={acting || current.status !== "waiting"}
                    onClick={() => void action("accept")}
                  >
                    {acting ? "처리 중" : "상담 시작"}
                  </button>
                  <button
                    disabled={acting || current.status === "closed"}
                    onClick={() => void action("close")}
                  >
                    상담 종료
                  </button>
                </div>
              </header>
              {current.summary && (
                <details className="inbox-summary" open>
                  <summary>
                    이전 대화 요약{" "}
                    <span>
                      {current.summary_status === "generated"
                        ? "AI 요약"
                        : "최근 대화 발췌"}
                    </span>
                  </summary>
                  <p>{current.summary}</p>
                </details>
              )}
              {messageError && (
                <p className="inbox-error" role="alert">
                  {messageError}
                </p>
              )}
              <div className="inbox-messages" aria-label="대화 내용">
                {messages.session !== selectedId ? (
                  <p role="status">대화를 불러오는 중이에요.</p>
                ) : (
                  messages.rows.map((m) =>
                    m.sender_type === "system" ? (
                      <p className="inbox-system" key={m.id}>
                        {m.content}
                      </p>
                    ) : (
                      <article
                        key={m.id}
                        className={`inbox-message ${m.sender_type === "agent" ? "agent" : ""}`}
                      >
                        <small>
                          {m.sender_name ||
                            {
                              customer: "고객",
                              agent: "담당자",
                              bot: "AI 상담",
                            }[m.sender_type] ||
                            "안내"}
                        </small>
                        <p>{m.content}</p>
                        <time
                          dateTime={new Date(
                            Number(m.created_at) * 1000,
                          ).toISOString()}
                        >
                          {new Date(
                            Number(m.created_at) * 1000,
                          ).toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Seoul",
                          })}
                        </time>
                      </article>
                    ),
                  )
                )}
              </div>
              {current.status === "closed" ? (
                <p className="inbox-closed">
                  종료된 상담입니다. 대화 내용을 확인할 수 있어요.
                </p>
              ) : (
                <form
                  className="inbox-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <label className="sr-only" htmlFor="inbox-reply">
                    고객에게 답변
                  </label>
                  <textarea
                    id="inbox-reply"
                    rows={3}
                    value={text}
                    placeholder="고객에게 답변을 작성하세요"
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [selectedId]: e.target.value }))
                    }
                  />
                  <div>
                    <small>답변은 전송 버튼을 눌러 보내세요.</small>
                    <button
                      className="workspace-primary"
                      disabled={sending || !text.trim()}
                      type="submit"
                    >
                      {sending ? "전송 중" : "답변 전송"}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="workspace-empty inbox-placeholder">
              <span aria-hidden="true">☏</span>
              <strong>상담을 선택해 주세요</strong>
              <p>
                고객과 AI가 나눈 대화, 인계 요약을 함께 보면서 답변할 수 있어요.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
