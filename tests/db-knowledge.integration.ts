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
import { createDbSource, dbSource, deleteDbSource, listDbSources } from "../lib/db-sources/store";
import { beginImport, importStep } from "../lib/db-sources/import";
import { fakeEmbeddingsEnabled } from "../lib/embeddings";

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

      // ---------- 단계 B ----------
      if (!fakeEmbeddingsEnabled()) throw Error("B 검사는 EMBEDDINGS_FAKE=1(로컬 DB)이 필요합니다");
      const live = await createDataConnection(db, admin, customer, { ...input, name: "메뉴 DB" }).catch(async () => {
        // 위에서 한도(3개)를 채웠으므로 하나를 지우고 만든다.
        const [spare] = await tx`SELECT id FROM data_connections WHERE customer_id=${customer} AND status<>'deleted' ORDER BY created_at DESC LIMIT 1`;
        await deleteDataConnection(db, admin, customer, String(spare.id));
        return createDataConnection(db, admin, customer, { ...input, name: "메뉴 DB" });
      });
      const bot = "bot-" + suffix,
        otherBot = "bot-other-" + suffix;
      await tx`INSERT INTO bots(id,tenant_id,customer_id,name,type) VALUES(${bot},${tenant},${customer},'카페 봇','ai'),(${otherBot},${tenant},${other},'쇼핑몰 봇','ai')`;
      const actor = { userId: admin, tenantId: tenant, customerId: customer };
      const menuConfig = {
        connectionId: live.id,
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
      const menuSource = await createDbSource(db, actor, { id: bot, customer_id: customer }, menuConfig);
      assert.equal(menuSource.tableLabel, "menu");
      await assert.rejects(() => createDbSource(db, actor, { id: bot, customer_id: customer }, menuConfig), { status: 409 });
      await assert.rejects(() => createDbSource(db, actor, { id: otherBot, customer_id: other }, menuConfig), { status: 404 });
      const [createAudit] = await tx`SELECT 1 FROM access_audit_logs WHERE action='db_source.create' AND target_id=${menuSource.id}`;
      assert.ok(createAudit);
      pass("B-D0 소스 생성·같은 테이블 중복 409·다른 고객사 봇에서 이 연결 사용 불가(404)·감사");

      // B-D1 단계별 가져오기 → documents(source_kind='db')·db_source_rows
      let source = await dbSource(db, bot, menuSource.id);
      let state = await beginImport(source, tx as never);
      assert.equal(state.total, 15, "is_active=1 15행");
      assert.equal(state.truncated, 0);
      let steps = 0;
      while (!state.done && steps < 20) {
        state = await importStep(source, state, null, tx as never);
        steps++;
      }
      assert.ok(state.done);
      assert.equal(state.created, 15);
      const docs = await tx`SELECT d.title,d.content,d.source_kind,d.embedding,d.archived_at FROM documents d WHERE d.bot_id=${bot} ORDER BY d.title`;
      assert.equal(docs.length, 15);
      assert.ok(docs.every((d) => d.source_kind === "db" && d.embedding && d.archived_at === null));
      const americano = docs.find((d) => d.title === "아메리카노")!;
      assert.equal(americano.content.split("\n")[0], "menu: 아메리카노");
      assert.ok(americano.content.includes("가격: 4,500원") && americano.content.includes("판매 상태: 판매중"));
      assert.ok(!docs.some((d) => d.title === "초코 브라우니"), "품절 행은 필터로 제외");
      const rowCount = await tx`SELECT count(*)::int AS n FROM db_source_rows WHERE source_id=${menuSource.id} AND status='active' AND document_id IS NOT NULL`;
      assert.equal(rowCount[0].n, 15);
      source = await dbSource(db, bot, menuSource.id);
      assert.equal(source.sync_locked_at, null);
      assert.ok(source.last_synced_at);
      assert.equal(source.last_result?.created, 15);
      pass("B-D1 단계별 가져오기: 15행 → 문서(source_kind=db, '라벨: 값'), 행 테이블·소스 결과 기록, 잠금 해제");

      // B-D2 같은 데이터로 다시 가져오기 → 변경 없음, 문서 수 그대로
      state = await beginImport(source, tx as never);
      // 단계마다 하트비트가 sync_locked_at을 앞으로 옮겨도 이번 실행에서 본 행은 보관하지 않아야 한다.
      await tx`UPDATE db_sources SET sync_locked_at=sync_locked_at+300 WHERE id=${menuSource.id}`;
      await tx`UPDATE db_source_rows SET synced_at=synced_at-600 WHERE source_id=${menuSource.id}`;
      while (!state.done) state = await importStep(source, state, null, tx as never);
      assert.equal(state.archived, 0, "하트비트와 무관하게 실행 시작 시각 기준");
      assert.equal(state.created, 0);
      assert.equal(state.unchanged, 15);
      assert.equal((await tx`SELECT count(*)::int AS n FROM documents WHERE bot_id=${bot}`)[0].n, 15);
      pass("B-D2 재가져오기는 해시가 같으면 변경 없음(임베딩·문서 재생성 없음)");

      // B-D3 상한: menu_big 5,200행을 row_limit 50으로 → 50행 반영 + 5,150행 초과
      const big = await createDbSource(db, actor, { id: bot, customer_id: customer }, {
        connectionId: live.id, table: "menu_big", titleColumn: "name", keyColumn: "id",
        bodyColumns: [{ column: "price", label: "가격", unit: "원" }], rowLimit: 50, schedule: "manual",
      });
      const bigSource = await dbSource(db, bot, big.id);
      state = await beginImport(bigSource, tx as never);
      assert.equal(state.total, 50);
      assert.equal(state.truncated, 5150);
      while (!state.done) state = await importStep(bigSource, state, null, tx as never);
      assert.equal(state.created, 50);
      assert.equal((await tx`SELECT count(*)::int AS n FROM db_source_rows WHERE source_id=${big.id}`)[0].n, 50);
      pass("B-D3 행 상한: 50행만 반영하고 초과 5,150행을 결과에 기록");

      // B-09 고객사당 소스 10개 한도
      for (let i = 0; i < 8; i++)
        await tx`INSERT INTO db_sources(id,bot_id,connection_id,schema_name,table_name,title_column,key_column) VALUES(${"fill-" + i + "-" + suffix},${bot},${live.id},'public',${"t" + i},'name','id')`;
      await assert.rejects(() => createDbSource(db, actor, { id: bot, customer_id: customer }, { ...menuConfig, table: "members", titleColumn: "grade" }), { status: 409 });
      await tx`DELETE FROM db_sources WHERE id LIKE ${"fill-%-" + suffix}`;
      pass("B-09 고객사당 DB 소스 10개 한도");

      // 동시 실행 잠금
      await tx`UPDATE db_sources SET sync_locked_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${big.id}`;
      await assert.rejects(() => beginImport(bigSource, tx as never), { status: 409 });
      await tx`UPDATE db_sources SET sync_locked_at=NULL WHERE id=${big.id}`;
      pass("B-D4 동기화 중인 소스는 다시 시작 불가(409)");

      // 소스 삭제: 기본은 문서 보관, delete면 삭제
      await deleteDbSource(db, actor, { id: bot, customer_id: customer }, big.id, "delete");
      assert.equal((await tx`SELECT count(*)::int AS n FROM documents WHERE bot_id=${bot} AND title LIKE '샘플 메뉴%'`)[0].n, 0);
      await deleteDbSource(db, actor, { id: bot, customer_id: customer }, menuSource.id);
      const kept = await tx`SELECT count(*)::int AS n FROM documents WHERE bot_id=${bot} AND archived_at IS NOT NULL`;
      assert.equal(kept[0].n, 15);
      assert.equal((await listDbSources(db, bot)).length, 0);
      pass("B-D5 소스 삭제: 기본은 문서 보관(검색 제외), 선택 시 문서까지 삭제");

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
