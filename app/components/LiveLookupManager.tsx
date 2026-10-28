"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Connection = { id: string; name: string; status: "untested" | "ok" | "error" };
type TableInfo = { name: string; kind: "table" | "view"; rowEstimate: number | null };
type Column = { name: string; type: string; personal: boolean; label: string; unit: string };
type Match = "eq" | "contains";
type Param = { column: string; label: string; match: Match; required: boolean; kind?: "number" | "text" };
type Output = { column: string; label: string; unit?: string; type?: string; valueMap?: Record<string, string> };
type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "is_null" | "not_null";
type Filter = { column: string; op: FilterOp; value: string };
type Lookup = {
  id: string;
  connection_id: string;
  connection_name: string;
  connection_status: string;
  name: string;
  description: string;
  schema_name: string;
  table_name: string;
  params: Param[];
  outputs: Output[];
  filters: { column: string; op: FilterOp; value?: unknown }[];
  max_rows: number;
  enabled: boolean;
  examples?: string[];
  stats: { total: number; ok: number; tooBroad: number; failed: number };
};
type Result = { status: string; rows?: Record<string, string>[]; message?: string };

const OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "같음", needsValue: true },
  { value: "neq", label: "같지 않음", needsValue: true },
  { value: "gt", label: "보다 큼", needsValue: true },
  { value: "gte", label: "이상", needsValue: true },
  { value: "lt", label: "보다 작음", needsValue: true },
  { value: "lte", label: "이하", needsValue: true },
  { value: "not_null", label: "값이 있음", needsValue: false },
  { value: "is_null", label: "값이 비어 있음", needsValue: false },
];
const isNumberType = (t: string) => /int|numeric|decimal|double|real|float|money|serial|number/i.test(t);
const n = (v: number) => v.toLocaleString("ko-KR");
const mapText = (m?: Record<string, string>) => Object.entries(m ?? {}).map(([k, v]) => `${k}=${v}`).join(", ");
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
const tableLabel = (schema: string, table: string) => (schema === "public" ? table : `${schema}.${table}`);
const STATUS_TEXT: Record<string, string> = {
  empty: "조건에 맞는 결과가 없어요.",
  too_broad: "범위가 너무 넓어 값을 돌려주지 않았어요.",
  need_input: "조건 값이 더 필요해요.",
  timeout: "5초 안에 끝나지 않아 중단했어요.",
  error: "조회하지 못했어요.",
};

/**
 * 실시간 조회(PRD-db-live-lookup). 에이전시 문서 화면과 고객사 데스크 지식 탭이 같은 컴포넌트를 쓴다.
 * 흐름: 연결·표 → 이름·설명 → 방문자가 말할 조건 → 답에 쓸 컬럼 → 고정 조건·최대 결과 수 → 테스트 실행 → 저장.
 */
export default function LiveLookupManager({ apiBase, settingsHref }: { apiBase: string; settingsHref: string | null }) {
  const endpoint = `${apiBase}/db-lookups`;
  const [loaded, setLoaded] = useState(false),
    [assigned, setAssigned] = useState(true),
    [planAllowed, setPlanAllowed] = useState(true),
    [modelSupported, setModelSupported] = useState(true),
    [qaBot, setQaBot] = useState(false),
    [connections, setConnections] = useState<Connection[]>([]),
    [lookups, setLookups] = useState<Lookup[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [open, setOpen] = useState(false),
    [editingId, setEditingId] = useState<string | null>(null),
    [connectionId, setConnectionId] = useState(""),
    [tables, setTables] = useState<TableInfo[] | null>(null),
    [table, setTable] = useState(""),
    [columns, setColumns] = useState<Column[]>([]),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [params, setParams] = useState<Param[]>([]),
    [outputs, setOutputs] = useState<Output[]>([]),
    [mapTexts, setMapTexts] = useState<Record<string, string>>({}),
    [filters, setFilters] = useState<Filter[]>([]),
    [maxRows, setMaxRows] = useState(5),
    [testArgs, setTestArgs] = useState<string[]>([]),
    [examples, setExamples] = useState<string[]>(["", "", ""]),
    [testResult, setTestResult] = useState<Result | null>(null),
    [quickTest, setQuickTest] = useState<{ id: string; args: string[]; result: Result | null } | null>(null),
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
    if (!r.ok) throw Error(d.error || "실시간 조회를 불러오지 못했어요.");
    setAssigned(d.assigned !== false);
    setPlanAllowed(d.planAllowed !== false);
    setModelSupported(d.modelSupported !== false);
    setQaBot(d.qaBot === true);
    setConnections(d.connections ?? []);
    setLookups(d.lookups ?? []);
    setLoaded(true);
  }, [endpoint]);
  useEffect(() => {
    const t = setTimeout(() => void load().catch((e) => { setError(e.message); setLoaded(true); }), 0);
    return () => clearTimeout(t);
  }, [load]);

  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  function reset() {
    setEditingId(null);
    setConnectionId("");
    setTables(null);
    setTable("");
    setColumns([]);
    setName("");
    setDescription("");
    setParams([]);
    setOutputs([]);
    setMapTexts({});
    setFilters([]);
    setMaxRows(5);
    setTestArgs([]);
    setTestResult(null);
    setExamples(["", "", ""]);
  }
  async function loadTables(id: string) {
    setBusy("tables");
    try {
      const d = await post({ action: "tables", connectionId: id });
      setTables(d.tables);
    } finally {
      setBusy(null);
    }
  }
  async function loadColumns(id: string, tableName: string) {
    setBusy("columns");
    try {
      const d = await post({ action: "sample", connectionId: id, table: tableName });
      setColumns(d.columns);
      return d.columns as Column[];
    } finally {
      setBusy(null);
    }
  }
  async function pickConnection(id: string) {
    setConnectionId(id);
    setTables(null);
    setTable("");
    setColumns([]);
    setParams([]);
    setOutputs([]);
    setFilters([]);
    setTestResult(null);
    setError("");
    if (!id) return;
    await loadTables(id).catch((e) => fail(e, "테이블을 불러오지 못했어요."));
  }
  async function pickTable(tableName: string) {
    setTable(tableName);
    setColumns([]);
    setParams([]);
    setOutputs([]);
    setFilters([]);
    setTestResult(null);
    setError("");
    if (!tableName) return;
    try {
      const cols = await loadColumns(connectionId, tableName);
      if (!name) setName(`${tableName} 조회`);
      // 첫 텍스트 컬럼을 조건으로, 개인정보가 아닌 나머지 몇 개를 답 컬럼으로 미리 채운다. 틀리면 고친다.
      const first = cols.find((c) => !c.personal && !isNumberType(c.type) && !/^(id|.*_id)$/i.test(c.name));
      if (first) {
        setParams([{ column: first.name, label: first.label, match: "eq", required: true }]);
        setTestArgs([""]);
      }
      setOutputs(
        cols
          .filter((c) => !c.personal && !/(created_at|updated_at|deleted_at)$/i.test(c.name) && !/^id$/i.test(c.name))
          .slice(0, 5)
          .map((c) => ({ column: c.name, label: c.label, unit: c.unit, type: c.type })),
      );
    } catch (e) {
      fail(e, "테이블을 읽지 못했어요.");
    }
  }
  async function startEdit(l: Lookup) {
    reset();
    setOpen(true);
    setNotice("");
    setError("");
    setEditingId(l.id);
    setConnectionId(l.connection_id);
    setName(l.name);
    setDescription(l.description);
    setParams(l.params);
    setOutputs(l.outputs);
    setMapTexts(Object.fromEntries(l.outputs.map((o) => [o.column, mapText(o.valueMap)])));
    setFilters(l.filters.map((f) => ({ column: f.column, op: f.op, value: f.value === undefined || f.value === null ? "" : String(f.value) })));
    setMaxRows(l.max_rows);
    setTestArgs(l.params.map(() => ""));
    setExamples([0, 1, 2].map((i) => l.examples?.[i] ?? ""));
    const tableName = tableLabel(l.schema_name, l.table_name);
    setTable(tableName);
    try {
      await loadTables(l.connection_id);
      await loadColumns(l.connection_id, tableName);
    } catch (e) {
      fail(e, "표를 읽지 못했어요.");
    }
  }

  const columnOf = useCallback((c: string) => columns.find((x) => x.name === c), [columns]);
  const outputsWithMaps = useMemo(
    () =>
      outputs.map((o) => {
        const valueMap = parseMap(mapTexts[o.column] ?? "");
        return { ...o, valueMap: Object.keys(valueMap).length ? valueMap : undefined };
      }),
    [outputs, mapTexts],
  );
  const config = () => ({
    connectionId,
    name: name.trim(),
    description: description.trim(),
    table,
    params: params.map((p) => ({ ...p, type: columnOf(p.column)?.type })),
    outputs: outputsWithMaps,
    filters: filters
      .filter((f) => f.column)
      .map((f) => ({ column: f.column, op: f.op, ...(OPS.find((o) => o.value === f.op)?.needsValue ? { value: f.value } : {}), kind: isNumberType(columnOf(f.column)?.type ?? "") ? "number" : "text" })),
    maxRows,
    examples: examples.map((e) => e.trim()).filter(Boolean),
  });
  const problems = useMemo(() => {
    const list: string[] = [];
    if (!table) return list;
    if (!name.trim()) list.push("조회 이름을 입력해주세요.");
    if (!params.length) list.push("방문자가 말해야 하는 조건을 하나 이상 골라주세요. 조건 없는 전체 조회는 만들 수 없어요.");
    else if (!params.some((p) => p.required)) list.push("조건 중 하나 이상은 필수여야 해요.");
    if (params.some((p) => !p.column)) list.push("조건 컬럼을 골라주세요.");
    if (!outputs.length) list.push("답에 쓸 컬럼을 하나 이상 골라주세요.");
    if (filters.some((f) => f.column && OPS.find((o) => o.value === f.op)?.needsValue && !f.value.trim())) list.push("고정 조건 값을 입력해주세요.");
    return list;
  }, [table, name, params, outputs, filters]);

  async function runTest() {
    setBusy("test");
    setError("");
    setTestResult(null);
    try {
      const args = Object.fromEntries(testArgs.map((v, i) => [`p${i + 1}`, v]));
      const d = await post({ action: "test", config: config(), args });
      setTestResult(d.result);
      // 결과가 나온 테스트 값으로 첫 예시 질문을 채워 준다(비어 있을 때만). 예: "아메리카노 재고 알려줘"
      if (d.result?.status === "ok" && !examples.some((e) => e.trim())) {
        const subject = testArgs.map((v) => v.trim()).filter(Boolean).join(" ");
        // 이름에서 "조회"를 뺀 주제어. 한글이 없는 기본 이름(menu_stock 조회)은 주제어로 쓰지 않는다.
        const stripped = name.trim().replace(/\s*조회$/, "");
        const topic = /[가-힣]/.test(stripped) ? stripped : "";
        if (subject) setExamples([`${subject} ${topic || "알려줘"}${topic ? " 알려줘" : ""}`.trim(), "", ""]);
      }
    } catch (e) {
      fail(e, "테스트하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }
  async function save() {
    setBusy("save");
    setError("");
    try {
      await post(editingId ? { action: "update", lookupId: editingId, ...config() } : { action: "create", ...config() });
      setNotice(editingId ? "실시간 조회를 고쳤어요." : "실시간 조회를 저장했어요. 이제 챗봇이 대화 중에 이 조회를 쓸 수 있어요.");
      setOpen(false);
      reset();
      await load();
    } catch (e) {
      fail(e, "저장하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }
  async function toggle(l: Lookup) {
    setBusy("toggle:" + l.id);
    setError("");
    try {
      await post({ action: "toggle", lookupId: l.id, enabled: !l.enabled });
      await load();
    } catch (e) {
      fail(e, "바꾸지 못했어요.");
    } finally {
      setBusy(null);
    }
  }
  async function remove(id: string) {
    setBusy("delete:" + id);
    setError("");
    try {
      await post({ action: "delete", lookupId: id });
      setConfirmDelete(null);
      setNotice("실시간 조회를 삭제했어요.");
      await load();
    } catch (e) {
      fail(e, "삭제하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }
  async function runQuickTest() {
    if (!quickTest) return;
    setBusy("quick:" + quickTest.id);
    setError("");
    try {
      const args = Object.fromEntries(quickTest.args.map((v, i) => [`p${i + 1}`, v]));
      const d = await post({ action: "test", lookupId: quickTest.id, args });
      setQuickTest((q) => (q ? { ...q, result: d.result } : q));
    } catch (e) {
      fail(e, "테스트하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  const canAdd = loaded && assigned && planAllowed && connections.length > 0 && !open && lookups.length < 5;
  const usable = columns.filter((c) => !c.personal);

  return (
    <section className="cp-panel dbs lkp" aria-labelledby="lkp-title">
      <div className="dbs-head">
        <div>
          <h2 id="lkp-title">실시간 조회</h2>
          <p className="cp-note">
            재고·잔여석·영업 여부처럼 지금 값이 중요한 정보는 대화 중에 고객사 DB를 바로 확인해요. 미리 정한 조회만 실행하고, 한 번에 너무 많은 결과가 나오는 질문에는 “범위가 너무 넓어요”라고 안내해요.
          </p>
        </div>
        {canAdd && (
          <button type="button" className="cp-button" disabled={busy !== null} onClick={() => { reset(); setOpen(true); setNotice(""); setError(""); }}>
            조회 추가
          </button>
        )}
      </div>

      {!loaded && <p className="cp-note dbs-loading" role="status"><span className="cp-spinner" aria-hidden="true" /> 불러오는 중…</p>}
      {loaded && !planAllowed && <p className="cp-callout">무료 요금제에서는 실시간 조회를 쓸 수 없어요. 그로스 이상 요금제에서 쓸 수 있어요.</p>}
      {loaded && planAllowed && !assigned && <p className="cp-callout">이 챗봇이 아직 고객사에 배정되지 않았어요. 고객사에 배정한 뒤 그 고객사의 DB로 조회를 만들 수 있어요.</p>}
      {loaded && planAllowed && assigned && connections.length === 0 && (
        <div className="cp-callout dbs-empty">
          <strong>먼저 데이터 연결을 추가해주세요</strong>
          <span>고객사 설정의 “데이터 연결”에서 DB 접속 정보를 저장하면 여기서 조회를 만들 수 있어요.</span>
          {settingsHref && <Link className="cp-button cp-button-secondary" href={settingsHref}>데이터 연결 추가하기</Link>}
        </div>
      )}
      {loaded && !modelSupported && (lookups.length > 0 || canAdd) && (
        <p className="cp-callout">이 챗봇은 Gemini 모델을 써서 실시간 조회가 동작하지 않아요. 챗봇 설정에서 OpenAI 모델로 바꾸면 써요.</p>
      )}
      {loaded && modelSupported && qaBot && planAllowed && assigned && connections.length > 0 && (
        <p className="cp-note lkp-empty">Q&amp;A 챗봇은 방문자가 “AI에게 질문하기”를 고른 대화에서만 실시간 조회를 써요.</p>
      )}
      {loaded && planAllowed && assigned && connections.length > 0 && lookups.length === 0 && !open && (
        <p className="cp-note lkp-empty">아직 만든 조회가 없어요. 예: “재고 조회 — 메뉴 이름을 말하면 남은 수량을 알려줘요”.</p>
      )}

      {lookups.length > 0 && (
        <ul className="cp-list dbs-list">
          {lookups.map((l) => {
            const q = quickTest?.id === l.id ? quickTest : null;
            const connectionGone = l.connection_status === "deleted";
            return (
              <li key={l.id}>
                <div className="dbs-source-main">
                  <div className="dbs-source-title">
                    <strong>{l.name}</strong>
                    <span className="cp-chip muted">{tableLabel(l.schema_name, l.table_name)}</span>
                    {connectionGone ? <span className="cp-chip warn">연결 삭제됨</span> : l.enabled ? <span className="cp-chip ok">켜짐</span> : <span className="cp-chip muted">꺼짐</span>}
                  </div>
                  <small>
                    방문자가 말할 값: {l.params.map((p) => `${p.label}${p.required ? "" : "(선택)"}`).join(", ")} · 답: {l.outputs.map((o) => o.label).join(", ")} · 최대 {l.max_rows}건
                  </small>
                  {l.examples && l.examples.length > 0 && <small>예시 질문: {l.examples.map((e) => `“${e}”`).join(", ")}</small>}
                  <small>
                    최근 7일 실행 {n(l.stats.total)} · 범위 초과·한도 {n(l.stats.tooBroad)} · 실패 {n(l.stats.failed)}
                  </small>
                  {q && (
                    <div className="lkp-quick">
                      <div className="lkp-args">
                        {l.params.map((p, i) => (
                          <input
                            key={p.column}
                            className="cp-input"
                            aria-label={`${p.label} 테스트 값`}
                            placeholder={`${p.label}${p.required ? "" : " (선택)"}`}
                            value={q.args[i] ?? ""}
                            onChange={(e) => setQuickTest({ ...q, args: q.args.map((v, j) => (j === i ? e.target.value : v)), result: null })}
                          />
                        ))}
                        <button type="button" className="cp-button cp-button-secondary" disabled={busy !== null} onClick={() => void runQuickTest()}>
                          {busy === "quick:" + l.id ? "확인 중…" : "실행"}
                        </button>
                      </div>
                      {q.result && <TestResult result={q.result} />}
                    </div>
                  )}
                </div>
                <div className="cp-row dbs-source-actions">
                  {!connectionGone && (
                    <button type="button" className="cp-button cp-button-secondary" disabled={busy !== null} onClick={() => void toggle(l)}>
                      {busy === "toggle:" + l.id ? "바꾸는 중…" : l.enabled ? "끄기" : "켜기"}
                    </button>
                  )}
                  {!connectionGone && (
                    <button type="button" className="cp-link" disabled={busy !== null} onClick={() => setQuickTest(q ? null : { id: l.id, args: l.params.map(() => ""), result: null })}>
                      {q ? "테스트 닫기" : "테스트"}
                    </button>
                  )}
                  {!connectionGone && (
                    <button type="button" className="cp-link" disabled={busy !== null || open} onClick={() => void startEdit(l)}>수정</button>
                  )}
                  {confirmDelete === l.id ? (
                    <span className="dbs-confirm">
                      <button type="button" className="cp-link cp-conn-delete" disabled={busy !== null} onClick={() => void remove(l.id)}>삭제 확인</button>
                      <button type="button" className="cp-link" onClick={() => setConfirmDelete(null)}>취소</button>
                    </span>
                  ) : (
                    <button type="button" className="cp-link cp-conn-delete" disabled={busy !== null} onClick={() => setConfirmDelete(l.id)}>삭제</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {lookups.length >= 5 && !open && <p className="cp-note dbs-hint">실시간 조회는 챗봇당 5개까지 만들 수 있어요.</p>}
      {notice && <p className="cp-note dbs-notice" role="status">{notice}</p>}
      {error && <p className="cp-error" role="alert">{error}</p>}

      {open && (
        <div className="dbs-wizard">
          <div className="dbs-step">
            <h3><span className="dbs-step-no">1</span>연결과 표</h3>
            <div className="dbs-grid">
              <label>
                데이터 연결
                <select className="cp-input" value={connectionId} disabled={busy !== null} onChange={(e) => void pickConnection(e.target.value)}>
                  <option value="">연결 선택</option>
                  {connections.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === "error" ? " (연결 오류)" : ""}</option>)}
                </select>
              </label>
              <label>
                표
                <select className="cp-input" value={table} disabled={!tables || busy !== null} onChange={(e) => void pickTable(e.target.value)}>
                  <option value="">{busy === "tables" ? "불러오는 중…" : tables ? "표 선택" : "먼저 연결을 고르세요"}</option>
                  {tables?.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}{t.kind === "view" ? " (뷰)" : ""}{t.rowEstimate !== null ? ` · 약 ${n(t.rowEstimate)}행` : ""}</option>
                  ))}
                </select>
              </label>
            </div>
            {busy === "columns" && <p className="cp-note dbs-loading" role="status"><span className="cp-spinner" aria-hidden="true" /> 컬럼을 읽고 있어요…</p>}
          </div>

          {columns.length > 0 && (
            <>
              <div className="dbs-step">
                <h3><span className="dbs-step-no">2</span>이름과 쓰는 때</h3>
                <div className="dbs-grid">
                  <label>
                    조회 이름
                    <input className="cp-input" value={name} maxLength={40} placeholder="예: 재고 조회" onChange={(e) => { setName(e.target.value); setTestResult(null); }} />
                  </label>
                  <label>
                    언제 쓰나요
                    <input className="cp-input" value={description} maxLength={200} placeholder="예: 손님이 특정 메뉴의 남은 수량을 물을 때" onChange={(e) => setDescription(e.target.value)} />
                  </label>
                </div>
                <p className="cp-note lkp-help">챗봇이 이 설명을 보고 조회가 필요한 질문인지 판단해요.</p>
              </div>

              <div className="dbs-step">
                <h3><span className="dbs-step-no">3</span>방문자가 말해야 하는 값</h3>
                <p className="cp-note">조건 없는 전체 조회는 만들 수 없어요. 필수 조건 값을 방문자가 말하지 않으면 챗봇이 먼저 물어봐요.</p>
                <div className="dbs-filters">
                  {params.map((p, i) => (
                    <div className="dbs-filter lkp-param" key={i}>
                      <select
                        className="cp-input"
                        aria-label="조건 컬럼"
                        value={p.column}
                        onChange={(e) => {
                          const c = columnOf(e.target.value);
                          setTestResult(null);
                          setParams((list) => list.map((x, j) => (j === i ? { ...x, column: e.target.value, label: c?.label ?? e.target.value, match: c && isNumberType(c.type) ? "eq" : x.match } : x)));
                        }}
                      >
                        <option value="">컬럼</option>
                        {usable.map((c) => <option key={c.name} value={c.name} disabled={params.some((x, j) => j !== i && x.column === c.name)}>{c.name}</option>)}
                      </select>
                      <input className="cp-input" aria-label="조건 라벨" value={p.label} maxLength={30} placeholder="방문자에게 보일 이름" onChange={(e) => setParams((list) => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                      <select
                        className="cp-input"
                        aria-label="비교 방식"
                        value={p.match}
                        disabled={isNumberType(columnOf(p.column)?.type ?? "")}
                        onChange={(e) => { setTestResult(null); setParams((list) => list.map((x, j) => (j === i ? { ...x, match: e.target.value as Match } : x))); }}
                      >
                        <option value="eq">정확히 같음</option>
                        <option value="contains">일부 포함(2글자 이상)</option>
                      </select>
                      <span className="lkp-param-end">
                        <label className="lkp-check">
                          <input type="checkbox" checked={p.required} onChange={(e) => { setTestResult(null); setParams((list) => list.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x))); }} />
                          필수
                        </label>
                        <button type="button" className="cp-link" onClick={() => { setTestResult(null); setParams((list) => list.filter((_, j) => j !== i)); setTestArgs((a) => a.filter((_, j) => j !== i)); }}>빼기</button>
                      </span>
                    </div>
                  ))}
                  {params.length < 3 && (
                    <button type="button" className="cp-link" onClick={() => { setParams((list) => [...list, { column: "", label: "", match: "eq", required: params.length === 0 }]); setTestArgs((a) => [...a, ""]); }}>+ 조건 추가</button>
                  )}
                  {columns.some((c) => c.personal) && (
                    <p className="cp-note lkp-help">개인정보로 보이는 컬럼({columns.filter((c) => c.personal).map((c) => c.name).join(", ")})은 조건과 답에 쓸 수 없어요. 본인 확인이 필요한 조회는 아직 지원하지 않아요.</p>
                  )}
                </div>
              </div>

              <div className="dbs-step">
                <h3><span className="dbs-step-no">4</span>답에 쓸 컬럼</h3>
                <div className="dbs-table-wrap">
                  <table className="cp-table dbs-columns lkp-outputs">
                    <thead><tr><th>컬럼</th><th>답에 쓰기</th><th>라벨</th><th>단위</th><th>값 바꾸기</th></tr></thead>
                    <tbody>
                      {columns.map((c) => {
                        const o = outputs.find((x) => x.column === c.name);
                        return (
                          <tr key={c.name} className={!o ? "is-excluded" : undefined}>
                            <td>
                              <strong>{c.name}</strong>
                              <small>{c.type}{c.personal && <span className="cp-chip warn dbs-pii">개인정보 추정</span>}</small>
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`${c.name} 답에 쓰기`}
                                checked={Boolean(o)}
                                disabled={c.personal || (!o && outputs.length >= 12)}
                                onChange={(e) => {
                                  setTestResult(null);
                                  setOutputs((list) => (e.target.checked ? [...list, { column: c.name, label: c.label, unit: c.unit, type: c.type }] : list.filter((x) => x.column !== c.name)));
                                }}
                              />
                            </td>
                            {o ? (
                              <>
                                <td><input className="cp-input" aria-label={`${c.name} 라벨`} value={o.label} maxLength={40} onChange={(e) => setOutputs((list) => list.map((x) => (x.column === c.name ? { ...x, label: e.target.value } : x)))} /></td>
                                <td><input className="cp-input dbs-unit" aria-label={`${c.name} 단위`} value={o.unit ?? ""} maxLength={10} placeholder="없음" onChange={(e) => setOutputs((list) => list.map((x) => (x.column === c.name ? { ...x, unit: e.target.value } : x)))} /></td>
                                <td><input className="cp-input" aria-label={`${c.name} 값 바꾸기`} value={mapTexts[c.name] ?? ""} placeholder="예: 1=영업중, 0=휴무" onChange={(e) => setMapTexts((m) => ({ ...m, [c.name]: e.target.value }))} /></td>
                              </>
                            ) : (
                              <td colSpan={3} className="dbs-role-note">{c.personal ? "개인정보로 보여 쓸 수 없어요." : "답에 쓰지 않아요."}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="dbs-step">
                <h3><span className="dbs-step-no">5</span>항상 적용할 조건과 결과 수</h3>
                <div className="dbs-filters">
                  {filters.length === 0 && <p className="cp-note">예: 판매 중인 것만 → is_active 같음 1</p>}
                  {filters.map((f, i) => {
                    const op = OPS.find((x) => x.value === f.op)!;
                    return (
                      <div className="dbs-filter" key={i}>
                        <select className="cp-input" aria-label="고정 조건 컬럼" value={f.column} onChange={(e) => setFilters((list) => list.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}>
                          <option value="">컬럼</option>
                          {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                        <select className="cp-input" aria-label="고정 조건" value={f.op} onChange={(e) => setFilters((list) => list.map((x, j) => (j === i ? { ...x, op: e.target.value as FilterOp } : x)))}>
                          {OPS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                        </select>
                        <input className="cp-input" aria-label="고정 조건 값" value={f.value} disabled={!op.needsValue} placeholder={op.needsValue ? "값" : ""} onChange={(e) => setFilters((list) => list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                        <button type="button" className="cp-link" onClick={() => setFilters((list) => list.filter((_, j) => j !== i))}>빼기</button>
                      </div>
                    );
                  })}
                  {filters.length < 10 && <button type="button" className="cp-link" onClick={() => setFilters((list) => [...list, { column: "", op: "eq", value: "" }])}>+ 조건 추가</button>}
                </div>
                <div className="dbs-grid">
                  <label>
                    최대 결과 수
                    <select className="cp-input" value={maxRows} onChange={(e) => { setMaxRows(Number(e.target.value)); setTestResult(null); }}>
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{v}건</option>)}
                    </select>
                  </label>
                </div>
                <p className="cp-note lkp-help">결과가 이 수를 넘으면 값을 보여주지 않고 “범위가 너무 넓어요”라고 안내해요.</p>
              </div>

              <div className="dbs-step">
                <h3><span className="dbs-step-no">6</span>테스트</h3>
                <p className="cp-note">방문자가 말할 값을 넣고 실제로 조회해 봐요. 실행은 읽기 전용이고 5초 안에 끝나야 해요.</p>
                <div className="lkp-args">
                  {params.map((p, i) => (
                    <input
                      key={i}
                      className="cp-input"
                      aria-label={`${p.label || "조건"} 테스트 값`}
                      placeholder={`${p.label || "조건"}${p.required ? "" : " (선택)"}`}
                      value={testArgs[i] ?? ""}
                      onChange={(e) => { setTestResult(null); setTestArgs((a) => { const next = [...a]; next[i] = e.target.value; return next; }); }}
                    />
                  ))}
                  <button type="button" className="cp-button cp-button-secondary" disabled={busy !== null || problems.length > 0} onClick={() => void runTest()}>
                    {busy === "test" ? "확인 중…" : "테스트 실행"}
                  </button>
                </div>
                {testResult && <TestResult result={testResult} />}
              </div>

              <div className="dbs-step">
                <h3><span className="dbs-step-no">7</span>예시 질문</h3>
                <p className="cp-note">방문자가 범위가 너무 넓은 질문을 하면 “범위가 너무 넓어요” 안내와 함께 이 질문들을 버튼으로 보여줘요. 누르면 그 질문이 바로 전송돼요.</p>
                <div className="dbs-questions">
                  {examples.map((q, i) => (
                    <input
                      key={i}
                      className="cp-input"
                      aria-label={`예시 질문 ${i + 1}`}
                      value={q}
                      maxLength={60}
                      placeholder={i === 0 ? "예: 아메리카노 재고 알려줘" : `예시 질문 ${i + 1} (선택)`}
                      onChange={(e) => setExamples((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                  ))}
                </div>
              </div>

              {problems.length > 0 && (
                <ul className="dbs-problems" role="alert">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
            </>
          )}

          <div className="cp-row dbs-wizard-actions">
            <button type="button" className="cp-button" disabled={busy !== null || !columns.length || problems.length > 0} onClick={() => void save()}>
              {busy === "save" ? "저장 중…" : editingId ? "고친 내용 저장" : "저장"}
            </button>
            <button type="button" className="cp-button cp-button-secondary" disabled={busy === "save"} onClick={() => { setOpen(false); reset(); setError(""); }}>
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function TestResult({ result }: { result: Result }) {
  if (result.status === "ok" && result.rows?.length) {
    const headers = Object.keys(result.rows[0]);
    return (
      <div className="lkp-result" role="status">
        <p className="lkp-result-head ok">결과 {result.rows.length}건 · 챗봇은 이 값으로 답해요</p>
        <div className="dbs-table-wrap">
          <table className="cp-table">
            <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{result.rows.map((r, i) => <tr key={i}>{headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    );
  }
  const warn = result.status === "too_broad" || result.status === "timeout" || result.status === "error";
  return (
    <div className="lkp-result" role="status">
      <p className={`lkp-result-head ${warn ? "warn" : ""}`}>{STATUS_TEXT[result.status] ?? "결과를 확인해주세요."}</p>
      {result.message && result.status !== "empty" && <p className="cp-note">챗봇 안내: {result.message}</p>}
    </div>
  );
}
