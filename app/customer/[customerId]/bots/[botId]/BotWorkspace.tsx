"use client";
import WebSourceManager from "@/app/components/WebSourceManager";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_SUPPORT_HOURS,
  normalizeSupportHours,
} from "@/lib/supportHours";
import WidgetPreview from "@/app/components/WidgetPreview";
type Bot = {
  id: string;
  name: string;
  type: string;
  system_prompt: string | null;
  widget_title: string | null;
  widget_color: string | null;
  greeting_message: string | null;
  logo_url: string | null;
  support_mode: string;
  support_hours: unknown;
  force_unattended: boolean;
  public_token: string;
};
type RecordRow = {
  id: string;
  name?: string;
  title?: string;
  content?: string;
  question?: string;
  answer?: string;
  folder_id?: string | null;
  user_message?: string;
  bot_reply?: string;
  created_at?: number;
};
type Stats = {
  summary: {
    sessions: number;
    messages: number;
    refused: number;
    latency: number;
  };
  requests: { total: number; pending: number };
};
export default function BotWorkspace({
  customerId,
  bot,
  endpoint,
}: {
  customerId: string;
  bot: Bot;
  endpoint: string;
}) {
  const base = `/api/customer/${customerId}/bots/${bot.id}`;
  const [tab, setTab] = useState("settings"),
    [draft, setDraft] = useState({ ...bot }),
    [hours, setHours] = useState(
      normalizeSupportHours(bot.support_hours) || DEFAULT_SUPPORT_HOURS,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [rows, setRows] = useState<RecordRow[]>([]),
    [folders, setFolders] = useState<RecordRow[]>([]),
    [stats, setStats] = useState<Stats | null>(null),
    [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState<string | null>(null),
    [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [folder, setFolder] = useState(""),
    [folderName, setFolderName] = useState(""),
    [confirmDelete, setConfirmDelete] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  const kind = tab === "docs" ? "docs" : "qa";
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        if (["docs", "qa"].includes(tab)) {
          const responses = await Promise.all([
            fetch(`${base}/${tab}`, {
              signal: controller.signal,
              cache: "no-store",
            }),
            fetch(`${base}/${tab === "docs" ? "folders" : "qa-folders"}`, {
              signal: controller.signal,
              cache: "no-store",
            }),
          ]);
          const data = await Promise.all(responses.map((r) => r.json()));
          for (let i = 0; i < responses.length; i++)
            if (!responses[i].ok) throw Error(data[i].error);
          if (!controller.signal.aborted) {
            setRows(data[0]);
            setFolders(data[1]);
          }
        } else if (["analytics", "logs"].includes(tab)) {
          const r = await fetch(`${base}/${tab}`, {
              signal: controller.signal,
              cache: "no-store",
            }),
            d = await r.json();
          if (!r.ok) throw Error(d.error);
          if (!controller.signal.aborted) {
            if (tab === "analytics") setStats(d);
            else setRows(d);
          }
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    const initial = setTimeout(() => {
      setLoading(["docs", "qa", "analytics", "logs"].includes(tab));
      setError("");
      setNotice("");
      setRows([]);
      setStats(null);
      setEdit(null);
      setConfirmDelete(null);
      setTitle("");
      setContent("");
      setFolder("");
      void load();
    }, 0);
    return () => {
      clearTimeout(initial);
      controller.abort();
    };
  }, [base, tab, revision]);
  async function request(url: string, method: string, input?: unknown) {
    const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: input === undefined ? undefined : JSON.stringify(input),
      }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice("저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  function chooseTab(next: string) {
    setTab(next);
  }
  const snippet = `<script src="${endpoint}/chatbot-widget.js" data-endpoint="${endpoint}" data-bot-id="${bot.id}" data-bot-token="${bot.public_token}"></script>`;
  return (
    <div className="cp-bot-workspace">
      <Link className="cp-link" href={`/customer/${customerId}/bots`}>
        챗봇 목록
      </Link>
      <h1 className="cp-page-title">{draft.name}</h1>
      <nav className="cp-bot-tabs" aria-label="챗봇 관리 메뉴">
        {[
          ["settings", "응대 설정"],
          ["docs", "지식 문서"],
          ["qa", "Q&A"],
          ["test", "테스트"],
          ["installation", "설치"],
          ["analytics", "통계"],
          ["logs", "대화 기록"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={tab === value}
            onClick={() => chooseTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="cp-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="cp-note">
          {notice}
        </p>
      )}
      {tab === "settings" && (
        <section className="cp-panel">
          <h2>응대와 위젯 설정</h2>
          <form
            className="cp-details"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await request(base, "PATCH", {
                  name: draft.name,
                  widget_title: draft.widget_title,
                  widget_color: draft.widget_color || "#7c3aed",
                  greeting_message: draft.greeting_message || "",
                  system_prompt: draft.system_prompt || "",
                  support_mode: draft.support_mode,
                  force_unattended: draft.force_unattended,
                  support_hours: hours,
                });
              });
            }}
          >
            <label>
              챗봇 이름
              <input
                className="cp-input"
                value={draft.name}
                maxLength={100}
                required
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              위젯 제목
              <input
                className="cp-input"
                value={draft.widget_title || ""}
                maxLength={100}
                onChange={(e) =>
                  setDraft({ ...draft, widget_title: e.target.value })
                }
              />
            </label>
            <label>
              위젯 색상
              <input
                type="color"
                value={draft.widget_color || "#7c3aed"}
                onChange={(e) =>
                  setDraft({ ...draft, widget_color: e.target.value })
                }
              />
            </label>
            <label>
              인사말
              <textarea
                className="cp-input"
                value={draft.greeting_message || ""}
                maxLength={1000}
                onChange={(e) =>
                  setDraft({ ...draft, greeting_message: e.target.value })
                }
              />
            </label>
            <label>
              응대 지침
              <textarea
                className="cp-input"
                value={draft.system_prompt || ""}
                maxLength={10000}
                onChange={(e) =>
                  setDraft({ ...draft, system_prompt: e.target.value })
                }
              />
            </label>
            <label>
              상담 운영
              <select
                value={draft.support_mode}
                onChange={(e) =>
                  setDraft({ ...draft, support_mode: e.target.value })
                }
              >
                <option value="unattended">챗봇 상담</option>
                <option value="hybrid">상담 담당자 연결</option>
              </select>
            </label>
            <label className="cp-check">
              <input
                type="checkbox"
                checked={draft.force_unattended}
                onChange={(e) =>
                  setDraft({ ...draft, force_unattended: e.target.checked })
                }
              />
              지금은 챗봇 상담만 운영
            </label>
            <fieldset>
              <legend>상담원 연결 시간 · 한국 시간</legend>
              <label className="cp-check">
                <input
                  type="checkbox"
                  checked={hours.enabled}
                  onChange={(e) =>
                    setHours({ ...hours, enabled: e.target.checked })
                  }
                />
                시간 제한 사용
              </label>
              {hours.enabled && (
                <>
                  <div className="cp-row">
                    {["일", "월", "화", "수", "목", "금", "토"].map(
                      (day, i) => (
                        <label className="cp-check" key={day}>
                          <input
                            type="checkbox"
                            checked={hours.days.includes(i)}
                            onChange={(e) =>
                              setHours({
                                ...hours,
                                days: e.target.checked
                                  ? [...hours.days, i]
                                  : hours.days.filter((d) => d !== i),
                              })
                            }
                          />
                          {day}
                        </label>
                      ),
                    )}
                  </div>
                  <div className="cp-row">
                    <label>
                      시작
                      <input
                        type="time"
                        value={hours.start}
                        required
                        onChange={(e) =>
                          setHours({ ...hours, start: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      종료
                      <input
                        type="time"
                        value={hours.end}
                        required
                        onChange={(e) =>
                          setHours({ ...hours, end: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <p className="cp-note">
                    같은 시작·종료 시간은 선택 요일 24시간, 종료가 이르면 다음
                    날까지 운영합니다.
                  </p>
                </>
              )}
            </fieldset>
            <button className="cp-button" disabled={busy}>
              {busy ? "저장 중…" : "설정 저장"}
            </button>
          </form>
          <div className="cp-logo-editor">
            <img
              src={draft.logo_url || "/chatbot-default.svg"}
              width={56}
              height={56}
              alt="챗봇 로고"
            />
            <label>
              로고 변경
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void perform(async () => {
                    const form = new FormData();
                    form.set("file", file);
                    const r = await fetch(`${base}/logo`, {
                        method: "POST",
                        body: form,
                      }),
                      d = await r.json();
                    if (!r.ok) throw Error(d.error);
                    setDraft((prev) => ({ ...prev, logo_url: d.logo_url }));
                  });
                  e.target.value = "";
                }}
              />
            </label>
            <button
              className="cp-link"
              disabled={busy || !draft.logo_url}
              onClick={() =>
                void perform(async () => {
                  await request(`${base}/logo`, "DELETE");
                  setDraft({ ...draft, logo_url: null });
                })
              }
            >
              기본 아이콘 사용
            </button>
          </div>
        </section>
      )}
      {loading && (
        <p role="status" className="cp-note">
          불러오는 중입니다.
        </p>
      )}
      {["docs", "qa"].includes(tab) && (
        <section className="cp-panel">
          <h2>
            {tab === "docs" ? "문서 파일 가져오기" : "엑셀·CSV Q&A 가져오기"}
          </h2>
          <p className="cp-note">
            {tab === "docs"
              ? "TXT·Markdown·PDF·DOCX·HWP·HWPX 등, 파일당 최대 5MB"
              : "질문·답변 열이 있는 XLSX·CSV, 최대 5MB·100개 질문"}
          </p>
          <label>
            파일 선택
            <input
              type="file"
              disabled={busy}
              accept={
                tab === "docs"
                  ? ".txt,.md,.markdown,.csv,.json,.xml,.html,.htm,.pdf,.docx,.hwp,.hwpx"
                  : ".xlsx,.csv"
              }
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void perform(async () => {
                  const form = new FormData();
                  form.set("file", file);
                  form.set("folder_id", folder);
                  const r = await fetch(`${base}/${tab}/upload`, {
                      method: "POST",
                      body: form,
                    }),
                    d = await r.json();
                  if (!r.ok) throw Error(d.error);
                  setRevision((v) => v + 1);
                });
                e.target.value = "";
              }}
            />
          </label>
        </section>
      )}
      {tab === "docs" && (
        <WebSourceManager
          botId={bot.id}
          apiBase={base}
          folders={folders.map((f) => ({ id: f.id, name: f.name || "" }))}
        />
      )}
      {["docs", "qa"].includes(tab) && (
        <>
          <section className="cp-panel">
            <h2>
              {edit
                ? "내용 수정"
                : kind === "docs"
                  ? "지식 문서 추가"
                  : "질문과 답변 추가"}
            </h2>
            <form
              className="cp-details"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  await request(
                    `${base}/${kind}${edit ? "/" + edit : ""}`,
                    edit ? "PUT" : "POST",
                    kind === "docs"
                      ? { title, content, folder_id: folder || null }
                      : {
                          question: title,
                          answer: content,
                          folder_id: folder || null,
                        },
                  );
                  setRevision((v) => v + 1);
                });
              }}
            >
              <label>
                {kind === "docs" ? "제목" : "질문"}
                <input
                  className="cp-input"
                  value={title}
                  required
                  maxLength={kind === "docs" ? 300 : 2000}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                {kind === "docs" ? "본문" : "답변"}
                <textarea
                  className="cp-input cp-knowledge-text"
                  value={content}
                  required
                  maxLength={kind === "docs" ? 50000 : 20000}
                  onChange={(e) => setContent(e.target.value)}
                />
              </label>
              <label>
                폴더
                <select
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
              <div className="cp-row">
                <button className="cp-button" disabled={busy}>
                  {busy ? "저장 중…" : edit ? "수정 저장" : "추가"}
                </button>
                {edit && (
                  <button
                    type="button"
                    className="cp-link"
                    onClick={() => {
                      setEdit(null);
                      setTitle("");
                      setContent("");
                      setFolder("");
                    }}
                  >
                    수정 취소
                  </button>
                )}
              </div>
            </form>
            <p className="cp-note">
              저장할 때 검색용 임베딩을 생성합니다. 키 설정이나 생성에 실패하면
              입력을 유지하며 기존 지식은 바꾸지 않습니다.
            </p>
          </section>
          <section className="cp-panel">
            <h2>폴더 추가</h2>
            <form
              className="cp-row"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  await request(
                    `${base}/${kind === "docs" ? "folders" : "qa-folders"}`,
                    "POST",
                    { name: folderName },
                  );
                  setFolderName("");
                  setRevision((v) => v + 1);
                });
              }}
            >
              <label>
                폴더 이름
                <input
                  className="cp-input"
                  value={folderName}
                  required
                  maxLength={100}
                  onChange={(e) => setFolderName(e.target.value)}
                />
              </label>
              <button className="cp-button" disabled={busy}>
                폴더 추가
              </button>
            </form>
          </section>
          <section className="cp-panel">
            <h2>
              {kind === "docs" ? "등록 문서" : "등록 Q&A"} · {rows.length}개
            </h2>
            {rows.map((r) => (
              <article className="cp-knowledge-row" key={r.id}>
                <strong>{r.title || r.question}</strong>
                <p>{r.content || r.answer}</p>
                <div className="cp-row">
                  <button
                    className="cp-link"
                    onClick={() => {
                      setEdit(r.id);
                      setTitle(r.title || r.question || "");
                      setContent(r.content || r.answer || "");
                      setFolder(r.folder_id || "");
                    }}
                  >
                    수정
                  </button>
                  <button
                    className="cp-link"
                    disabled={busy}
                    onClick={() => setConfirmDelete(r.id)}
                  >
                    삭제
                  </button>
                  {confirmDelete === r.id && (
                    <>
                      <span>이 항목을 삭제할까요?</span>
                      <button
                        className="cp-button"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await request(`${base}/${kind}/${r.id}`, "DELETE");
                            setRevision((v) => v + 1);
                          })
                        }
                      >
                        삭제 확인
                      </button>
                      <button
                        className="cp-link"
                        onClick={() => setConfirmDelete(null)}
                      >
                        취소
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
            {!rows.length && !loading && (
              <p className="cp-note">등록된 항목이 없습니다.</p>
            )}
          </section>
        </>
      )}
      {tab === "test" && (
        <WidgetPreview botId={bot.id} botToken={bot.public_token} />
      )}
      {tab === "installation" && (
        <section className="cp-panel">
          <h2>홈페이지에 설치</h2>
          <p className="cp-note">
            아래 코드를 홈페이지의 &lt;/body&gt; 앞에 넣으세요. 이 토큰은 해당
            챗봇의 공개 위젯 전용이며 관리자 로그인이나 API 키를 대신하지
            않습니다.
          </p>
          <pre className="cp-install-code">{snippet}</pre>
          <button
            className="cp-button"
            onClick={() =>
              void perform(async () => {
                await navigator.clipboard.writeText(snippet);
              })
            }
          >
            설치 코드 복사
          </button>
        </section>
      )}
      {tab === "analytics" && (
        <section className="cp-panel">
          <h2>최근 30일 운영 통계</h2>
          {stats ? (
            <div className="cp-stats">
              {[
                ["대화 세션", stats.summary.sessions],
                ["메시지", stats.summary.messages],
                ["거절 응답", stats.summary.refused],
                ["접수", stats.requests.total],
                ["미처리 접수", stats.requests.pending],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <span>{label}</span>
                  <strong>{Number(value).toLocaleString()}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="cp-note">통계를 불러오는 중입니다.</p>
          )}
        </section>
      )}
      {tab === "logs" && (
        <section className="cp-panel">
          <h2>최근 대화 기록 · 최대 100건</h2>
          {rows.map((r) => (
            <article className="cp-knowledge-row" key={r.id}>
              <strong>{r.user_message}</strong>
              <p>{r.bot_reply}</p>
              <small className="cp-note">
                {r.created_at
                  ? new Date(r.created_at * 1000).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })
                  : ""}
              </small>
            </article>
          ))}
          {!rows.length && !loading && (
            <p className="cp-note">대화 기록이 없습니다.</p>
          )}
        </section>
      )}
    </div>
  );
}
