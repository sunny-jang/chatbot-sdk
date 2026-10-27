"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Connection = { id: string; name: string; kind: "postgres" | "mysql"; status: "untested" | "ok" | "error"; table_count: number | null };
type TableInfo = { name: string; kind: "table" | "view"; rowEstimate: number | null };
type ColumnInfo = { name: string; type: string; nullable: boolean };
type Role = "title" | "key" | "body" | "excluded";
type ColumnDraft = { column: string; type: string; role: Role; label: string; unit: string; valueMap: Record<string, string>; personal: boolean };
type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "is_null" | "not_null";
type Filter = { column: string; op: FilterOp; value: string };
type SyncResult = { created: number; updated: number; unchanged: number; archived: number; deleted: number; failed: number; truncated: number; total: number; finishedAt: number; error?: string };
type Source = {
  id: string;
  connectionId: string;
  connectionName: string | null;
  connectionDeleted: boolean;
  tableLabel: string;
  folderName: string | null;
  schedule: "manual" | "hourly" | "daily" | "weekly";
  rowLimit: number;
  enabled: boolean;
  lastSyncedAt: number | null;
  nextSyncAt: number | null;
  lastResult: SyncResult | null;
  lastError: string | null;
  consecutiveFailures: number;
  syncing: boolean;
};
type ImportState = { processed: number; total: number; truncated: number; created: number; updated: number; unchanged: number; failed: number; archived: number; deleted: number; done: boolean; cursor: unknown };
type Preview = { documents: { title: string; content: string }[]; answers: { question: string; title: string | null; answer: string | null; note: string | null }[] };

const ROLE_LABEL: Record<Role, string> = { title: "제목", key: "고유키", body: "본문", excluded: "제외" };
const OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "같음", needsValue: true },
  { value: "neq", label: "같지 않음", needsValue: true },
  { value: "gt", label: "보다 큼", needsValue: true },
  { value: "gte", label: "이상", needsValue: true },
  { value: "lt", label: "보다 작음", needsValue: true },
  { value: "lte", label: "이하", needsValue: true },
  { value: "in", label: "다음 중 하나(쉼표)", needsValue: true },
  { value: "not_in", label: "다음 제외(쉼표)", needsValue: true },
  { value: "not_null", label: "값이 있음", needsValue: false },
  { value: "is_null", label: "값이 비어 있음", needsValue: false },
];
const SCHEDULE_LABEL = { manual: "수동", hourly: "매시간", daily: "매일 새벽", weekly: "매주" } as const;
const isNumberType = (t: string) => /int|numeric|decimal|double|real|float|money|serial|number/i.test(t);
const when = (t: number | null) =>
  t ? new Date(t * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }) : null;
const n = (v: number) => v.toLocaleString("ko-KR");
const mapText = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k}=${v}`).join(", ");
function parseMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(/[,\n]/)) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(),
      v = part.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}
function summary(r: SyncResult | null) {
  if (!r) return null;
  const parts = [`반영 ${n(r.created)}`, `갱신 ${n(r.updated)}`];
  if (r.unchanged) parts.push(`변경 없음 ${n(r.unchanged)}`);
  if (r.archived) parts.push(`보관 ${n(r.archived)}`);
  if (r.deleted) parts.push(`삭제 ${n(r.deleted)}`);
  if (r.failed) parts.push(`실패 ${n(r.failed)}`);
  return parts.join(" · ");
}

/**
 * 챗봇 지식의 "DB에서 가져오기". 에이전시 문서 화면과 고객사 데스크 지식 탭이 같은 컴포넌트를 쓴다.
 * 흐름: 연결·테이블 선택 → 컬럼 역할(초안) → 필터·폴더·주기 → 답변 미리보기 → 저장하고 가져오기(진행률).
 */
export default function DbSourceManager({
  apiBase,
  folders,
  settingsHref,
  onApplied,
}: {
  apiBase: string;
  folders: { id: string; name: string }[];
  settingsHref: string | null;
  onApplied?: () => void;
}) {
  const endpoint = `${apiBase}/db-sources`;
  const [loaded, setLoaded] = useState(false),
    [assigned, setAssigned] = useState(true),
    [connections, setConnections] = useState<Connection[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [open, setOpen] = useState(false),
    [connectionId, setConnectionId] = useState(""),
    [tables, setTables] = useState<TableInfo[] | null>(null),
    [table, setTable] = useState(""),
    [columns, setColumns] = useState<ColumnInfo[]>([]),
    [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([]),
    [draft, setDraft] = useState<ColumnDraft[]>([]),
    [draftedBy, setDraftedBy] = useState<"ai" | "rules" | null>(null),
    [mapTexts, setMapTexts] = useState<Record<string, string>>({}),
    [filters, setFilters] = useState<Filter[]>([]),
    [folder, setFolder] = useState(""),
    [schedule, setSchedule] = useState<Source["schedule"]>("daily"),
    [questions, setQuestions] = useState<string[]>(["", "", ""]),
    [preview, setPreview] = useState<Preview | null>(null),
    [progress, setProgress] = useState<{ sourceId: string; state: ImportState } | null>(null),
    [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(d.error || "요청을 처리하지 못했어요.");
      return d;
    },
    [endpoint],
  );
  const load = useCallback(async () => {
    const r = await fetch(endpoint, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || "DB 소스를 불러오지 못했어요.");
    setAssigned(d.assigned !== false);
    setConnections(d.connections ?? []);
    setSources(d.sources ?? []);
    setLoaded(true);
  }, [endpoint]);
  useEffect(() => {
    const t = setTimeout(() => void load().catch((e) => { setError(e.message); setLoaded(true); }), 0);
    return () => clearTimeout(t);
  }, [load]);

  function resetWizard() {
    setConnectionId("");
    setTables(null);
    setTable("");
    setColumns([]);
    setSampleRows([]);
    setDraft([]);
    setDraftedBy(null);
    setMapTexts({});
    setFilters([]);
    setFolder("");
    setSchedule("daily");
    setQuestions(["", "", ""]);
    setPreview(null);
  }
  async function pickConnection(id: string) {
    setConnectionId(id);
    setTables(null);
    setTable("");
    setDraft([]);
    setPreview(null);
    if (!id) return;
    setBusy("tables");
    setError("");
    try {
      const d = await post({ action: "tables", connectionId: id });
      setTables(d.tables);
    } catch (e) {
      setError(e instanceof Error ? e.message : "테이블을 불러오지 못했어요.");
    } finally {
      setBusy(null);
    }
  }
  async function pickTable(name: string) {
    setTable(name);
    setDraft([]);
    setPreview(null);
    setFilters([]);
    if (!name) return;
    setBusy("draft");
    setError("");
    try {
      const d = await post({ action: "draft", connectionId, table: name });
      setColumns(d.columns);
      setSampleRows(d.rows);
      setDraft(d.draft.columns);
      setDraftedBy(d.draft.draftedBy);
      setMapTexts(Object.fromEntries(d.draft.columns.map((c: ColumnDraft) => [c.column, mapText(c.valueMap)])));
      setQuestions([0, 1, 2].map((i) => d.draft.questions[i] ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "테이블을 읽지 못했어요.");
    } finally {
      setBusy(null);
    }
  }
  function setRole(column: string, role: Role) {
    setPreview(null);
    setDraft((prev) =>
      prev.map((c) => {
        if (c.column === column) return { ...c, role };
        // 제목·고유키는 하나뿐이다. 다른 컬럼이 같은 역할이면 본문으로 내린다.
        if ((role === "title" || role === "key") && c.role === role) return { ...c, role: "body" };
        return c;
      }),
    );
  }
  const patch = (column: string, change: Partial<ColumnDraft>) => {
    setPreview(null);
    setDraft((prev) => prev.map((c) => (c.column === column ? { ...c, ...change } : c)));
  };

  const config = useMemo(() => {
    const title = draft.find((c) => c.role === "title");
    const key = draft.find((c) => c.role === "key");
    const [schema, tableName] = table.includes(".") ? [table.slice(0, table.indexOf(".")), table.slice(table.indexOf(".") + 1)] : ["public", table];
    return {
      connectionId,
      schema,
      table: tableName,
      titleColumn: title?.column ?? "",
      keyColumn: key?.column ?? "",
      bodyColumns: draft
        .filter((c) => c.role === "body")
        .map((c) => ({ column: c.column, label: c.label.trim() || c.column, unit: c.unit.trim(), valueMap: parseMap(mapTexts[c.column] ?? "") })),
      excludedColumns: draft.filter((c) => c.role === "excluded").map((c) => c.column),
      filters: filters
        .filter((f) => f.column)
        .map((f) => {
          const type = columns.find((c) => c.name === f.column)?.type ?? "";
          const kind = isNumberType(type) ? "number" : "text";
          const list = f.op === "in" || f.op === "not_in";
          return { column: f.column, op: f.op, kind, value: list ? f.value.split(",").map((v) => v.trim()).filter(Boolean) : f.value };
        }),
      folderId: folder || null,
      schedule,
    };
  }, [draft, mapTexts, filters, columns, connectionId, table, folder, schedule]);
  const problems = useMemo(() => {
    const list: string[] = [];
    if (!config.titleColumn) list.push("제목 컬럼을 하나 골라주세요.");
    if (!config.keyColumn) list.push("고유키 컬럼을 골라주세요.");
    if (!config.bodyColumns.length) list.push("본문에 넣을 컬럼을 하나 이상 골라주세요.");
    for (const f of filters) {
      const op = OPS.find((o) => o.value === f.op);
      if (f.column && op?.needsValue && !f.value.trim()) list.push(`필터(${f.column}) 값을 입력해주세요.`);
    }
    return list;
  }, [config, filters]);
  const personalIncluded = draft.filter((c) => c.personal && c.role !== "excluded");

  async function runPreview() {
    setBusy("preview");
    setError("");
    try {
      setPreview(await post({ action: "preview", ...config, questions: questions.filter((q) => q.trim()) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "미리보기를 만들지 못했어요.");
    } finally {
      setBusy(null);
    }
  }
  async function runImport(sourceId: string) {
    setBusy("import:" + sourceId);
    setError("");
    setNotice("");
    let state: ImportState | null = null;
    try {
      do {
        const d = await post({ action: "import", sourceId, ...(state ? { state } : {}) });
        state = d.state as ImportState;
        setProgress({ sourceId, state });
      } while (state && !state.done);
      const s = state!;
      setNotice(
        s.total === 0
          ? "가져올 행이 없어요. 필터 조건을 확인해주세요."
          : `가져오기를 마쳤어요. 반영 ${n(s.created)} · 갱신 ${n(s.updated)}${s.unchanged ? ` · 변경 없음 ${n(s.unchanged)}` : ""}${s.failed ? ` · 실패 ${n(s.failed)}` : ""}${
              s.truncated ? ` — ${n(s.truncated)}행이 상한(${n(s.total)}행)을 넘어 제외됐어요. 필터를 좁히거나 상한을 올려주세요.` : ""
            }`,
      );
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "가져오지 못했어요.");
    } finally {
      setBusy(null);
      setProgress(null);
      await load().catch(() => null);
    }
  }
  async function saveAndImport() {
    setBusy("create");
    setError("");
    try {
      const created = await post({ action: "create", ...config });
      setOpen(false);
      resetWizard();
      await load().catch(() => null);
      await runImport(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
      setBusy(null);
    }
  }
  async function removeSource(sourceId: string, documents: "archive" | "delete") {
    setBusy("delete:" + sourceId);
    setError("");
    try {
      await post({ action: "delete", sourceId, documents });
      setConfirmDelete(null);
      setNotice(documents === "delete" ? "소스와 가져온 문서를 삭제했어요." : "소스를 삭제했어요. 가져온 문서는 보관돼 검색에서 빠졌어요.");
      await load();
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="cp-panel dbs" aria-labelledby="dbs-title">
      <div className="dbs-head">
        <div>
          <h2 id="dbs-title">DB에서 가져오기</h2>
          <p className="cp-note">
            고객사 DB의 테이블을 연결하면 행 하나가 문서 하나가 돼요. 원본 DB는 읽기만 하고, 정한 주기로 바뀐 행만 다시 가져와요.
          </p>
        </div>
        {loaded && assigned && connections.length > 0 && !open && (
          <button type="button" className="cp-button" disabled={busy !== null} onClick={() => { resetWizard(); setOpen(true); setNotice(""); }}>
            테이블 추가
          </button>
        )}
      </div>

      {!loaded && (
        <p className="cp-note dbs-loading" role="status"><span className="cp-spinner" aria-hidden="true" /> 불러오는 중…</p>
      )}
      {loaded && !assigned && (
        <p className="cp-callout">이 챗봇이 아직 고객사에 배정되지 않았어요. 고객사에 배정한 뒤 그 고객사의 DB를 연결할 수 있어요.</p>
      )}
      {loaded && assigned && connections.length === 0 && (
        <div className="cp-callout dbs-empty">
          <strong>먼저 데이터 연결을 추가해주세요</strong>
          <span>고객사 설정의 “데이터 연결”에서 DB 접속 정보를 저장하면 여기서 테이블을 고를 수 있어요.</span>
          {settingsHref && (
            <Link className="cp-button cp-button-secondary" href={settingsHref}>
              데이터 연결 추가하기
            </Link>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <ul className="cp-list dbs-list">
          {sources.map((s) => {
            const running = busy === "import:" + s.id || s.syncing;
            const p = progress?.sourceId === s.id ? progress.state : null;
            return (
              <li key={s.id}>
                <div className="dbs-source-main">
                  <div className="dbs-source-title">
                    <strong>{s.tableLabel}</strong>
                    <span className="cp-chip muted">{s.connectionName ?? "연결"}</span>
                    {s.connectionDeleted ? (
                      <span className="cp-chip warn">연결 삭제됨</span>
                    ) : !s.enabled ? (
                      <span className="cp-chip warn">자동 동기화 멈춤</span>
                    ) : s.lastError ? (
                      <span className="cp-chip warn">마지막 실행 실패</span>
                    ) : s.lastSyncedAt ? (
                      <span className="cp-chip ok">정상</span>
                    ) : (
                      <span className="cp-chip muted">가져오기 전</span>
                    )}
                  </div>
                  <small>
                    {SCHEDULE_LABEL[s.schedule]} · 폴더 {s.folderName ?? "미분류"} · 상한 {n(s.rowLimit)}행
                    {s.lastSyncedAt ? ` · 마지막 ${when(s.lastSyncedAt)}` : ""}
                  </small>
                  {s.lastResult && !s.lastError && <small>{summary(s.lastResult)}{s.lastResult.truncated ? ` · 상한 초과 ${n(s.lastResult.truncated)}행 제외` : ""}</small>}
                  {s.lastError && <small className="cp-conn-error" role="alert">{s.lastError}</small>}
                  {p && (
                    <div className="dbs-progress" role="status" aria-live="polite">
                      <div className="dbs-progress-label">
                        <span><span className="cp-spinner" aria-hidden="true" /> 행을 문서로 만들고 있어요</span>
                        <span>{n(p.processed)}/{n(p.total)}</span>
                      </div>
                      <div className="dbs-progress-bar"><i style={{ width: `${p.total ? Math.min(100, Math.round((p.processed / p.total) * 100)) : 100}%` }} /></div>
                    </div>
                  )}
                </div>
                <div className="cp-row dbs-source-actions">
                  <button type="button" className="cp-button cp-button-secondary" disabled={busy !== null || running || s.connectionDeleted} onClick={() => void runImport(s.id)}>
                    {running ? "가져오는 중…" : "지금 다시 가져오기"}
                  </button>
                  {confirmDelete === s.id ? (
                    <span className="dbs-confirm">
                      <button type="button" className="cp-link" disabled={busy !== null} onClick={() => void removeSource(s.id, "archive")}>문서는 보관하고 삭제</button>
                      <button type="button" className="cp-link cp-conn-delete" disabled={busy !== null} onClick={() => void removeSource(s.id, "delete")}>문서까지 삭제</button>
                      <button type="button" className="cp-link" onClick={() => setConfirmDelete(null)}>취소</button>
                    </span>
                  ) : (
                    <button type="button" className="cp-link cp-conn-delete" disabled={busy !== null} onClick={() => setConfirmDelete(s.id)}>삭제</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {notice && <p className="cp-note dbs-notice" role="status">{notice}</p>}
      {error && <p className="cp-error" role="alert">{error}</p>}

      {open && (
        <div className="dbs-wizard">
          <div className="dbs-step">
            <h3><span className="dbs-step-no">1</span>연결과 테이블</h3>
            <div className="dbs-grid">
              <label>
                데이터 연결
                <select className="cp-input" value={connectionId} disabled={busy !== null} onChange={(e) => void pickConnection(e.target.value)}>
                  <option value="">연결 선택</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.status === "error" ? " (연결 오류)" : ""}</option>
                  ))}
                </select>
              </label>
              <label>
                테이블
                <select className="cp-input" value={table} disabled={!tables || busy !== null} onChange={(e) => void pickTable(e.target.value)}>
                  <option value="">{busy === "tables" ? "불러오는 중…" : tables ? "테이블 선택" : "먼저 연결을 고르세요"}</option>
                  {tables?.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}{t.kind === "view" ? " (뷰)" : ""}{t.rowEstimate !== null ? ` · 약 ${n(t.rowEstimate)}행` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {busy === "draft" && <p className="cp-note dbs-loading" role="status"><span className="cp-spinner" aria-hidden="true" /> 컬럼을 읽고 역할을 제안하고 있어요…</p>}
          </div>

          {draft.length > 0 && (
            <>
              <div className="dbs-step">
                <h3><span className="dbs-step-no">2</span>컬럼 역할</h3>
                <p className="cp-note">
                  {draftedBy === "ai" ? "AI가 제안한 역할이에요." : "컬럼 이름과 값으로 역할을 제안했어요."} 틀린 것만 고쳐주세요. 제목은 문서 제목, 본문은 “라벨: 값” 줄로 들어가요.
                </p>
                <div className="dbs-table-wrap">
                  <table className="cp-table dbs-columns">
                    <thead>
                      <tr><th>컬럼</th><th>역할</th><th>라벨</th><th>단위</th><th>값 바꾸기</th></tr>
                    </thead>
                    <tbody>
                      {draft.map((c) => (
                        <tr key={c.column} className={c.role === "excluded" ? "is-excluded" : undefined}>
                          <td>
                            <strong>{c.column}</strong>
                            <small>{c.type}{c.personal && <span className="cp-chip warn dbs-pii">개인정보 추정</span>}</small>
                          </td>
                          <td>
                            <select className="cp-input" aria-label={`${c.column} 역할`} value={c.role} onChange={(e) => setRole(c.column, e.target.value as Role)}>
                              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                            </select>
                          </td>
                          {c.role === "body" ? (
                            <>
                              <td><input className="cp-input" aria-label={`${c.column} 라벨`} value={c.label} maxLength={40} onChange={(e) => patch(c.column, { label: e.target.value })} /></td>
                              <td><input className="cp-input dbs-unit" aria-label={`${c.column} 단위`} value={c.unit} maxLength={10} placeholder="없음" onChange={(e) => patch(c.column, { unit: e.target.value })} /></td>
                              <td>
                                <input
                                  className="cp-input"
                                  aria-label={`${c.column} 값 바꾸기`}
                                  value={mapTexts[c.column] ?? ""}
                                  placeholder="예: 1=판매중, 0=품절"
                                  onChange={(e) => { setPreview(null); setMapTexts((m) => ({ ...m, [c.column]: e.target.value })); }}
                                />
                              </td>
                            </>
                          ) : (
                            <td colSpan={3} className="dbs-role-note">
                              {c.role === "title" ? "문서 제목으로 쓰여요." : c.role === "key" ? "바뀐 행을 찾는 데만 쓰고 본문에는 넣지 않아요." : "가져오지 않아요."}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {personalIncluded.length > 0 && (
                  <p className="cp-error" role="alert">
                    개인정보로 보이는 컬럼({personalIncluded.map((c) => c.column).join(", ")})이 포함돼 있어요. 챗봇이 방문자에게 이 값을 답할 수 있어요. 꼭 필요한 경우에만 포함하세요.
                  </p>
                )}
                {sampleRows.length > 0 && (
                  <details className="dbs-sample">
                    <summary>원본 행 {sampleRows.length}개 보기</summary>
                    <div className="dbs-table-wrap">
                      <table className="cp-table">
                        <thead><tr>{columns.map((c) => <th key={c.name}>{c.name}</th>)}</tr></thead>
                        <tbody>
                          {sampleRows.map((r, i) => (
                            <tr key={i}>{columns.map((c) => <td key={c.name}>{r[c.name] === null || r[c.name] === undefined ? "" : String(r[c.name]).slice(0, 60)}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>

              <div className="dbs-step">
                <h3><span className="dbs-step-no">3</span>가져올 범위</h3>
                <div className="dbs-filters">
                  {filters.length === 0 && <p className="cp-note">조건이 없으면 모든 행을 가져와요. 예: 판매중인 것만 → is_active 같음 1</p>}
                  {filters.map((f, i) => {
                    const op = OPS.find((o) => o.value === f.op)!;
                    return (
                      <div className="dbs-filter" key={i}>
                        <select className="cp-input" aria-label="필터 컬럼" value={f.column} onChange={(e) => { setPreview(null); setFilters((list) => list.map((x, j) => (j === i ? { ...x, column: e.target.value } : x))); }}>
                          <option value="">컬럼</option>
                          {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                        <select className="cp-input" aria-label="필터 조건" value={f.op} onChange={(e) => { setPreview(null); setFilters((list) => list.map((x, j) => (j === i ? { ...x, op: e.target.value as FilterOp } : x))); }}>
                          {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input className="cp-input" aria-label="필터 값" value={f.value} disabled={!op.needsValue} placeholder={op.needsValue ? "값" : ""} onChange={(e) => { setPreview(null); setFilters((list) => list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x))); }} />
                        <button type="button" className="cp-link" onClick={() => { setPreview(null); setFilters((list) => list.filter((_, j) => j !== i)); }}>빼기</button>
                      </div>
                    );
                  })}
                  {filters.length < 10 && (
                    <button type="button" className="cp-link" onClick={() => setFilters((list) => [...list, { column: "", op: "eq", value: "" }])}>+ 조건 추가</button>
                  )}
                </div>
                <div className="dbs-grid">
                  <label>
                    저장할 폴더
                    <select className="cp-input" value={folder} onChange={(e) => setFolder(e.target.value)}>
                      <option value="">미분류</option>
                      {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </label>
                  <label>
                    다시 가져오는 주기
                    <select className="cp-input" value={schedule} onChange={(e) => setSchedule(e.target.value as Source["schedule"])}>
                      {(Object.keys(SCHEDULE_LABEL) as Source["schedule"][]).map((k) => <option key={k} value={k}>{SCHEDULE_LABEL[k]}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              <div className="dbs-step">
                <h3><span className="dbs-step-no">4</span>답변 미리보기</h3>
                <p className="cp-note">앞쪽 3행을 문서로 만들어 보고, 질문마다 어떤 문서가 근거로 쓰이는지 확인해요.</p>
                <div className="dbs-questions">
                  {questions.map((q, i) => (
                    <input key={i} className="cp-input" aria-label={`미리보기 질문 ${i + 1}`} value={q} maxLength={200} placeholder={`질문 ${i + 1}`} onChange={(e) => setQuestions((list) => list.map((x, j) => (j === i ? e.target.value : x)))} />
                  ))}
                </div>
                <div className="cp-row">
                  <button type="button" className="cp-button cp-button-secondary" disabled={busy !== null || problems.length > 0} onClick={() => void runPreview()}>
                    {busy === "preview" ? "만드는 중…" : "미리보기"}
                  </button>
                </div>
                {preview && (
                  <div className="dbs-preview">
                    {preview.documents.length === 0 ? (
                      <p className="cp-note">조건에 맞는 행이 없어요. 필터를 확인해주세요.</p>
                    ) : (
                      <div className="dbs-docs">
                        {preview.documents.map((d, i) => (
                          <article key={i}>
                            <strong>{d.title}</strong>
                            <pre>{d.content}</pre>
                          </article>
                        ))}
                      </div>
                    )}
                    {preview.answers.length > 0 && (
                      <ul className="cp-list dbs-answers">
                        {preview.answers.map((a, i) => (
                          <li key={i}>
                            <div>
                              <strong>{a.question}</strong>
                              {a.answer && <p>{a.answer}</p>}
                              <small>근거 문서: {a.title ?? "없음"}{a.note ? ` · ${a.note}` : ""}</small>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {problems.length > 0 && (
                <ul className="dbs-problems" role="alert">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
            </>
          )}

          <div className="cp-row dbs-wizard-actions">
            <button type="button" className="cp-button" disabled={busy !== null || draft.length === 0 || problems.length > 0} onClick={() => void saveAndImport()}>
              {busy === "create" ? "저장 중…" : "저장하고 가져오기"}
            </button>
            <button type="button" className="cp-button cp-button-secondary" disabled={busy === "create"} onClick={() => { setOpen(false); resetWizard(); setError(""); }}>
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
