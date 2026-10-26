"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Connection = {
  id: string;
  name: string;
  kind: "postgres" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  has_secret: boolean;
  status: "untested" | "ok" | "error";
  last_tested_at: number | null;
  last_error: string | null;
  table_count: number | null;
};
type TableInfo = { name: string; kind: "table" | "view"; rowEstimate: number | null };
type TestResult = { ok: true; tableCount: number; tables: TableInfo[] } | { ok: false; error: string };
type Form = {
  id: string | null;
  name: string;
  kind: "postgres" | "mysql";
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
};
const EMPTY: Form = {
  id: null,
  name: "",
  kind: "postgres",
  host: "",
  port: "5432",
  database: "",
  username: "",
  password: "",
  ssl: true,
};
const KIND_LABEL = { postgres: "PostgreSQL", mysql: "MySQL" } as const;
const STATUS = {
  untested: { label: "테스트 전", className: "cp-chip muted" },
  ok: { label: "정상", className: "cp-chip ok" },
  error: { label: "연결 오류", className: "cp-chip warn" },
} as const;
const when = (t: number | null) =>
  t ? new Date(t * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }) : null;
const rows = (n: number | null) => (n === null ? "행 수 미상" : `약 ${n.toLocaleString("ko-KR")}행`);

/**
 * 고객사 설정의 "데이터 연결" 섹션. 에이전시(/api/customers)와 데스크(/api/customer)가 같은 컴포넌트를 쓴다.
 * 비밀번호는 저장 후 다시 보여주지 않고, 수정 시 비워두면 저장된 값을 유지한다.
 */
export default function DataConnectionManager({
  customerId,
  portal = false,
  canManage,
  requestSheetHref = "/db-connection-request",
}: {
  customerId: string;
  portal?: boolean;
  canManage: boolean;
  requestSheetHref?: string;
}) {
  const base = `/api/${portal ? "customer" : "customers"}/${customerId}/data-connections`;
  const [items, setItems] = useState<Connection[] | null>(null),
    [form, setForm] = useState<Form | null>(null),
    [busy, setBusy] = useState<"test" | "save" | "list-test" | "delete" | null>(null),
    [testing, setTesting] = useState<string | null>(null),
    [result, setResult] = useState<TestResult | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tables, setTables] = useState<{ id: string; tables: TableInfo[] } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(base, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setItems(d);
  }, [base]);
  useEffect(() => {
    const timer = setTimeout(
      () => void load().catch((e) => setError(e instanceof Error ? e.message : "불러오지 못했습니다.")),
      0,
    );
    return () => clearTimeout(timer);
  }, [load]);
  async function send(path: string, method: string, payload?: unknown) {
    const r = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "처리하지 못했습니다.");
    return d;
  }
  function open(c?: Connection) {
    setError("");
    setNotice("");
    setResult(null);
    setTables(null);
    setForm(
      c
        ? {
            id: c.id,
            name: c.name,
            kind: c.kind,
            host: c.host,
            port: String(c.port),
            database: c.database,
            username: c.username,
            password: "",
            ssl: c.ssl,
          }
        : { ...EMPTY },
    );
  }
  const payload = (f: Form) => ({
    name: f.name,
    kind: f.kind,
    host: f.host,
    port: Number(f.port),
    database: f.database,
    username: f.username,
    ssl: f.ssl,
    ...(f.password ? { password: f.password } : {}),
  });
  async function testForm() {
    if (!form) return;
    setBusy("test");
    setError("");
    setResult(null);
    try {
      const d = (await send(base, "POST", { action: "test", ...payload(form), ...(form.id ? { id: form.id } : {}) })) as TestResult;
      setResult(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "테스트하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy("save");
    setError("");
    try {
      const saved = form.id
        ? await send(`${base}/${form.id}`, "PATCH", payload(form))
        : await send(base, "POST", { action: "create", ...payload(form) });
      // 저장 직후 저장된 접속 정보로 한 번 더 테스트해 목록 상태를 기록한다.
      await send(`${base}/${saved.id}`, "POST", { action: "test" }).catch(() => null);
      setForm(null);
      setResult(null);
      setNotice(form.id ? "연결 정보를 저장했습니다." : "데이터 연결을 추가했습니다.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }
  async function testSaved(c: Connection) {
    setTesting(c.id);
    setError("");
    setNotice("");
    setTables(null);
    try {
      const d = (await send(`${base}/${c.id}`, "POST", { action: "test" })) as { result: TestResult };
      if (d.result.ok) setTables({ id: c.id, tables: d.result.tables });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "테스트하지 못했습니다.");
    } finally {
      setTesting(null);
    }
  }
  async function remove(c: Connection) {
    if (!confirm(`"${c.name}" 연결을 삭제할까요? 저장된 접속 정보는 즉시 파기되고, 이 연결로 만든 지식 소스는 멈춥니다.`)) return;
    setBusy("delete");
    setError("");
    try {
      await send(`${base}/${c.id}`, "DELETE");
      setNotice("연결을 삭제하고 접속 정보를 파기했습니다.");
      setTables(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }
  const field = (key: keyof Form, value: string | boolean) => setForm((f) => (f ? { ...f, [key]: value } : f));
  return (
    <section className="cp-panel" aria-labelledby="data-connections-heading">
      <h2 id="data-connections-heading">데이터 연결</h2>
      <p className="cp-note">
        고객사 데이터베이스를 읽기 전용으로 연결하면 챗봇 지식 탭에서 테이블을 골라 문서로 가져올 수 있어요. 접속
        정보는 암호화해 저장하고 비밀번호는 다시 보여주지 않습니다.{" "}
        <Link href={requestSheetHref} className="cp-link" target="_blank" rel="noopener">
          연결 요청서 보기
        </Link>
      </p>
      {items === null && !error && (
        <p role="status" className="cp-note">
          불러오는 중입니다.
        </p>
      )}
      {items && items.length === 0 && !form && (
        <div className="cp-callout">
          <strong>아직 데이터 연결이 없어요.</strong>
          <span className="cp-note">
            접속 정보가 없다면 연결 요청서를 호스팅 업체나 개발사에 보내 읽기 전용 계정을 받아주세요. 받은 값을 아래
            폼에 입력하고 테스트하면 됩니다.
          </span>
          {canManage && (
            <div className="cp-row">
              <button type="button" className="cp-button" onClick={() => open()}>
                연결 추가
              </button>
              <Link href={requestSheetHref} className="cp-button cp-button-secondary" target="_blank" rel="noopener">
                연결 요청서
              </Link>
            </div>
          )}
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="cp-list cp-conn-list">
          {items.map((c) => (
            <li key={c.id}>
              <div className="cp-conn-main">
                <div className="cp-row">
                  <strong>{c.name}</strong>
                  <span className={STATUS[c.status].className}>{STATUS[c.status].label}</span>
                  {c.status === "ok" && c.table_count !== null && <small>테이블 {c.table_count}개</small>}
                </div>
                <small>
                  {KIND_LABEL[c.kind]} · {c.host}:{c.port}/{c.database} · 사용자 {c.username} · SSL {c.ssl ? "사용" : "끔"}
                </small>
                {when(c.last_tested_at) && <small>마지막 테스트 {when(c.last_tested_at)}</small>}
                {c.last_error && (
                  <small className="cp-conn-error" role="alert">
                    {c.last_error}
                  </small>
                )}
                {tables?.id === c.id && (
                  <details className="cp-conn-tables" open>
                    <summary>읽을 수 있는 테이블 {tables.tables.length}개</summary>
                    <ul>
                      {tables.tables.slice(0, 30).map((t) => (
                        <li key={t.name}>
                          <span>{t.name}</span>
                          <small>
                            {t.kind === "view" ? "뷰 · " : ""}
                            {rows(t.rowEstimate)}
                          </small>
                        </li>
                      ))}
                      {tables.tables.length > 30 && <li><small>외 {tables.tables.length - 30}개</small></li>}
                    </ul>
                  </details>
                )}
              </div>
              <div className="cp-row cp-conn-actions">
                <button
                  type="button"
                  className="cp-button cp-button-secondary"
                  disabled={testing !== null || busy !== null}
                  onClick={() => testSaved(c)}
                >
                  {testing === c.id ? "테스트 중…" : "테스트"}
                </button>
                {canManage && (
                  <>
                    <button
                      type="button"
                      className="cp-button cp-button-secondary"
                      disabled={busy !== null}
                      onClick={() => open(c)}
                    >
                      수정
                    </button>
                    <button type="button" className="cp-link cp-conn-delete" disabled={busy !== null} onClick={() => remove(c)}>
                      삭제
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {items && items.length > 0 && !form && canManage && (
        <div className="cp-row" style={{ marginTop: 12 }}>
          <button type="button" className="cp-button" onClick={() => open()} disabled={busy !== null}>
            연결 추가
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="cp-note cp-conn-notice">
          {notice}
        </p>
      )}
      {error && !form && (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form className="cp-details cp-conn-form" onSubmit={save}>
          <h3>{form.id ? "연결 정보 수정" : "새 데이터 연결"}</h3>
          <div className="cp-conn-grid">
            <label>
              연결 이름
              <input
                className="cp-input"
                value={form.name}
                onChange={(e) => field("name", e.target.value)}
                maxLength={80}
                required
                placeholder="예: 달빛 카페 주문 DB"
              />
            </label>
            <label>
              DB 종류
              <select className="cp-input" value={form.kind} onChange={(e) => field("kind", e.target.value)}>
                <option value="postgres">PostgreSQL</option>
                <option value="mysql" disabled>
                  MySQL · MariaDB (준비 중)
                </option>
              </select>
            </label>
            <label className="cp-conn-host">
              호스트
              <input
                className="cp-input"
                value={form.host}
                onChange={(e) => field("host", e.target.value)}
                maxLength={253}
                required
                placeholder="db.example.com 또는 공인 IP"
                autoComplete="off"
              />
            </label>
            <label>
              포트
              <input
                className="cp-input"
                inputMode="numeric"
                value={form.port}
                onChange={(e) => field("port", e.target.value)}
                required
                placeholder="5432"
              />
            </label>
            <label>
              데이터베이스 이름
              <input
                className="cp-input"
                value={form.database}
                onChange={(e) => field("database", e.target.value)}
                maxLength={120}
                required
                autoComplete="off"
              />
            </label>
            <label>
              사용자 이름
              <input
                className="cp-input"
                value={form.username}
                onChange={(e) => field("username", e.target.value)}
                maxLength={120}
                required
                autoComplete="off"
              />
            </label>
            <label>
              비밀번호
              <input
                className="cp-input"
                type="password"
                value={form.password}
                onChange={(e) => field("password", e.target.value)}
                maxLength={200}
                required={!form.id}
                autoComplete="new-password"
                placeholder={form.id ? "저장된 비밀번호 유지 (바꾸려면 입력)" : ""}
              />
            </label>
            <label className="cp-check cp-conn-ssl">
              <input type="checkbox" checked={form.ssl} onChange={(e) => field("ssl", e.target.checked)} /> SSL로 연결
              <small className="cp-note">호스팅 DB는 대부분 SSL이 필요해요. 연결이 끊기면 꺼보세요.</small>
            </label>
          </div>
          <p className="cp-note">
            읽기 전용 계정을 권장해요. 우리 서버는 조회만 하고, 사설 IP·내부 주소로는 연결하지 않습니다.
          </p>
          {busy === "test" && (
            <p role="status" aria-live="polite" className="cp-note cp-conn-testing">
              <span className="cp-spinner" aria-hidden="true" />
              서버에 연결하고 있어요. 방화벽에 막혀 있으면 10초 정도 걸릴 수 있어요.
            </p>
          )}
          {result && result.ok && (
            <div className="cp-callout" role="status">
              <strong>연결됐어요 · 테이블 {result.tableCount}개</strong>
              {result.tables.length > 0 ? (
                <ul className="cp-conn-table-chips">
                  {result.tables.slice(0, 12).map((t) => (
                    <li key={t.name} className="cp-chip muted">
                      {t.name} <small>{rows(t.rowEstimate)}</small>
                    </li>
                  ))}
                  {result.tables.length > 12 && <li className="cp-chip muted">외 {result.tables.length - 12}개</li>}
                </ul>
              ) : (
                <span className="cp-note">이 사용자가 읽을 수 있는 테이블이 없어요. SELECT 권한을 요청서대로 부여해주세요.</span>
              )}
            </div>
          )}
          {result && !result.ok && (
            <p className="cp-error" role="alert">
              {result.error}
            </p>
          )}
          {error && (
            <p className="cp-error" role="alert">
              {error}
            </p>
          )}
          <div className="cp-row">
            <button type="button" className="cp-button cp-button-secondary" disabled={busy !== null} onClick={testForm}>
              {busy === "test" ? "테스트 중…" : "연결 테스트"}
            </button>
            <button className="cp-button" disabled={busy !== null}>
              {busy === "save" ? "저장 중…" : form.id ? "변경 저장" : "연결 저장"}
            </button>
            <button type="button" className="cp-link" disabled={busy !== null} onClick={() => setForm(null)}>
              취소
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
