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
    for (const name of [PREFIX + "둘", PREFIX + "셋"]) {
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
