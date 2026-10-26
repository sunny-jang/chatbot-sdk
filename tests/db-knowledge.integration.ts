/**
 * DB 지식 연동 DB 통합 검사. 전용 로컬 QA DB에서 하나의 트랜잭션 안에 실행하고 전부 롤백한다.
 * 실제 "고객사 DB" 연결(A-D6)은 /tmp/chatbot-qa-runtime/db-fixture.json(seed-db-knowledge-qa.ts)이 있어야 한다.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sql from "../lib/neon";
import type { AccessDatabase } from "../lib/access/schema";
import { createAccessSchema } from "../lib/access/schema";
import {
  createDataConnection,
  dataConnection,
  deleteDataConnection,
  listDataConnections,
  testDataConnection,
  updateDataConnection,
  credentialsOf,
} from "../lib/data-connections/store";
import { postgresConnector } from "../lib/data-connections/connectors/postgres";
import type { ConnectionConfig } from "../lib/data-connections/types";

async function main() {
  if (process.env.PORTAL_DB_CHECK !== "1") {
    console.log("미실행: PORTAL_DB_CHECK=1 필요");
    return;
  }
  const url = new URL(process.env.POSTGRES_URL || "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname != "/chatbot_qa")
    throw Error("전용 로컬 QA DB만 허용");
  const fixture = JSON.parse(await readFile("/tmp/chatbot-qa-runtime/db-fixture.json", "utf8")) as ConnectionConfig;
  const rollback = new Error("verification rollback");
  let checks = 0;
  const pass = (name: string) => {
    checks++;
    console.log("PASS", name);
  };
  try {
    await sql.begin(async (tx) => {
      const db = tx as unknown as AccessDatabase;
      await createAccessSchema(db);
      const suffix = randomUUID(),
        tenant = "dbk-" + suffix,
        foreign = "dbk-other-" + suffix,
        customer = "customer-" + suffix,
        other = "customer-other-" + suffix,
        owner = "owner-" + suffix,
        admin = "admin-" + suffix,
        agent = "agent-" + suffix,
        otherAdmin = "other-admin-" + suffix;
      await tx`INSERT INTO tenants(id,name,api_key) VALUES(${tenant},'테스트 에이전시',${randomUUID()}),(${foreign},'다른 에이전시',${randomUUID()})`;
      await tx`INSERT INTO users(id,name,email) VALUES(${owner},'에이전시 소유자',${owner + "@example.test"}),(${admin},'고객사 관리자',${admin + "@example.test"}),(${agent},'담당자',${agent + "@example.test"}),(${otherAdmin},'다른 고객사 관리자',${otherAdmin + "@example.test"})`;
      await tx`INSERT INTO partner_memberships(tenant_id,user_id) VALUES(${tenant},${owner})`;
      await tx`INSERT INTO customers(id,tenant_id,name) VALUES(${customer},${tenant},'카페 A'),(${other},${tenant},'쇼핑몰 B')`;
      await tx`INSERT INTO customer_memberships(customer_id,user_id,role) VALUES(${customer},${admin},'admin'),(${customer},${agent},'agent'),(${other},${otherAdmin},'admin')`;
      const input = {
        name: "샘플 DB",
        kind: fixture.kind,
        host: fixture.host,
        port: fixture.port,
        database: fixture.database,
        username: fixture.username,
        password: fixture.password,
        ssl: fixture.ssl,
      };

      // A-D1 생성·감사·목록(비밀값 없음)
      const created = await createDataConnection(db, admin, customer, input);
      assert.equal(created.has_secret, true);
      assert.ok(!("secret_enc" in created) && !("password" in created));
      const [audit] = await tx`SELECT * FROM access_audit_logs WHERE action='data_connection.create' AND target_id=${created.id}`;
      assert.equal(audit.customer_id, customer);
      assert.equal(audit.outcome, "success");
      const [stored] = await tx`SELECT secret_enc FROM data_connections WHERE id=${created.id}`;
      assert.notEqual(stored.secret_enc, fixture.password);
      assert.ok(!String(stored.secret_enc).includes(fixture.password));
      const listed = await listDataConnections(db, owner, customer);
      assert.equal(listed.length, 1);
      assert.deepEqual(Object.keys(listed[0]).filter((k) => /secret|password/.test(k)), ["has_secret"]);
      pass("A-D1 생성·감사·목록에 비밀값 없음, 에이전시 소유자도 조회");

      // A-D5 범위 밖 조회 null/404
      await assert.rejects(() => dataConnection(db, otherAdmin, other, created.id), { status: 404 });
      await assert.rejects(() => dataConnection(db, otherAdmin, customer, created.id), { status: 404 });
      await assert.rejects(() => dataConnection(db, agent, customer, created.id), { status: 404 });
      await assert.rejects(() => listDataConnections(db, agent, customer), { status: 404 });
      await assert.rejects(() => createDataConnection(db, agent, customer, input), { status: 404 });
      pass("A-D5 다른 고객사 관리자·담당자는 연결 ID로 접근 불가(404)");

      // A-D3 PATCH: 비밀번호 비우면 유지, 이름만 바꾸면 상태 유지
      const renamed = await updateDataConnection(db, admin, customer, created.id, { name: "샘플 DB 2" });
      assert.equal(renamed.name, "샘플 DB 2");
      const { row: afterRename } = await dataConnection(db, admin, customer, created.id);
      assert.equal(afterRename.secret_enc, stored.secret_enc);
      assert.equal(credentialsOf(afterRename).password, fixture.password);
      const rehosted = await updateDataConnection(db, admin, customer, created.id, { host: fixture.host, port: fixture.port, password: "" });
      assert.equal(rehosted.has_secret, true);
      const { row: afterPw } = await dataConnection(db, admin, customer, created.id);
      assert.equal(credentialsOf(afterPw).password, fixture.password, "빈 비밀번호는 기존 값 유지");
      await updateDataConnection(db, admin, customer, created.id, { password: "wrong-password-" + suffix });
      const { row: changed } = await dataConnection(db, admin, customer, created.id);
      assert.equal(credentialsOf(changed).password, "wrong-password-" + suffix);
      assert.equal(changed.status, "untested");
      pass("A-D3 수정 시 비밀번호 생략은 유지, 입력하면 교체·상태 초기화");

      // A-D4 틀린 비밀번호 테스트 → 사람 말 사유, last_error에 비밀값 없음
      const failed = await testDataConnection(db, admin, customer, created.id);
      assert.equal(failed.result.ok, false);
      assert.match(failed.connection.last_error ?? "", /비밀번호가 틀렸어요/);
      assert.equal(failed.connection.status, "error");
      for (const leak of ["wrong-password", fixture.password, fixture.username, "postgres://"])
        assert.ok(!(failed.connection.last_error ?? "").includes(leak), "leak " + leak);
      pass("A-D4 틀린 비밀번호는 사람 말 사유, last_error에 비밀값·접속 문자열 없음");

      // A-D1' 올바른 비밀번호로 테스트 → ok, 테이블 수
      await updateDataConnection(db, admin, customer, created.id, { password: fixture.password });
      const ok = await testDataConnection(db, admin, customer, created.id);
      assert.equal(ok.result.ok, true);
      assert.ok(ok.result.ok && ok.result.tables.some((t) => t.name === "menu"));
      assert.equal(ok.connection.status, "ok");
      assert.ok((ok.connection.table_count ?? 0) >= 3);
      pass("A-D1' 저장된 연결 테스트 성공 시 상태 ok·테이블 수 기록");

      // 한도 3개
      await createDataConnection(db, admin, customer, { ...input, name: "둘" });
      await createDataConnection(db, admin, customer, { ...input, name: "셋" });
      await assert.rejects(() => createDataConnection(db, admin, customer, { ...input, name: "넷" }), { status: 409 });
      pass("A-12 고객사당 연결 3개 한도");

      // 사설 IP·포트 거부 (저장 시점은 형식만, 연결 시점에 주소 검사)
      await assert.rejects(() => createDataConnection(db, otherAdmin, other, { ...input, port: 80 }), { status: 400 });
      const privateConn = await createDataConnection(db, otherAdmin, other, { ...input, host: "10.0.0.1" });
      const privateTest = await testDataConnection(db, otherAdmin, other, privateConn.id);
      assert.equal(privateTest.result.ok, false);
      assert.match(privateTest.result.ok ? "" : privateTest.result.error, /내부 또는 제한된 주소/);
      pass("A-04/A-05 포트 범위 거부·사설 IP는 연결 시 거부");

      // A-D2 삭제: secret 파기·status deleted·목록 제외·감사
      await assert.rejects(() => deleteDataConnection(db, agent, customer, created.id), { status: 404 });
      await deleteDataConnection(db, admin, customer, created.id);
      const [deleted] = await tx`SELECT secret_enc,status,deleted_at FROM data_connections WHERE id=${created.id}`;
      assert.equal(deleted.secret_enc, null);
      assert.equal(deleted.status, "deleted");
      assert.ok(deleted.deleted_at);
      assert.equal((await listDataConnections(db, admin, customer)).length, 2);
      await assert.rejects(() => dataConnection(db, admin, customer, created.id), { status: 404 });
      const [delAudit] = await tx`SELECT 1 FROM access_audit_logs WHERE action='data_connection.delete' AND target_id=${created.id}`;
      assert.ok(delAudit);
      pass("A-D2 삭제 시 접속 정보 파기·목록 제외·감사");

      // A-D6 커넥터: 읽기 전용 세션에서 쓰기 실패, 샘플·테이블 목록
      const tables = await postgresConnector.listTables(fixture);
      assert.ok(tables.some((t) => t.name === "menu" && t.kind === "table"));
      const sample = await postgresConnector.sample(fixture, "public", "menu", 3);
      assert.equal(sample.rows.length, 3);
      assert.ok(sample.columns.some((c) => c.name === "price" && /int/.test(c.type)));
      await assert.rejects(
        () => postgresConnector.sample(fixture, "public", "no_such_table"),
        (e: unknown) => (e as { status?: number }).status === 404,
      );
      const writer = await import("../lib/data-connections/connectors/postgres");
      void writer;
      // 읽기 전용 트랜잭션 확인: sample()과 같은 경로로 INSERT를 시도하면 25006
      const { PortalError } = await import("../lib/customer-portal/validation");
      let readOnlyError = "";
      try {
        await postgresConnector.sample({ ...fixture }, "public", "menu; INSERT INTO menu(id,name,category,price) VALUES (999,'x','y',1); --");
      } catch (e) {
        readOnlyError = e instanceof PortalError ? e.message : String(e);
      }
      assert.match(readOnlyError, /테이블을 찾지 못했어요/, "식별자 인용으로 주입 불가");
      const direct = (await import("postgres")).default;
      const ro = direct({
        host: fixture.host, port: fixture.port, database: fixture.database, username: fixture.username, password: fixture.password, ssl: "require", max: 1, prepare: false,
      });
      try {
        await assert.rejects(() => ro`INSERT INTO menu(id,name,category,price) VALUES (999,'x','y',1)`, (e: unknown) => (e as { code?: string }).code === "42501");
      } finally {
        await ro.end();
      }
      let rows = 0;
      await postgresConnector.readRows(fixture, { schema: "public", table: "menu", columns: ["name", "price"], keyColumn: "id", filters: [{ column: "is_active", op: "eq", value: 1 }] }, async (batch) => { rows += batch.length; }, 4);
      assert.equal(rows, 15, "is_active=1 행 15개를 4개씩 키셋 페이징");
      pass("A-D6 커넥터 읽기 전용(사용자 권한·식별자 인용)·샘플·테이블 목록·키셋 읽기");

      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  console.log(`DB 지식 연동 DB 검사 ${checks}건 통과 (전부 롤백)`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
