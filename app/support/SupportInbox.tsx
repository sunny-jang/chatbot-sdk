"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { filterInbox, draftAfterSend } from "@/lib/workspace-inbox";
import { useInvalidate } from "@/lib/query/api";
import { SkeletonList, SkeletonPanel } from "@/app/components/Skeleton";
type Handoff = {
  id: string;
  session_id: string;
  status: string;
  reason: string | null;
  bot_name: string;
  customer_name: string | null;
  assigned_agent_name: string | null;
  assigned_agent_user_id?: string | null;
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
/** 고객사 권한이 바뀌어 401·403·404가 오면 재시도하지 않고 권한 안내 화면으로 바꾼다. */
class DeniedError extends Error {}
async function fetchInbox<T>(
  url: string,
  signal: AbortSignal,
  checkDenied: boolean,
  failMessage: string,
): Promise<T> {
  const r = await fetch(url, { cache: "no-store", signal });
  if (checkDenied && [401, 403, 404].includes(r.status))
    throw new DeniedError(failMessage);
  if (!r.ok) throw new Error(failMessage);
  return (await r.json()) as T;
}
const retryUnlessDenied = (count: number, error: Error) =>
  !(error instanceof DeniedError) && count < 1;
export default function SupportInbox({
  initialSession,
  initialStatus,
  endpoint = "/api/support/handoffs",
  portalUserId,
  canReassign = false,
}: {
  initialSession: string;
  initialStatus: string;
  endpoint?: string;
  portalUserId?: string;
  canReassign?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(initialSession),
    [filter, setFilter] = useState(initialStatus),
    [query, setQuery] = useState(""),
    // 서버 검색어는 입력이 250ms 멈춘 뒤에만 바꿔 요청 수를 줄인다(화면 목록은 바로 거른다).
    [searchKey, setSearchKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const [acting, setActing] = useState(false),
    [sending, setSending] = useState(false);
  const [denied, setDenied] = useState(false);
  const sendKeys = useRef<Record<string, { message: string; key: string }>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const messagesBox = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const invalidate = useInvalidate();
  const inboxKey = ["support-inbox", endpoint] as const;
  const checkDenied = Boolean(portalUserId);
  const listQuery = useQuery<Handoff[], Error>({
    queryKey: [
      ...inboxKey,
      "list",
      { status: filter, q: searchKey, selectedSession: selectedId },
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        status: filter,
        q: searchKey,
        selectedSession: selectedId,
      });
      try {
        return await fetchInbox<Handoff[]>(
          `${endpoint}?${params}`,
          signal,
          checkDenied,
          "상담 목록을 불러오지 못했어요. 다시 시도해 주세요.",
        );
      } catch (e) {
        if (e instanceof DeniedError) setDenied(true);
        throw e;
      }
    },
    enabled: !denied,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: retryUnlessDenied,
  });
  const messagesQuery = useQuery<Message[], Error>({
    queryKey: [...inboxKey, "messages", selectedId],
    queryFn: async ({ signal }) => {
      try {
        return await fetchInbox<Message[]>(
          `${endpoint}?sessionId=${encodeURIComponent(selectedId)}`,
          signal,
          checkDenied,
          "대화를 불러오지 못했어요. 잠시 후 다시 시도합니다.",
        );
      } catch (e) {
        if (e instanceof DeniedError) setDenied(true);
        throw e;
      }
    },
    enabled: Boolean(selectedId) && !denied,
    refetchInterval: 2500,
    refetchIntervalInBackground: false,
    retry: retryUnlessDenied,
  });
  const items = listQuery.data ?? [];
  const messages = messagesQuery.data;
  const listError =
    listQuery.error && !(listQuery.error instanceof DeniedError)
      ? listQuery.error.message
      : "";
  const messageError =
    messagesQuery.error && !(messagesQuery.error instanceof DeniedError)
      ? messagesQuery.error.message
      : "";
  useEffect(() => {
    const box = messagesBox.current;
    if (box && messages && followLatest.current)
      box.scrollTop = box.scrollHeight;
  }, [messages, selectedId]);
  function select(sessionId: string) {
    followLatest.current = true;
    setSelectedId(sessionId);
  }
  function deny() {
    setDenied(true);
    setDrafts({});
  }
  const current = items.find((i) => i.session_id === selectedId);
  const text = drafts[selectedId] || "";
  const visible = filterInbox(items, filter, query);
  async function action(action: "accept" | "close" | "assign") {
    if (!current || acting) return;
    setActing(true);
    setError("");
    try {
      const r = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: current.session_id,
          action,
          ...(action === "assign" ? { assignee: portalUserId } : {}),
        }),
      });
      if (portalUserId && [401, 403, 404].includes(r.status)) {
        deny();
        return;
      }
      if (!r.ok)
        throw new Error("상담 상태를 변경하지 못했어요. 다시 시도해 주세요.");
      await invalidate(inboxKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "상태를 변경하지 못했어요.");
    } finally {
      setActing(false);
    }
  }
  async function send() {
    if (
      !current ||
      denied ||
      current.status === "closed" ||
      sending ||
      !text.trim() ||
      (portalUserId && current.assigned_agent_user_id !== portalUserId)
    )
      return;
    const session = current.session_id,
      message = text;
    const previousKey = sendKeys.current[session];
    const idempotencyKey =
      previousKey?.message === message ? previousKey.key : crypto.randomUUID();
    sendKeys.current[session] = { message, key: idempotencyKey };
    setSending(true);
    setError("");
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session, message, idempotencyKey }),
      });
      if (portalUserId && [401, 403, 404].includes(r.status)) {
        deny();
        return;
      }
      if (!r.ok)
        throw new Error("전송하지 못했어요. 작성한 답변은 유지됩니다.");
      setDrafts((d) => ({
        ...d,
        [session]: draftAfterSend(d[session], message),
      }));
      await invalidate(inboxKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "전송하지 못했어요.");
    } finally {
      setSending(false);
    }
  }
  if (denied)
    return (
      <div className="workspace-page">
        <h1>상담 접근 권한이 변경되었습니다</h1>
        <p>현재 고객사에 다시 접근하려면 담당 관리자에게 확인해주세요.</p>
        <Link href="/customer">고객사 다시 선택</Link>
      </div>
    );
  return (
    <div className="workspace-page">
      <header className="workspace-page-heading">
        <div>
          <h1>상담함</h1>
          <p>대화 맥락을 확인하고, 고객에게 바로 답변하세요.</p>
        </div>
        <span className="inbox-live">5초마다 목록 갱신</span>
      </header>
      {listError && (
        <div className="inbox-error" role="alert">
          {listError}
          <button onClick={() => void listQuery.refetch()}>다시 불러오기</button>
        </div>
      )}
      {error && (
        <div className="inbox-error" role="alert">
          {error}
          <button onClick={() => setError("")}>닫기</button>
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
              maxLength={100}
              value={query}
              onChange={(e) => {
                const value = e.target.value;
                setQuery(value);
                clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(
                  () => setSearchKey(value.trim().slice(0, 100)),
                  250,
                );
              }}
            />
            <p>목록 {visible.length}건 · 조건에 맞는 상담 최대 200건</p>
          </div>
          {listQuery.isPending ? (
            <SkeletonList rows={5} label="상담을 불러오는 중이에요." />
          ) : visible.length ? (
            visible.map((item) => (
              <button
                key={item.id}
                className={`inbox-item ${selectedId === item.session_id ? "selected" : ""}`}
                aria-pressed={selectedId === item.session_id}
                onClick={() => select(item.session_id)}
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
                  {portalUserId &&
                    canReassign &&
                    current.status !== "closed" &&
                    current.assigned_agent_user_id &&
                    current.assigned_agent_user_id !== portalUserId && (
                      <button
                        disabled={acting}
                        onClick={() => void action("assign")}
                      >
                        내가 이어받기
                      </button>
                    )}
                  <button
                    className="workspace-primary"
                    disabled={
                      acting ||
                      (portalUserId
                        ? current.status === "closed" ||
                          Boolean(current.assigned_agent_user_id)
                        : current.status !== "waiting")
                    }
                    onClick={() => void action("accept")}
                  >
                    {acting ? "처리 중" : "상담 시작"}
                  </button>
                  <button
                    disabled={
                      acting ||
                      current.status === "closed" ||
                      Boolean(
                        portalUserId &&
                        current.assigned_agent_user_id !== portalUserId,
                      )
                    }
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
              <div
                className="inbox-messages"
                aria-label="대화 내용"
                ref={messagesBox}
                onScroll={(e) => {
                  const box = e.currentTarget;
                  followLatest.current =
                    box.scrollHeight - box.scrollTop - box.clientHeight < 80;
                }}
              >
                {messagesQuery.isPending ? (
                  <SkeletonPanel lines={4} label="대화를 불러오는 중이에요." />
                ) : (
                  (messages ?? []).map((m) =>
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
                    onChange={(e) => {
                      const value = e.target.value;
                      setDrafts((d) => ({ ...d, [selectedId]: value }));
                    }}
                  />
                  <div>
                    <small>
                      {portalUserId &&
                      current.assigned_agent_user_id !== portalUserId
                        ? "상담을 시작하거나 인계를 받으면 답변할 수 있어요."
                        : "답변은 전송 버튼을 눌러 보내세요."}
                    </small>
                    <button
                      className="workspace-primary"
                      disabled={
                        sending ||
                        !text.trim() ||
                        Boolean(
                          portalUserId &&
                          current.assigned_agent_user_id !== portalUserId,
                        )
                      }
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
