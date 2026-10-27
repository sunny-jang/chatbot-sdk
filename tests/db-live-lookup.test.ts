import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_LOOKUP_INSTRUCTIONS,
  TOO_BROAD_MESSAGE,
  checkLookupArgs,
  formatLookupRows,
  isBroadRequest,
  liveSourceLabel,
  lookupConfig,
  toolDefinition,
} from "../lib/db-lookups/config";
import { buildLookupQuery } from "../lib/data-connections/connectors/postgres";
import { buildMysqlLookupQuery } from "../lib/data-connections/connectors/mysql";

const menuColumns = ["id", "name", "category", "price", "stock", "size", "is_active", "updated_at"];
const base = {
  connectionId: "c1",
  name: "재고 조회",
  description: "손님이 특정 메뉴의 남은 수량을 물을 때",
  table: "menu",
  params: [{ column: "name", label: "메뉴 이름", match: "eq" }],
  outputs: [
    { column: "name", label: "메뉴" },
    { column: "stock", label: "남은 수량", unit: "개", type: "integer" },
  ],
};

test("LA-01 lookupConfig: 조건 컬럼 없거나 필수 조건이 없으면 거부(G1)", () => {
  assert.throws(() => lookupConfig({ ...base, params: [] }, menuColumns), /조건 컬럼을 하나 이상/);
  assert.throws(() => lookupConfig({ ...base, params: [{ column: "name", required: false }] }, menuColumns), /하나 이상은 필수/);
  assert.throws(() => lookupConfig({ ...base, outputs: [] }, menuColumns), /답에 쓸 컬럼/);
  assert.throws(() => lookupConfig({ ...base, params: [{ column: "name" }, { column: "name" }] }, menuColumns), /두 번/);
  const ok = lookupConfig(base, menuColumns);
  assert.equal(ok.maxRows, 5);
  assert.equal(ok.schema, "public");
  assert.deepEqual(ok.params[0], { column: "name", label: "메뉴 이름", match: "eq", required: true, kind: "text" });
});

test("LA-02 lookupConfig: 개인정보 추정 컬럼은 조건·답 컬럼 모두 거부", () => {
  const members = ["id", "name", "phone", "email", "grade"];
  assert.throws(() => lookupConfig({ ...base, table: "members", params: [{ column: "phone" }] }, members), /개인정보/);
  assert.throws(() => lookupConfig({ ...base, table: "members", params: [{ column: "grade" }], outputs: [{ column: "email" }] }, members), /개인정보/);
  // 사람 표의 name은 개인정보, 메뉴 표의 name은 아님
  assert.throws(() => lookupConfig({ ...base, table: "members", params: [{ column: "name" }], outputs: [{ column: "grade" }] }, members), /개인정보/);
  assert.doesNotThrow(() => lookupConfig(base, menuColumns));
});

test("LA-03 lookupConfig: 최대 결과 수 1~10, 숫자 조건은 같음만", () => {
  assert.throws(() => lookupConfig({ ...base, maxRows: 0 }, menuColumns), /1~10/);
  assert.throws(() => lookupConfig({ ...base, maxRows: 11 }, menuColumns), /1~10/);
  const n = lookupConfig({ ...base, params: [{ column: "id", type: "integer", match: "contains" }] }, menuColumns);
  assert.equal(n.params[0].kind, "number");
  assert.equal(n.params[0].match, "eq");
});

test("LA-05 buildLookupQuery(Postgres): 인용·바인딩·포함 이스케이프·LIMIT", () => {
  const q = buildLookupQuery({
    schema: "public",
    table: 'me"nu',
    columns: ["name", "stock"],
    filters: [{ column: "is_active", op: "eq", value: 1, kind: "number" }],
    conditions: [
      { column: "name", match: "contains", kind: "text", value: "50%_off\\" },
      { column: "size", match: "eq", kind: "text", value: "L" },
      { column: "id", match: "eq", kind: "number", value: "3" },
    ],
    limit: 6,
  });
  assert.equal(
    q.sql,
    `SELECT "name", "stock" FROM "public"."me""nu" WHERE "is_active" = $1 AND "name"::text ILIKE '%' || $2 || '%' ESCAPE '\\' AND "size"::text = $3 AND "id" = $4 LIMIT 6`,
  );
  // 결과가 없을 때 쓰는 대소문자 무시 질의
  assert.match(buildLookupQuery({ schema: "public", table: "menu", columns: ["name"], filters: [], conditions: [{ column: "size", match: "eq", kind: "text", value: "r" }], limit: 6 }, true).sql, /lower\("size"::text\) = lower\(\$1\)/);
  assert.deepEqual(q.params, [1, "50\\%\\_off\\\\", "L", 3]);
  assert.throws(() => buildLookupQuery({ schema: "public", table: "menu", columns: ["name"], filters: [], conditions: [], limit: 6 }), /조건이 없는/);
  assert.match(buildLookupQuery({ schema: "public", table: "menu", columns: ["name"], filters: [], conditions: [{ column: "name", match: "eq", value: "a" }], limit: 999 }).sql, /LIMIT 11$/);
});

test("LA-05 buildMysqlLookupQuery: 백틱·?·기본 스키마는 접속 DB", () => {
  const config = { kind: "mysql" as const, host: "db.example.com", port: 3306, database: "shop", username: "r", password: "x", ssl: false };
  const q = buildMysqlLookupQuery(
    {
      schema: "public",
      table: "menu",
      columns: ["name", "stock"],
      filters: [],
      conditions: [
        { column: "name", match: "eq", kind: "text", value: "아메리카노'; DROP TABLE menu; --" },
        { column: "category", match: "contains", kind: "text", value: "커_" },
      ],
      limit: 6,
    },
    config,
  );
  assert.equal(q.sql, "SELECT `name`, `stock` FROM `shop`.`menu` WHERE `name` = ? AND CAST(`category` AS CHAR) LIKE CONCAT('%', ?, '%') LIMIT 6");
  assert.deepEqual(q.params, ["아메리카노'; DROP TABLE menu; --", "커\\_"]);
});

test("LA-06 checkLookupArgs: 필수 빈 값 need_input, 넓은 값·짧은 포함 too_broad, 선택 빈 값은 제외(G2·G3)", () => {
  const params = lookupConfig({ ...base, params: [{ column: "name", label: "메뉴 이름", match: "contains" }, { column: "size", label: "크기", required: false }] }, menuColumns).params;
  const missing = checkLookupArgs(params, {});
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.status, "need_input");
  assert.match(!missing.ok ? missing.message : "", /메뉴 이름/);
  for (const v of ["전체", "모두", "%", "*", "all", "전부", "커"]) {
    const r = checkLookupArgs(params, { p1: v });
    assert.equal(!r.ok && r.status, "too_broad", v);
    assert.equal(!r.ok && r.message, TOO_BROAD_MESSAGE);
  }
  const ok = checkLookupArgs(params, { p1: " 아메리카노 ", p2: "" });
  assert.deepEqual(ok, { ok: true, conditions: [{ column: "name", match: "contains", kind: "text", value: "아메리카노" }] });
  const num = checkLookupArgs([{ column: "id", label: "번호", match: "eq", required: true, kind: "number" }], { p1: "abc" });
  assert.equal(!num.ok && num.status, "need_input");
});

test("LA-15 isBroadRequest: 대량 요청 표현만 넓은 요청으로 본다(G8)", () => {
  for (const m of [
    "재고 전부 알려줘",
    "모든 상품 재고 보여줘",
    "전체 목록 뽑아줘",
    "이번 달 매출 합계 알려줘",
    "주문 내역 엑셀로 줘",
    "지난 1년 주문 다 뽑아줘",
    "재고 많은 순위 알려줘",
    "평균 가격이 얼마야",
    "csv 다운로드",
    "재고 다 알려줘",
    "전체 메뉴 알려줘",
  ])
    assert.equal(isBroadRequest(m), true, m);
  for (const m of ["아메리카노 재고 있어요?", "라떼 몇 개 남았어요", "전체 메뉴 중 라떼 가격", "오늘 영업해요?", "다 팔렸어요?", "모두 몇 시에 열어요?", "아메리카노 재고 확인해 주세요, 모두 고마워요", "전체 매장 중 강남점 영업 확인"])
    assert.equal(isBroadRequest(m), false, m);
});

test("LA-19 toolDefinition: lookup_N, 라벨 설명, 필수만 required", () => {
  const config = lookupConfig({ ...base, params: [{ column: "name", label: "메뉴 이름" }, { column: "size", label: "크기", required: false }] }, menuColumns);
  const t = toolDefinition(1, config);
  assert.equal(t.function.name, "lookup_2");
  assert.deepEqual(t.function.parameters.required, ["p1"]);
  assert.match(t.function.parameters.properties.p1.description, /메뉴 이름/);
  assert.match(t.function.parameters.properties.p2.description, /선택/);
  assert.match(t.function.description, /재고 조회/);
  assert.match(t.function.description, /전체 목록·합계·통계에는 사용하지 않는다/);
  // 원본 컬럼 이름은 도구 정의에 넣지 않는다.
  assert.deepEqual(Object.keys(t.function.parameters.properties), ["p1", "p2"]);
  assert.ok(!JSON.stringify(t.function.parameters).includes("size"));
});

test("LA-20·21 출처 라벨·결과 포맷·지시문", () => {
  // 2026-10-27 05:03 UTC = 14:03 KST
  assert.equal(liveSourceLabel("재고 조회", Date.UTC(2026, 9, 27, 5, 3) / 1000), "재고 조회 · 14:03 기준");
  const rows = formatLookupRows([{ name: "아메리카노", stock: 12, extra: "x" }, { name: "라떼", stock: null }], [
    { column: "name", label: "메뉴" },
    { column: "stock", label: "남은 수량", unit: "개", type: "integer" },
  ]);
  assert.deepEqual(rows, [{ 메뉴: "아메리카노", "남은 수량": "12개" }, { 메뉴: "라떼", "남은 수량": "(없음)" }]);
  assert.match(LIVE_LOOKUP_INSTRUCTIONS, /지어내지 마라/);
  assert.ok(LIVE_LOOKUP_INSTRUCTIONS.includes(TOO_BROAD_MESSAGE));
});
