"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Item = {
  id: string;
  question: string;
  bot_reply: string;
  session_id: string;
  created_at: number;
  status: string;
  deleted_answer: boolean;
  linked_question: string | null;
};
type Folder = { id: string; name: string };
const button = "rounded-lg border px-3 py-2 text-sm disabled:opacity-50";
export default function UnansweredManager({
  botId,
  days,
}: {
  botId: string;
  days: number;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [folders, setFolders] = useState<Folder[]>([]),
    [status, setStatus] = useState("pending"),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Item | null>(null),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState(""),
    [folder, setFolder] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [duplicate, setDuplicate] = useState<{
      id: string;
      question: string;
    } | null>(null);
  const questionInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    questionInput.current?.focus();
  }, [selected]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/bots/${botId}/unanswered?days=${days}&status=${status}&page=${page}`,
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setItems(d.items);
      setFolders(d.folders);
      setTotal(d.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [botId, days, status, page]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  async function submit(qaId?: string) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/bots/${botId}/unanswered`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: selected.id,
          question,
          answer,
          folderId: folder || null,
          qaId,
        }),
      });
      const d = await r.json();
      if (d.duplicate) setDuplicate(d.duplicate);
      if (!r.ok) throw Error(d.error);
      setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록 실패");
    } finally {
      setBusy(false);
    }
  }
  async function change(item: Item, next: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/bots/${botId}/unanswered`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId: item.id, status: next }),
      });
      if (!r.ok) throw Error((await r.json()).error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 mt-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="font-bold">미응답 질문 보완</h2>
          <p className="text-sm text-gray-500 mt-1">
            질문을 검토하고 바로 Q&A에 등록하세요.
          </p>
        </div>
        <select
          aria-label="처리 상태"
          className={button}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="pending">미처리</option>
          <option value="resolved">보완 완료</option>
          <option value="excluded">제외</option>
          <option value="all">전체</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="text-red-600 text-sm mt-3">
          {error}
        </p>
      )}
      {loading ? (
        <p className="p-5 text-gray-500">불러오는 중...</p>
      ) : items.length ? (
        items.map((item) => (
          <article key={item.id} className="border-t border-gray-200 py-4 mt-2">
            <p className="font-medium break-words">{item.question}</p>
            <p className="text-xs text-gray-500 mt-1">
              {new Date(Number(item.created_at) * 1000).toLocaleString(
                "ko-KR",
                { timeZone: "Asia/Seoul" },
              )}{" "}
              ·{" "}
              {
                (
                  {
                    pending: "미처리",
                    resolved: "보완 완료",
                    excluded: "제외",
                  } as Record<string, string>
                )[item.status]
              }
              {item.deleted_answer && " · 연결 답변 삭제됨"}
            </p>
            <details className="text-sm mt-2">
              <summary>대화 확인</summary>
              <p className="whitespace-pre-wrap mt-2">
                당시 답변: {item.bot_reply}
              </p>
              <a
                className="text-violet-600"
                href={`/bots/${botId}/logs?sessionId=${encodeURIComponent(item.session_id)}`}
              >
                세션 대화 기록 열기
              </a>
            </details>
            <div className="flex gap-2 mt-3">
              {item.status === "pending" && (
                <>
                  <button
                    className={button + " bg-violet-600 text-white"}
                    onClick={() => {
                      setSelected(item);
                      setQuestion(item.question);
                      setAnswer("");
                      setFolder("");
                      setDuplicate(null);
                      setError("");
                    }}
                  >
                    답변 등록
                  </button>
                  <button
                    disabled={busy}
                    className={button}
                    onClick={() => change(item, "excluded")}
                  >
                    제외
                  </button>
                </>
              )}
              {item.status !== "pending" && (
                <button
                  disabled={busy}
                  className={button}
                  onClick={() => change(item, "pending")}
                >
                  미처리로 복원
                </button>
              )}
            </div>
          </article>
        ))
      ) : (
        <p className="p-8 text-center text-gray-500">해당 질문이 없습니다.</p>
      )}
      <div className="flex items-center gap-3 mt-4 text-sm">
        <button
          className={button}
          disabled={page === 1 || loading}
          onClick={() => setPage(page - 1)}
        >
          이전
        </button>
        <span>
          {page}페이지 · {total}건
        </span>
        <button
          className={button}
          disabled={page * 20 >= total || loading}
          onClick={() => setPage(page + 1)}
        >
          다음
        </button>
      </div>
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-label="미응답 답변 등록"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) {
                event.preventDefault();
                setSelected(null);
              }
              if (event.key === "Tab") {
                const elements = Array.from(
                  event.currentTarget.querySelectorAll<
                    | HTMLInputElement
                    | HTMLButtonElement
                    | HTMLSelectElement
                    | HTMLTextAreaElement
                  >("input,button,select,textarea"),
                ).filter((el) => !el.disabled);
                const first = elements[0],
                  last = elements.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                }
                if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
            className="bg-white rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-auto"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h3 className="text-lg font-bold mb-4">Q&A 답변 등록</h3>
            <label className="block text-sm">
              질문
              <input
                ref={questionInput}
                required
                maxLength={2000}
                className="border border-gray-200 rounded-lg w-full p-2 my-2"
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  setDuplicate(null);
                }}
              />
            </label>
            <label className="block text-sm">
              답변
              <textarea
                required
                maxLength={20000}
                rows={7}
                className="border border-gray-200 rounded-lg w-full p-2 my-2"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              폴더
              <select
                className="border border-gray-200 rounded-lg w-full p-2 my-2"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              >
                <option value="">미분류</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="text-red-600 text-sm">
                {error}
              </p>
            )}
            {duplicate && (
              <button
                type="button"
                disabled={busy}
                className={button + " mt-2"}
                onClick={() => submit(duplicate.id)}
              >
                기존 Q&A 연결: {duplicate.question}
              </button>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() => setSelected(null)}
              >
                취소
              </button>
              <button
                disabled={busy}
                className={button + " bg-violet-600 text-white"}
              >
                {busy ? "등록 중..." : "등록"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
