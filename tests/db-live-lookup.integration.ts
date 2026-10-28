/**
 * 실시간 조회 DB 통합 검사(PRD-db-live-lookup). 앱 DB 변경은 하나의 트랜잭션 안에서 하고 전부 롤백한다.
 * "고객사 DB"는 seed-db-knowledge-qa.ts가 만든 로컬 샘플 DB(menu_stock·slow_stock)에 실제로 질의한다.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sql from "../lib/neon";
import type { AccessDatabase } from "../lib/access/schema";
import { createAccessSchema } from "../lib/access/schema";
import { createDataConnection, deleteDataConnection } from "../lib/data-connections/store";
import type { ConnectionConfig } from "../lib/data-connections/types";
import { CALLS_PER_SESSION, TOO_BROAD_MESSAGE } from "../lib/db-lookups/config";
import { clearLookupCache, liveLookupsFor, runLookup, runToolCalls, toolsOf } from "../lib/db-lookups/run";
import { createLookup, dbLookup, deleteLookup, listLookups, setLookupEnabled, updateLookup } from "../lib/db-lookups/store";

const STOCK_COLUMNS = ["id", "name", "size", "category", "stock", "is_active"];

async function main() {
  if (process.env.PORTAL_DB_CHECK !== "1") {
    console.log("미실행: PORTAL_DB_CHECK=1 필요");
    return;
  }
  const url = new URL(process.env.POSTGRES_URL || "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname != "/chatbot_qa") throw Error("전용 로컬 QA DB만 허용");
  const fixture = JSON.parse(await readFile("/tmp/chatbot-qa-runtime/db-fixture.json", "utf8")) as ConnectionConfig;
  const rollback = new Error("verification rollback");
  let checks = 0;
  const pass = (name: string) => {
    checks++;
    console.log("PASS", name);
  };
  const { createDataKnowledgeSchema } = await import("../lib/data-connections/schema");
  await createDataKnowledgeSchema(sql as unknown as AccessDatabase);
  try {
    await sql.begin(async (tx) => {
      const db = tx as unknown as AccessDatabase;
      await createAccessSchema(db);
      const s = randomUUID();
      const tenant = "lk-" + s,
        freeTenant = "lk-free-" + s,
        customer = "lk-customer-" + s,
        other = "lk-other-" + s,
        freeCustomer = "lk-free-customer-" + s,
        admin = "lk-admin-" + s,
        otherAdmin = "lk-other-admin-" + s,
        freeAdmin = "lk-free-admin-" + s,
        bot = "lk-bot-" + s,
        otherBot = "lk-other-bot-" + s,
        freeBot = "lk-free-bot-" + s;
      await tx`INSERT INTO tenants(id,name,api_key,plan) VALUES(${tenant},'조회 에이전시',${randomUUID()},'pro'),(${freeTenant},'무료 에이전시',${randomUUID()},'pro')`;
      await tx`INSERT INTO users(id,name,email) VALUES(${admin},'관리자',${admin + "@example.test"}),(${otherAdmin},'다른 관리자',${otherAdmin + "@example.test"}),(${freeAdmin},'무료 관리자',${freeAdmin + "@example.test"})`;
      await tx`INSERT INTO customers(id,tenant_id,name) VALUES(${customer},${tenant},'카페 A'),(${other},${tenant},'쇼핑몰 B'),(${freeCustomer},${freeTenant},'무료 카페')`;
      await tx`INSERT INTO customer_memberships(customer_id,user_id,role) VALUES(${customer},${admin},'admin'),(${other},${otherAdmin},'admin'),(${freeCustomer},${freeAdmin},'admin')`;
      await tx`INSERT INTO bots(id,tenant_id,customer_id,name,type) VALUES(${bot},${tenant},${customer},'카페 봇','ai'),(${otherBot},${tenant},${other},'쇼핑몰 봇','ai'),(${freeBot},${freeTenant},${freeCustomer},'무료 봇','ai')`;
      const input = { name: "샘플 DB", kind: fixture.kind, host: fixture.host, port: fixture.port, database: fixture.database, username: fixture.username, password: fixture.password, ssl: fixture.ssl };
      const conn = await createDataConnection(db, admin, customer, input);
      const otherConn = await createDataConnection(db, otherAdmin, other, input);
      const freeConn = await createDataConnection(db, freeAdmin, freeCustomer, input);
      await tx`UPDATE tenants SET plan='starter' WHERE id=${freeTenant}`;
      const actor = { userId: admin, tenantId: tenant };
      const botRef = { id: bot, customer_id: customer };
      const stockInput = {
        connectionId: conn.id,
        name: "재고 조회",
        description: "손님이 특정 메뉴의 남은 수량을 물을 때",
        table: "menu_stock",
        params: [
          { column: "name", label: "메뉴 이름", match: "eq" },
          { column: "size", label: "크기", match: "eq", required: false },
        ],
        outputs: [
          { column: "name", label: "메뉴" },
          { column: "size", label: "크기", valueMap: { R: "레귤러", L: "라지" } },
          { column: "stock", label: "남은 수량", unit: "개", type: "integer" },
        ],
        filters: [{ column: "is_active", op: "eq", value: 1, kind: "number" }],
        examples: ["아메리카노 재고 알려줘", "카페라떼 라지 몇 개 남았어요"],
      };

      // LA-04·LA-18·LA-16 생성 규칙
      const stock = await createLookup(db, actor, botRef, stockInput, STOCK_COLUMNS);
      assert.equal(stock.name, "재고 조회");
      assert.equal(stock.max_rows, 5);
      const [audit] = await tx`SELECT * FROM access_audit_logs WHERE action='db_lookup.create' AND target_id=${stock.id}`;
      assert.equal(audit.customer_id, customer);
      await assert.rejects(() => createLookup(db, actor, botRef, { ...stockInput, outputs: [{ column: "price" }] }, STOCK_COLUMNS), /표에 없는 컬럼/);
      for (let i = 0; i < 4; i++) await createLookup(db, actor, botRef, { ...stockInput, name: "조회 " + i }, STOCK_COLUMNS);
      await assert.rejects(() => createLookup(db, actor, botRef, { ...stockInput, name: "여섯 번째" }, STOCK_COLUMNS), { status: 409 });
      for (const l of (await listLookups(db, bot)).filter((l) => l.id !== stock.id)) await deleteLookup(db, actor, botRef, l.id);
      pass("LA-04 챗봇당 5개·표에 없는 컬럼 거부·감사 기록");

      await assert.rejects(() => createLookup(db, actor, { id: otherBot, customer_id: other }, stockInput, STOCK_COLUMNS), { status: 404 });
      await assert.rejects(() => dbLookup(db, otherBot, stock.id), { status: 404 });
      await assert.rejects(() => updateLookup(db, { userId: otherAdmin, tenantId: tenant }, { id: otherBot, customer_id: other }, stock.id, { name: "x" }, STOCK_COLUMNS), { status: 404 });
      assert.ok(otherConn.id);
      pass("LA-16 다른 고객사 챗봇에서는 이 연결·조회를 쓸 수 없음(404)");

      await assert.rejects(
        () => createLookup(db, { userId: freeAdmin, tenantId: freeTenant }, { id: freeBot, customer_id: freeCustomer }, { ...stockInput, connectionId: freeConn.id }, STOCK_COLUMNS),
        { status: 403 },
      );
      pass("LA-18 무료 요금제는 추가 불가(403)");

      const row = await dbLookup(db, bot, stock.id);
      const ctx = { botId: bot, sessionId: "lk-session-" + s };
      clearLookupCache();

      // LA-07 정상 조회
      const ok = await runLookup(db, row, { p1: "아메리카노", p2: "L" }, ctx);
      assert.equal(ok.status, "ok");
      assert.deepEqual(ok.rows, [{ 메뉴: "아메리카노", 크기: "라지", "남은 수량": "7개" }]);
      const both = await runLookup(db, row, { p1: "아메리카노" }, ctx);
      assert.equal(both.rows?.length, 2, "선택 조건(크기)이 비면 조건에서 빠진다");
      const caseInsensitive = await runLookup(db, row, { p1: "카페라떼", p2: "r" }, ctx);
      assert.deepEqual(caseInsensitive.rows, [{ 메뉴: "카페라떼", 크기: "레귤러", "남은 수량": "5개" }]);
      pass("LA-07 실제 조회: 라벨·단위·값 바꾸기, 같음은 대소문자 무시, 선택 조건 생략");

      // LA-09 결과 없음 / 고정 조건(판매 중지 제외)
      assert.equal((await runLookup(db, row, { p1: "없는 메뉴" }, ctx)).status, "empty");
      assert.equal((await runLookup(db, row, { p1: "초코 브라우니" }, ctx)).status, "empty", "is_active=0은 고정 조건으로 제외");
      pass("LA-09 결과 없음·고정 조건 적용");

      // LA-08 결과 수 초과(G4) — 포함 검색 "커피" 6행 > 최대 5
      const catRow = await dbLookup(
        db,
        bot,
        (await updateLookup(db, actor, botRef, stock.id, { params: [{ column: "category", label: "분류", match: "contains" }] }, STOCK_COLUMNS)).id,
      );
      const ctxB = { botId: bot, sessionId: "lk-broad-" + s };
      const broad = await runLookup(db, catRow, { p1: "커피" }, ctxB);
      assert.equal(broad.status, "too_broad");
      assert.equal(broad.rows, undefined);
      assert.match(String(broad.message), /5건을 넘어요/);
      assert.ok(String(broad.message).includes(TOO_BROAD_MESSAGE));
      // LA-06 넓은 값(G3)은 고객사 DB에 가지 않는다
      for (const v of ["전체", "%", "커"]) assert.equal((await runLookup(db, catRow, { p1: v }, ctxB)).status, "too_broad", v);
      assert.equal((await runLookup(db, catRow, {}, ctxB)).status, "need_input");
      // 포함 검색 와일드카드는 글자 그대로
      assert.equal((await runLookup(db, catRow, { p1: "%_" }, ctxB)).status, "empty");
      pass("LA-08·LA-06 결과 6행>5는 값 없이 too_broad, 넓은 값·빈 값은 실행 안 함, 와일드카드 이스케이프");
      await updateLookup(db, actor, botRef, stock.id, { params: stockInput.params }, STOCK_COLUMNS);

      // LA-14 캐시
      clearLookupCache();
      const fresh = await dbLookup(db, bot, stock.id);
      const c1 = await runLookup(db, fresh, { p1: "자몽에이드" }, { ...ctx, sessionId: "lk-cache-" + s });
      const c2 = await runLookup(db, fresh, { p1: "자몽에이드" }, { ...ctx, sessionId: "lk-cache-" + s });
      assert.equal(c1.cached, undefined);
      assert.equal(c2.cached, true);
      assert.deepEqual(c2.rows, c1.rows);
      const [cachedCall] = await tx`SELECT cached FROM db_lookup_calls WHERE session_id=${"lk-cache-" + s} ORDER BY created_at DESC, cached DESC LIMIT 1`;
      assert.equal(cachedCall.cached, true);
      pass("LA-14 같은 값 30초 캐시(두 번째는 cached)");

      // LA-10 한 메시지 3개 호출(G5)
      const lookups = await liveLookupsFor(db, bot, tenant);
      assert.equal(lookups.length, 1);
      assert.deepEqual(lookups[0].examples, ["아메리카노 재고 알려줘", "카페라떼 라지 몇 개 남았어요"], "예시 질문이 저장돼 대화에 붙는 조회에 실린다");
      const tools = toolsOf(lookups);
      assert.equal(tools[0].function.name, "lookup_1");
      const runs = await runToolCalls(
        db,
        lookups,
        [
          { id: "a", name: "lookup_1", arguments: JSON.stringify({ p1: "콜드브루" }) },
          { id: "b", name: "lookup_1", arguments: JSON.stringify({ p1: "치즈케이크" }) },
          { id: "c", name: "lookup_1", arguments: JSON.stringify({ p1: "바닐라라떼" }) },
          { id: "d", name: "lookup_9", arguments: "{}" },
        ],
        { botId: bot, sessionId: "lk-msg-" + s },
      );
      assert.deepEqual(runs.map((r) => [r.id, r.result.status]), [["a", "ok"], ["b", "ok"], ["c", "too_many_calls"], ["d", "error"]]);
      assert.equal(runs[2].result.rows, undefined);
      pass("LA-10 한 메시지 조회 2개까지, 나머지는 too_many_calls·모르는 도구는 error(모든 호출 id에 결과)");

      // LA-11 대화 10분 10회(G6)
      clearLookupCache();
      const session = "lk-rate-" + s;
      const statuses: string[] = [];
      for (let i = 0; i <= CALLS_PER_SESSION; i++) statuses.push((await runLookup(db, fresh, { p1: "메뉴" + i }, { botId: bot, sessionId: session })).status);
      assert.deepEqual(statuses.slice(0, CALLS_PER_SESSION), Array(CALLS_PER_SESSION).fill("empty"));
      assert.equal(statuses[CALLS_PER_SESSION], "rate_limited");
      pass("LA-11 같은 대화 11번째 조회는 rate_limited");

      // LA-12 실행 제한(G7)
      const slow = await createLookup(db, actor, botRef, { ...stockInput, name: "느린 조회", table: "slow_stock", filters: [], outputs: [{ column: "name" }, { column: "stock" }] }, ["id", "name", "size", "stock"]);
      const slowRow = await dbLookup(db, bot, slow.id);
      const started = Date.now();
      const timedOut = await runLookup(db, slowRow, { p1: "아메리카노" }, { botId: bot, sessionId: "lk-slow-" + s, timeoutMs: 300 });
      assert.equal(timedOut.status, "timeout");
      assert.equal(timedOut.rows, undefined);
      assert.ok(Date.now() - started < 5000, "제한 시간 근처에서 끊긴다");
      pass("LA-12 실행 제한을 넘기면 timeout, 값 없음");

      // LA-13 실행 기록에 입력값 없음
      const cols = await tx`SELECT column_name FROM information_schema.columns WHERE table_name='db_lookup_calls'`;
      assert.deepEqual(cols.map((c) => String(c.column_name)).sort(), ["bot_id", "cached", "created_at", "id", "latency_ms", "lookup_id", "row_count", "session_id", "status", "test"]);
      const logged = await tx`SELECT status, row_count FROM db_lookup_calls WHERE bot_id=${bot} ORDER BY created_at`;
      assert.ok(logged.some((r) => r.status === "ok" && r.row_count === 1));
      assert.ok(logged.some((r) => r.status === "too_broad"));
      const listed = (await listLookups(db, bot, stock.id))[0];
      assert.ok(listed.stats.total > 0 && listed.stats.tooBroad > 0 && listed.stats.ok > 0);
      pass("LA-13 실행 기록은 상태·행 수·시간만, 목록에 7일 집계");

      // LA-17 끄기·연결 삭제 / LA-18 요금제 하향
      await deleteLookup(db, actor, botRef, slow.id);
      await setLookupEnabled(db, actor, botRef, stock.id, false);
      assert.equal((await liveLookupsFor(db, bot, tenant)).length, 0);
      await setLookupEnabled(db, actor, botRef, stock.id, true);
      assert.equal((await liveLookupsFor(db, bot, tenant)).length, 1);
      await tx`UPDATE tenants SET plan='starter' WHERE id=${tenant}`;
      assert.equal((await liveLookupsFor(db, bot, tenant)).length, 0, "무료로 내려가면 대화에 붙지 않음");
      await assert.rejects(() => setLookupEnabled(db, actor, botRef, stock.id, true), { status: 403 });
      await tx`UPDATE tenants SET plan='pro' WHERE id=${tenant}`;
      await deleteDataConnection(db, admin, customer, conn.id);
      assert.equal((await liveLookupsFor(db, bot, tenant)).length, 0, "연결이 삭제되면 대화에 붙지 않음");
      pass("LA-17 꺼진 조회·삭제된 연결·무료 요금제는 도구로 붙지 않음");

      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  console.log(`실시간 조회 DB 검사 ${checks}건 통과 (전부 롤백)`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
