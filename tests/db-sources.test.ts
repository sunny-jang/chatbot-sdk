import { test } from "node:test";
import assert from "node:assert/strict";
import { draftColumnRoles, isPersonalDataColumn, renderRowDocument, rowHash, formatValue } from "../lib/db-sources/render";
import { sourceConfig, nextSyncAt } from "../lib/db-sources/store";
import { buildRowQuery, buildCountQuery } from "../lib/data-connections/connectors/postgres";

const menuColumns = [
  { name: "id", type: "integer", nullable: false },
  { name: "name", type: "text", nullable: false },
  { name: "category", type: "text", nullable: false },
  { name: "price", type: "integer", nullable: false },
  { name: "description", type: "text", nullable: true },
  { name: "is_active", type: "integer", nullable: false },
  { name: "updated_at", type: "timestamp without time zone", nullable: false },
];
const menuRows = [
  { id: 1, name: "아메리카노", category: "커피", price: 4500, description: "기본 커피", is_active: 1, updated_at: "2026-10-01T00:00:00.000Z" },
  { id: 2, name: "카페라떼", category: "커피", price: 5000, description: "우유 라떼", is_active: 1, updated_at: "2026-10-01T00:00:00.000Z" },
  { id: 11, name: "초코 브라우니", category: "디저트", price: 4500, description: "다크초콜릿", is_active: 0, updated_at: "2026-10-01T00:00:00.000Z" },
];

test("draftColumnRoles: menu table → key id, title name, body category/price/description/is_active, excluded updated_at", () => {
  const d = draftColumnRoles(menuColumns, menuRows);
  const role = Object.fromEntries(d.columns.map((c) => [c.column, c.role]));
  assert.deepEqual(role, { id: "key", name: "title", category: "body", price: "body", description: "body", is_active: "body", updated_at: "excluded" });
  const price = d.columns.find((c) => c.column === "price")!;
  assert.equal(price.label, "가격");
  assert.equal(price.unit, "원");
  assert.deepEqual(d.columns.find((c) => c.column === "is_active")!.valueMap, { "1": "판매중", "0": "품절" });
  assert.equal(d.draftedBy, "rules");
  assert.equal(d.questions.length, 3);
  assert.equal(d.questions[0], "아메리카노 가격이 얼마예요?");
  assert.ok(!d.questions.some((q) => q.includes("이(가)")));
});

test("isPersonalDataColumn: phone/email/address always, name only in a person-like table", () => {
  const members = ["id", "name", "phone", "email", "address", "grade", "joined_at"];
  for (const c of ["phone", "email", "address"]) assert.equal(isPersonalDataColumn(c, members), true, c);
  assert.equal(isPersonalDataColumn("name", members), true);
  assert.equal(isPersonalDataColumn("grade", members), false);
  assert.equal(isPersonalDataColumn("name", menuColumns.map((c) => c.name)), false);
});

test("draftColumnRoles: members table excludes personal columns by default and flags them", () => {
  const cols = ["id", "name", "phone", "email", "address", "grade", "joined_at"].map((name) => ({ name, type: name === "id" ? "integer" : name === "joined_at" ? "date" : "text", nullable: true }));
  const rows = [
    { id: 1, name: "홍길동", phone: "010-0000-0001", email: "a@example.test", address: "서울", grade: "VIP", joined_at: "2026-01-05" },
    { id: 2, name: "김영희", phone: "010-0000-0002", email: "b@example.test", address: "부산", grade: "일반", joined_at: "2026-03-10" },
  ];
  const d = draftColumnRoles(cols, rows);
  for (const c of ["phone", "email", "address"]) {
    const col = d.columns.find((x) => x.column === c)!;
    assert.equal(col.personal, true, c);
    assert.equal(col.role, "excluded", c);
  }
  // 이름이 개인정보로 잡히면 제목은 개인정보가 아닌 텍스트 컬럼(grade)이 된다.
  assert.equal(d.columns.find((c) => c.role === "title")!.column, "grade");
  assert.equal(d.columns.find((c) => c.column === "name")!.role, "excluded");
  assert.equal(d.columns.filter((c) => c.role === "title").length, 1);
  assert.equal(d.columns.filter((c) => c.role === "key").length, 1);
});

test("renderRowDocument: '라벨: 값' lines with thousands separator, unit and value map", () => {
  const doc = renderRowDocument(menuRows[0], {
    titleColumn: "name",
    bodyColumns: [
      { column: "category", label: "분류" },
      { column: "price", label: "가격", unit: "원" },
      { column: "is_active", label: "판매 상태", valueMap: { "1": "판매중", "0": "품절" } },
      { column: "description", label: "설명" },
    ],
    tableLabel: "menu",
  });
  assert.equal(doc.title, "아메리카노");
  assert.equal(doc.content, "menu: 아메리카노\n분류: 커피\n가격: 4,500원\n판매 상태: 판매중\n설명: 기본 커피");
});

test("formatValue: nulls dropped, ISO dates shortened, booleans readable", () => {
  assert.equal(formatValue(null, { column: "x", label: "x" }), null);
  assert.equal(formatValue("", { column: "x", label: "x" }), null);
  assert.equal(formatValue("2026-10-01T09:00:00.000Z", { column: "d", label: "날짜" }), "2026-10-01");
  assert.equal(formatValue(true, { column: "b", label: "b" }), "예");
  assert.equal(formatValue(12.345, { column: "w", label: "무게", unit: "g" }), "12.35g");
  // 숫자처럼 보이는 문자 컬럼(우편번호·코드)은 그대로
  assert.equal(formatValue("06236", { column: "zip", label: "우편번호", type: "text" }), "06236");
  assert.equal(formatValue("12345", { column: "code", label: "코드", type: "character varying" }), "12345");
  assert.equal(formatValue("06236", { column: "zip", label: "우편번호" }), "06236");
  // numeric·bigint는 문자열로 와도 숫자 타입이면 구분 기호
  assert.equal(formatValue("25000", { column: "price", label: "가격", unit: "원", type: "numeric" }), "25,000원");
});

test("rowHash: deterministic and sensitive to content", () => {
  assert.equal(rowHash("a", "b"), rowHash("a", "b"));
  assert.notEqual(rowHash("a", "b"), rowHash("a", "c"));
  assert.notEqual(rowHash("ab", ""), rowHash("a", "b"));
});

test("buildRowQuery: identifiers quoted, values bound, injection stays a parameter", () => {
  const q = buildRowQuery(
    {
      schema: "public",
      table: 'me"nu',
      columns: ["name", "price"],
      keyColumn: "id",
      filters: [
        { column: "name", op: "eq", value: "'; DROP TABLE menu; --", kind: "text" },
        { column: "price", op: "lte", value: "20,000", kind: "number" },
        { column: "category", op: "in", value: ["커피", "티"], kind: "text" },
      ],
    },
    "postgres",
    100,
    true,
  );
  assert.ok(q.sql.includes('FROM "public"."me""nu"'));
  assert.ok(!q.sql.includes("DROP"));
  assert.deepEqual(q.params.slice(0, 4), ["'; DROP TABLE menu; --", 20000, "커피", "티"]);
  assert.equal(q.cursorIndex, 5);
  assert.ok(q.sql.endsWith('ORDER BY "id" ASC LIMIT 100'));
  assert.throws(() => buildRowQuery({ schema: "public", table: "menu", columns: [], keyColumn: "id", filters: [{ column: "price", op: "like" as never, value: "x" }] }));
});

test("buildCountQuery: same WHERE as the row query, no ORDER BY/LIMIT", () => {
  const c = buildCountQuery({ schema: "public", table: "menu", columns: ["name"], keyColumn: "id", filters: [{ column: "is_active", op: "eq", value: 1, kind: "number" }] });
  assert.equal(c.sql, 'SELECT count(*)::bigint AS n, count(DISTINCT "id")::bigint AS k FROM "public"."menu" WHERE "is_active" = $1');
  assert.deepEqual(c.params, [1]);
});

test("sourceConfig: requires key, body; rejects unknown filter op and key in body; defaults", () => {
  const base = { connectionId: "c1", table: "menu", titleColumn: "name", keyColumn: "id", bodyColumns: [{ column: "price", label: "가격", unit: "원" }] };
  const ok = sourceConfig(base);
  assert.equal(ok.schema, "public");
  assert.equal(ok.schedule, "daily");
  assert.equal(ok.rowLimit, 5000);
  assert.equal(ok.missingRows, "archive");
  assert.throws(() => sourceConfig({ ...base, keyColumn: "" }), /고유키/);
  assert.throws(() => sourceConfig({ ...base, bodyColumns: [] }), /본문/);
  assert.throws(() => sourceConfig({ ...base, bodyColumns: [{ column: "id", label: "번호" }] }), /고유키 컬럼은 본문/);
  assert.throws(() => sourceConfig({ ...base, filters: [{ column: "price", op: "like", value: "1" }] }), /지원하지 않는 필터/);
  assert.throws(() => sourceConfig({ ...base, filters: [{ column: "price", op: "eq", value: "" }] }), /필터 값/);
  assert.throws(() => sourceConfig({ ...base, rowLimit: 0 }), /행 상한/);
});

test("nextSyncAt: manual none, hourly +1h, daily next 03:00 KST, weekly +6 days more", () => {
  const from = Date.UTC(2026, 9, 26, 12, 0, 0) / 1000; // 21:00 KST
  assert.equal(nextSyncAt("manual", from), null);
  assert.equal(nextSyncAt("hourly", from), from + 3600);
  const daily = nextSyncAt("daily", from)!;
  assert.equal(new Date(daily * 1000).toISOString(), "2026-10-26T18:00:00.000Z"); // 10/27 03:00 KST
  assert.equal(nextSyncAt("weekly", from), daily + 6 * 86400);
});

test("단계 E: 요금제별 DB 지식 행 한도", async () => {
  const { getDbRowLimit } = await import("../lib/plans");
  assert.equal(getDbRowLimit("starter"), 0);
  assert.equal(getDbRowLimit("growth"), 10_000);
  assert.equal(getDbRowLimit("pro"), 50_000);
  assert.equal(getDbRowLimit("enterprise"), 100_000);
  assert.equal(getDbRowLimit("enterprise", 250_000), 250_000);
  assert.equal(getDbRowLimit("growth", 250_000), 10_000, "엔터프라이즈 값은 엔터프라이즈에만");
});

test("단계 E: MySQL 행 질의 — 백틱 인용·? 바인딩·기본 스키마는 접속 DB", async () => {
  const { buildMysqlRowQuery } = await import("../lib/data-connections/connectors/mysql");
  const config = { kind: "mysql" as const, host: "db.example.com", port: 3306, database: "shop", username: "r", password: "x", ssl: false };
  const q = buildMysqlRowQuery(
    {
      schema: "public",
      table: "me`nu",
      columns: ["name", "price"],
      keyColumn: "id",
      filters: [
        { column: "name", op: "eq", value: "'; DROP TABLE menu; --", kind: "text" },
        { column: "price", op: "lte", value: "20,000", kind: "number" },
      ],
    },
    config,
    100,
    true,
  );
  assert.equal(q.sql, "SELECT `id`, `name`, `price` FROM `shop`.`me``nu` WHERE CAST(`name` AS CHAR) = ? AND `price` <= ? AND `id` > ? ORDER BY `id` ASC LIMIT 100");
  assert.deepEqual(q.params, ["'; DROP TABLE menu; --", 20000]);
  assert.equal(q.count, "SELECT COUNT(*) AS n, COUNT(DISTINCT `id`) AS k FROM `shop`.`me``nu` WHERE CAST(`name` AS CHAR) = ? AND `price` <= ?");
});
