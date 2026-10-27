/**
 * DB 지식 연동 HTTP 검사. 실행 중인 QA 서버(PORTAL_HTTP_BASE, 기본 3012)와 seed 두 개(포털·샘플 DB)가 필요하다.
 * 만든 연결은 검사 끝에 삭제(접속 정보 파기)한다. 비밀값은 출력하지 않는다.
 */
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import sql from "../lib/neon";
import { api, login, desk, agency } from "./helpers/portal-http";
const results: { name: string; status: string; error?: string }[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, status: "pass" });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, status: "fail", error: e instanceof Error ? e.message : String(e) });
    console.log("FAIL", name, e instanceof Error ? e.message : e);
  }
}
async function main() {
  const u = new URL(process.env.POSTGRES_URL || "");
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || u.pathname != "/chatbot_qa") throw Error("전용 로컬 QA DB만 허용");
  const f = JSON.parse(await readFile("/tmp/chatbot-qa-runtime/portal-fixture.json", "utf8"));
  const db = JSON.parse(await readFile("/tmp/chatbot-qa-runtime/db-fixture.json", "utf8"));
  const PREFIX = "QA-HTTP ";
  const conn = { name: PREFIX + "달빛 카페 샘플 DB", kind: db.kind, host: db.host, port: db.port, database: db.database, username: db.username, password: db.password, ssl: db.ssl };
  const admin = await login(f.admin, desk),
    agent = await login(f.agent, desk),
    other = await login(f.other, desk),
    owner = await login(f.owner, agency, "credentials");
  const deskBase = "/api/customer/qa-cafe/data-connections",
    agencyBase = "/api/customers/qa-cafe/data-connections";
  // 이 스위트가 만든 연결만 정리한다(이름 접두사). 다른 세션이 만든 QA 연결은 건드리지 않는다.
  await sql`UPDATE data_connections SET secret_enc=NULL,status='deleted',deleted_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE customer_id IN ('qa-cafe','qa-shop') AND status<>'deleted' AND name LIKE ${PREFIX + "%"}`.catch(() => null);
  let id = "";
  await check("A-01 데스크 관리자: 저장 전 연결 테스트 성공·테이블 목록", async () => {
    const r = await api(deskBase, desk, admin, "POST", { action: "test", ...conn });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ok, true);
    assert.ok(r.data.tables.some((t: { name: string }) => t.name === "menu"));
    assert.ok(!JSON.stringify(r.data).includes(db.password));
  });
  await check("A-02 저장 → 목록에 상태·감사 기록, 저장된 연결 테스트로 상태 정상", async () => {
    const r = await api(deskBase, desk, admin, "POST", { action: "create", ...conn });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    id = r.data.id;
    assert.equal(r.data.has_secret, true);
    assert.equal(r.data.status, "untested");
    const t = await api(`${deskBase}/${id}`, desk, admin, "POST", { action: "test" });
    assert.equal(t.status, 200);
    assert.equal(t.data.result.ok, true);
    assert.equal(t.data.connection.status, "ok");
    const list = await api(deskBase, desk, admin);
    assert.equal(list.status, 200);
    const mine = list.data.filter((c: { name: string }) => c.name.startsWith(PREFIX));
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, "ok");
    const [audit] = await sql`SELECT 1 FROM access_audit_logs WHERE action='data_connection.create' AND target_id=${id} AND customer_id='qa-cafe'`;
    assert.ok(audit);
  });
  await check("A-03 에이전시 소유자도 같은 연결을 /api/customers 경로로 조회·테스트", async () => {
    const list = await api(agencyBase, agency, owner);
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.ok(list.data.some((c: { id: string }) => c.id === id));
    const tables = await api(`${agencyBase}/${id}`, agency, owner, "POST", { action: "tables" });
    assert.equal(tables.status, 200);
    assert.ok(tables.data.tables.some((t: { name: string }) => t.name === "menu_big"));
  });
  await check("A-04 포트 80·0·70000 거부", async () => {
    for (const port of [80, 0, 70000]) {
      const r = await api(deskBase, desk, admin, "POST", { action: "test", ...conn, port });
      assert.equal(r.status, 400, String(port));
      assert.match(r.data.error, /1024~65535/);
    }
  });
  await check("A-05 사설 IP·localhost 호스트 거부 (허용 목록 밖)", async () => {
    for (const host of ["10.0.0.1", "192.168.1.1", "169.254.169.254", "127.0.0.2"]) {
      const r = await api(deskBase, desk, admin, "POST", { action: "test", ...conn, host });
      assert.equal(r.status, 200, host);
      assert.equal(r.data.ok, false);
      assert.match(r.data.error, /내부 또는 제한된 주소/);
    }
    const bad = await api(deskBase, desk, admin, "POST", { action: "test", ...conn, host: "postgres://10.0.0.1:5432" });
    assert.equal(bad.status, 400);
  });
  await check("A-06 틀린 비밀번호는 사람 말 사유·응답에 비밀번호 미포함", async () => {
    const r = await api(deskBase, desk, admin, "POST", { action: "test", ...conn, password: "wrong-" + Date.now() });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, false);
    assert.match(r.data.error, /비밀번호가 틀렸어요/);
    assert.ok(!JSON.stringify(r.data).includes("wrong-") && !JSON.stringify(r.data).includes(db.username));
  });
  await check("A-07 없는 DB·닫힌 포트·없는 호스트는 각각 다른 안내", async () => {
    const noDb = await api(deskBase, desk, admin, "POST", { action: "test", ...conn, database: "no_such_db_" + Date.now() });
    assert.match(noDb.data.error, /데이터베이스 이름을 찾지 못했어요/);
    const closed = await api(deskBase, desk, admin, "POST", { action: "test", ...conn, port: 65000 });
    assert.match(closed.data.error, /연결을 거부했어요/);
    const noHost = await api(deskBase, desk, admin, "POST", { action: "test", ...conn, host: "no-such-host.invalid" });
    assert.match(noHost.data.error, /호스트 주소를 찾지 못했어요/);
  });
  await check("A-08 목록·상세 응답에 secret 필드 없음(has_secret만)", async () => {
    const r = await api(`${deskBase}/${id}`, desk, admin);
    assert.equal(r.status, 200);
    assert.equal(r.data.has_secret, true);
    assert.equal(r.data.host, db.host);
    assert.equal(r.data.username, db.username);
    for (const key of Object.keys(r.data)) assert.ok(!/password|secret_enc/.test(key), key);
    assert.ok(!JSON.stringify(r.data).includes(db.password));
  });
  await check("A-09 다른 고객사·담당자·비로그인·다른 경로 접근 차단", async () => {
    assert.equal((await api(`${deskBase}/${id}`, desk, other)).status, 404);
    assert.equal((await api(`/api/customer/qa-shop/data-connections/${id}`, desk, other)).status, 404);
    assert.equal((await api(`${deskBase}/${id}`, desk, other, "PATCH", { name: "x" })).status, 404);
    assert.equal((await api(`${deskBase}/${id}`, desk, other, "DELETE")).status, 404);
    assert.equal((await api(`${deskBase}/${id}`, desk, agent)).status, 404);
    assert.equal((await api(deskBase, desk, agent)).status, 404);
    assert.equal((await api(deskBase, desk, agent, "POST", { action: "create", ...conn })).status, 404);
    assert.equal((await api(deskBase, desk)).status, 401);
    assert.equal((await api(agencyBase, agency)).status, 401);
    // 데스크 관리자는 에이전시 전용 경로(/api/customers)를 쓸 수 없다
    assert.equal((await api(agencyBase, desk, admin)).status, 403);
  });
  await check("A-11 비밀번호 없이 수정하면 유지, 상태는 재테스트 전까지 미확인", async () => {
    const r = await api(`${deskBase}/${id}`, desk, admin, "PATCH", { name: PREFIX + "달빛 카페 DB", host: conn.host, port: conn.port, database: conn.database, username: conn.username, ssl: conn.ssl, password: "" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.name, PREFIX + "달빛 카페 DB");
    assert.equal(r.data.has_secret, true);
    const t = await api(`${deskBase}/${id}`, desk, admin, "POST", { action: "test" });
    assert.equal(t.data.result.ok, true, "저장된 비밀번호로 여전히 연결");
    // 수정 폼에서 비밀번호를 비운 채 테스트하면 저장된 비밀번호로 테스트한다
    const formTest = await api(deskBase, desk, admin, "POST", { action: "test", id, ...conn, password: "" });
    assert.equal(formTest.data.ok, true);
  });
  await check("A-12 연결 4개째는 거부", async () => {
    const extra: string[] = [];
    // 화면 점검용으로 만든 다른 연결이 있을 수 있으니 한도(3)까지 남은 만큼만 채운다.
    const existing = (await api(deskBase, desk, admin)).data.length;
    for (const name of [PREFIX + "둘", PREFIX + "셋"].slice(0, Math.max(0, 3 - existing))) {
      const r = await api(deskBase, desk, admin, "POST", { action: "create", ...conn, name });
      assert.equal(r.status, 201);
      extra.push(r.data.id);
    }
    const r = await api(deskBase, desk, admin, "POST", { action: "create", ...conn, name: PREFIX + "넷" });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /3개까지/);
    for (const x of extra) assert.equal((await api(`${deskBase}/${x}`, desk, admin, "DELETE")).status, 200);
  });
  await check("A-13 연결 요청서 공유 페이지는 로그인 없이 양쪽 호스트에서 열림", async () => {
    for (const host of [agency, desk]) {
      const r = await api("/db-connection-request?kind=postgres&for=달빛%20카페", host);
      assert.equal(r.status, 200, host);
      assert.match(String(r.data), /읽기 전용/);
      assert.match(String(r.data), /CREATE ROLE chatbot_reader/);
      assert.match(String(r.data), /203\.0\.113\.10|배포 후 안내/);
      assert.ok(!String(r.data).includes(db.password));
    }
  });
  // ---------- 단계 B: DB 소스 ----------
  const deskSrc = "/api/customer/qa-cafe/bots/portal-cafe-bot/db-sources",
    agencySrc = "/api/bots/portal-cafe-bot/db-sources",
    shopSrc = "/api/customer/qa-shop/bots/portal-shop-bot/db-sources";
  // 이전 실행이 남긴 이 스위트의 소스·문서 정리(연결 이름 접두사로 한정)
  const stale = await sql`SELECT s.id FROM db_sources s JOIN data_connections c ON c.id=s.connection_id WHERE c.name LIKE ${PREFIX + "%"}`.catch(() => []);
  for (const s of stale) {
    await sql`DELETE FROM documents WHERE id IN (SELECT document_id FROM db_source_rows WHERE source_id=${s.id})`;
    await sql`DELETE FROM db_sources WHERE id=${s.id}`;
  }
  const menuConfig = {
    connectionId: "",
    table: "menu",
    titleColumn: "name",
    keyColumn: "id",
    bodyColumns: [
      { column: "category", label: "분류" },
      { column: "price", label: "가격", unit: "원" },
      { column: "is_active", label: "판매 상태", valueMap: { "1": "판매중", "0": "품절" } },
      { column: "description", label: "설명" },
    ],
    excludedColumns: ["updated_at"],
    filters: [{ column: "is_active", op: "eq", value: "1", kind: "number" }],
    schedule: "daily",
  };
  let menuSourceId = "";
  const importAll = async (path: string, host: string, cookie: string, sourceId: string) => {
    let state: Record<string, unknown> | null = null;
    for (let i = 0; i < 80; i++) {
      // 진행 상태는 서버가 들고 있다. 클라이언트가 보낸 state는 무시된다.
      const r = await api(path, host, cookie, "POST", { action: "import", sourceId, ...(state ? { state: { processed: -100000 } } : { begin: true }) });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      state = r.data.state;
      if (state!.done) return state!;
    }
    throw Error("가져오기가 끝나지 않음");
  };
  await check("B-01 소스 화면: 관리자는 연결 목록·소스, 담당자·다른 고객사는 404", async () => {
    menuConfig.connectionId = id;
    const r = await api(deskSrc, desk, admin);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.assigned, true);
    assert.ok(r.data.connections.some((c: { id: string }) => c.id === id));
    assert.ok(!JSON.stringify(r.data).includes(db.password));
    assert.equal((await api(deskSrc, desk, agent)).status, 404);
    assert.equal((await api(deskSrc, desk, other)).status, 404);
    const shop = await api(shopSrc, desk, other, "POST", { action: "tables", connectionId: id });
    assert.equal(shop.status, 404, "다른 고객사 봇에서 이 연결로 테이블 조회 불가");
  });
  await check("B-02 테이블 목록·미리보기 행과 컬럼 타입", async () => {
    const t = await api(deskSrc, desk, admin, "POST", { action: "tables", connectionId: id });
    assert.equal(t.status, 200);
    assert.ok(t.data.tables.some((x: { name: string }) => x.name === "menu"));
    const s = await api(deskSrc, desk, admin, "POST", { action: "sample", connectionId: id, table: "menu" });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    assert.equal(s.data.rows.length, 10);
    assert.ok(s.data.columns.some((c: { name: string; type: string }) => c.name === "price" && /int/.test(c.type)));
  });
  await check("B-03 초안: 제목 name·고유키 id·본문 4개·제외 updated_at, 키 없으면 규칙 초안", async () => {
    const r = await api(deskSrc, desk, admin, "POST", { action: "draft", connectionId: id, table: "menu" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const role = Object.fromEntries(r.data.draft.columns.map((c: { column: string; role: string }) => [c.column, c.role]));
    assert.equal(role.id, "key");
    assert.equal(role.name, "title");
    assert.equal(role.updated_at, "excluded");
    for (const c of ["category", "price", "description", "is_active"]) assert.equal(role[c], "body", c);
    assert.equal(r.data.draft.draftedBy, "rules");
    assert.equal(r.data.draft.questions.length, 3);
  });
  await check("B-04 개인정보 추정 컬럼(이름·전화·이메일·주소)은 기본 제외", async () => {
    const r = await api(deskSrc, desk, admin, "POST", { action: "draft", connectionId: id, table: "members" });
    assert.equal(r.status, 200);
    for (const c of ["phone", "email", "address"]) {
      const col = r.data.draft.columns.find((x: { column: string }) => x.column === c);
      assert.equal(col.personal, true, c);
      assert.equal(col.role, "excluded", c);
    }
  });
  await check("B-05 답변 미리보기: 3문서 '라벨: 값'·값 매핑·필터, 질문마다 근거 문서", async () => {
    const r = await api(deskSrc, desk, admin, "POST", { action: "preview", ...menuConfig, questions: ["아메리카노 가격이 얼마예요?", "카페라떼 있어요?"] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.documents.length, 3);
    assert.equal(r.data.documents[0].title, "아메리카노");
    assert.match(r.data.documents[0].content, /가격: 4,500원/);
    assert.match(r.data.documents[0].content, /판매 상태: 판매중/);
    assert.equal(r.data.answers.length, 2);
    assert.equal(r.data.answers[0].title, "아메리카노");
    assert.ok(r.data.answers.every((a: { note: string | null }) => a.note), "키가 없으면 근거 문서만 표시한다는 안내");
  });
  await check("B-06 저장하고 가져오기: 15행 → 문서(source_kind db)·감사 create/sync", async () => {
    const c = await api(deskSrc, desk, admin, "POST", { action: "create", ...menuConfig });
    assert.equal(c.status, 201, JSON.stringify(c.data));
    menuSourceId = c.data.id;
    const state = await importAll(deskSrc, desk, admin, menuSourceId);
    assert.equal(state.created, 15);
    assert.equal(state.total, 15);
    const docs = await sql`SELECT d.title,d.source_kind FROM documents d JOIN db_source_rows r ON r.document_id=d.id WHERE r.source_id=${menuSourceId}`;
    assert.equal(docs.length, 15);
    assert.ok(docs.every((d) => d.source_kind === "db"));
    const list = await api(deskSrc, desk, admin);
    const mine = list.data.sources.find((x: { id: string }) => x.id === menuSourceId);
    assert.equal(mine.lastResult.created, 15);
    assert.equal(mine.syncing, false);
    for (const action of ["db_source.create", "db_source.sync"]) {
      const [a] = await sql`SELECT 1 FROM access_audit_logs WHERE action=${action} AND target_id=${menuSourceId}`;
      assert.ok(a, action);
    }
  });
  await check("B-13 시작 없이 단계만 호출하면 409, 클라이언트 state로 상한을 넘길 수 없음", async () => {
    const r = await api(deskSrc, desk, admin, "POST", { action: "import", sourceId: menuSourceId, state: { processed: -100000, cursor: null, done: false } });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.match(r.data.error, /처음부터 다시 시작/);
  });
  await check("B-07 같은 테이블 소스 중복은 409", async () => {
    const r = await api(deskSrc, desk, admin, "POST", { action: "create", ...menuConfig });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /이미 등록된 테이블/);
  });
  await check("B-08 행 상한 50으로 menu_big(5,200행) → 50행 반영·5,150행 초과 안내", async () => {
    const c = await api(deskSrc, desk, admin, "POST", {
      action: "create", connectionId: id, table: "menu_big", titleColumn: "name", keyColumn: "id",
      bodyColumns: [{ column: "price", label: "가격", unit: "원" }], rowLimit: 50, schedule: "manual",
    });
    assert.equal(c.status, 201, JSON.stringify(c.data));
    const state = await importAll(deskSrc, desk, admin, c.data.id);
    assert.equal(state.created, 50);
    assert.equal(state.truncated, 5150);
    const del = await api(deskSrc, desk, admin, "POST", { action: "delete", sourceId: c.data.id, documents: "delete" });
    assert.equal(del.status, 200);
  });
  await check("B-10 고유키 없이 저장하면 거부", async () => {
    const r = await api(deskSrc, desk, admin, "POST", { action: "create", ...menuConfig, table: "members", keyColumn: "" });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /고유키/);
  });
  await check("B-11 담당자·다른 고객사 관리자는 소스 가져오기·삭제 불가(404)", async () => {
    assert.equal((await api(deskSrc, desk, agent, "POST", { action: "import", sourceId: menuSourceId })).status, 404);
    assert.equal((await api(deskSrc, desk, other, "POST", { action: "delete", sourceId: menuSourceId })).status, 404);
    assert.equal((await api(shopSrc, desk, other, "POST", { action: "import", sourceId: menuSourceId })).status, 404);
  });
  await check("B-12 에이전시 소유자도 /api/bots 경로로 같은 소스를 보고 다시 가져오기", async () => {
    const r = await api(agencySrc, agency, owner);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.sources.some((x: { id: string }) => x.id === menuSourceId));
    const state = await importAll(agencySrc, agency, owner, menuSourceId);
    assert.equal(state.unchanged, 15);
    assert.equal(state.created, 0);
    const del = await api(agencySrc, agency, owner, "POST", { action: "delete", sourceId: menuSourceId, documents: "delete" });
    assert.equal(del.status, 200);
  });
  // ---------- 단계 C ----------
  let syncSourceId = "";
  await check("C-01 /api/cron/db-sync 는 CRON_SECRET 없이는 401, 있으면 실행 결과(접속 정보 없음)", async () => {
    assert.equal((await api("/api/cron/db-sync", agency)).status, 401);
    assert.equal((await api("/api/cron/db-sync", agency, "", "GET", undefined, { Authorization: "Bearer wrong" })).status, 401);
    const r = await api("/api/cron/db-sync", agency, "", "GET", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ok, true);
    assert.ok(!JSON.stringify(r.data).includes(db.password));
  });
  await check("C-02 소스 목록: 주기·마지막·다음 예정, 주기 변경 시 다음 예정 재계산", async () => {
    const c = await api(deskSrc, desk, admin, "POST", { action: "create", ...menuConfig, schedule: "daily" });
    assert.equal(c.status, 201, JSON.stringify(c.data));
    syncSourceId = c.data.id;
    await importAll(deskSrc, desk, admin, syncSourceId);
    let mine = (await api(deskSrc, desk, admin)).data.sources.find((x: { id: string }) => x.id === syncSourceId);
    assert.equal(mine.schedule, "daily");
    assert.ok(mine.lastSyncedAt && mine.nextSyncAt > mine.lastSyncedAt);
    const u = await api(deskSrc, desk, admin, "POST", { action: "update", sourceId: syncSourceId, schedule: "hourly" });
    assert.equal(u.status, 200, JSON.stringify(u.data));
    mine = (await api(deskSrc, desk, admin)).data.sources.find((x: { id: string }) => x.id === syncSourceId);
    assert.equal(mine.schedule, "hourly");
    assert.ok(Math.abs(mine.nextSyncAt - (Math.floor(Date.now() / 1000) + 3600)) < 120, "매시간이면 약 1시간 뒤");
  });
  await check("C-05 멈춘 소스는 '다시 켜기'로 실패 횟수·사유 초기화", async () => {
    await sql`UPDATE db_sources SET enabled=FALSE, consecutive_failures=3, last_error='QA 멈춤' WHERE id=${syncSourceId}`;
    let mine = (await api(deskSrc, desk, admin)).data.sources.find((x: { id: string }) => x.id === syncSourceId);
    assert.equal(mine.enabled, false);
    const u = await api(deskSrc, desk, admin, "POST", { action: "update", sourceId: syncSourceId, enabled: true });
    assert.equal(u.status, 200);
    mine = (await api(deskSrc, desk, admin)).data.sources.find((x: { id: string }) => x.id === syncSourceId);
    assert.equal(mine.enabled, true);
    assert.equal(mine.consecutiveFailures, 0);
    assert.equal(mine.lastError, null);
  });
  await check("A-10 삭제 후 secret_enc NULL·목록 제외·감사", async () => {
    assert.equal((await api(`${deskBase}/${id}`, desk, agent, "DELETE")).status, 404);
    const r = await api(`${deskBase}/${id}`, desk, admin, "DELETE");
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const [row] = await sql`SELECT secret_enc,status FROM data_connections WHERE id=${id}`;
    assert.equal(row.secret_enc, null);
    assert.equal(row.status, "deleted");
    assert.ok(!(await api(deskBase, desk, admin)).data.some((c: { id: string }) => c.id === id));
    assert.equal((await api(`${deskBase}/${id}`, desk, admin)).status, 404);
    const [audit] = await sql`SELECT 1 FROM access_audit_logs WHERE action='data_connection.delete' AND target_id=${id}`;
    assert.ok(audit);
  });
  await check("C-07 연결 삭제 후 소스는 '연결 삭제됨'·자동 동기화 중지, 문서는 보관(검색 제외)", async () => {
    const mine = (await api(deskSrc, desk, admin)).data.sources.find((x: { id: string }) => x.id === syncSourceId);
    assert.equal(mine.connectionDeleted, true);
    assert.equal(mine.enabled, false);
    assert.match(mine.lastError, /연결이 삭제돼/);
    const [live] = await sql`SELECT count(*)::int AS n FROM documents d JOIN db_source_rows r ON r.document_id=d.id WHERE r.source_id=${syncSourceId} AND d.archived_at IS NULL`;
    assert.equal(live.n, 0);
    const imp = await api(deskSrc, desk, admin, "POST", { action: "import", sourceId: syncSourceId, begin: true });
    assert.equal(imp.status, 409, "삭제된 연결로는 가져오지 않음");
    const del = await api(deskSrc, desk, admin, "POST", { action: "delete", sourceId: syncSourceId, documents: "delete" });
    assert.equal(del.status, 200);
  });
  await writeFile("/tmp/db-knowledge-http-results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.filter((r) => r.status === "pass").length, failed: results.filter((r) => r.status === "fail").length }));
  if (results.some((r) => r.status === "fail")) process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
