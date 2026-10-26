import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressesAllowed,
  connectionHostname,
  connectionPort,
  hostAllowList,
  PRIVATE_HOST_MESSAGE,
  egressIpLabel,
} from "../lib/data-connections/host";
import { quoteIdentifier, qualifiedName, splitTableName } from "../lib/data-connections/identifiers";
import { humanizeConnectionError } from "../lib/data-connections/errors";
import { buildRowQuery } from "../lib/data-connections/connectors/postgres";
import { encrypt, decrypt } from "../lib/crypto";
import { PortalError } from "../lib/customer-portal/validation";

test("connectionHost rejects private/loopback/link-local", () => {
  const none = new Set<string>();
  for (const a of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.1.1", "::1", "fc00::1", "fe80::1"])
    assert.equal(addressesAllowed(a, [a], none), false, a);
  assert.equal(addressesAllowed("db.example.com", ["203.0.113.10", "10.0.0.5"], none), false, "mixed public+private rejected");
  assert.equal(addressesAllowed("db.example.com", [], none), false, "no address rejected");
  assert.equal(addressesAllowed("db.example.com", ["93.184.216.34"], none), true);
  assert.equal(addressesAllowed("db.example.com", ["2606:2800:220:1:248:1893:25c8:1946"], none), true);
});
test("connectionHost allow list is exact match only (QA)", () => {
  const allow = hostAllowList({ DATA_CONNECTION_ALLOW_HOSTS: "127.0.0.1, Localhost" });
  assert.equal(addressesAllowed("127.0.0.1", ["127.0.0.1"], allow), true);
  assert.equal(addressesAllowed("localhost", ["127.0.0.1"], allow), true);
  assert.equal(addressesAllowed("10.0.0.1", ["10.0.0.1"], allow), false);
  assert.equal(addressesAllowed("127.0.0.2", ["127.0.0.2"], allow), false);
  assert.equal(hostAllowList({}).size, 0);
});
test("connectionHostname normalizes and rejects urls", () => {
  assert.equal(connectionHostname(" DB.Example.com "), "db.example.com");
  assert.equal(connectionHostname("203.0.113.10"), "203.0.113.10");
  assert.equal(connectionHostname("[2001:db8::1]"), "2001:db8::1");
  for (const bad of ["", "postgres://db.example.com", "db.example.com:5432", "db example", "-bad.example", "a".repeat(260)])
    assert.throws(() => connectionHostname(bad), PortalError, bad);
});
test("connectionPort accepts 1024~65535 only", () => {
  assert.equal(connectionPort(5432), 5432);
  assert.equal(connectionPort("3306"), 3306);
  for (const bad of [80, 0, 1023, 70000, -1, "abc", "", null, 5432.5]) assert.throws(() => connectionPort(bad), PortalError, String(bad));
});
test("quoteIdentifier escapes quotes per dialect and rejects control chars", () => {
  assert.equal(quoteIdentifier("menu"), '"menu"');
  assert.equal(quoteIdentifier('we"ird'), '"we""ird"');
  assert.equal(quoteIdentifier("menu", "mysql"), "`menu`");
  assert.equal(quoteIdentifier("we`ird", "mysql"), "`we``ird`");
  assert.equal(qualifiedName("public", "menu"), '"public"."menu"');
  assert.equal(qualifiedName("shop", "menu", "mysql"), "`shop`.`menu`");
  assert.throws(() => quoteIdentifier("bad\nname"), PortalError);
  assert.throws(() => quoteIdentifier(""), PortalError);
  assert.throws(() => quoteIdentifier("x".repeat(129)), PortalError);
});
test("splitTableName handles schema-qualified names", () => {
  assert.deepEqual(splitTableName("menu"), { schema: "public", table: "menu" });
  assert.deepEqual(splitTableName("shop.menu"), { schema: "shop", table: "menu" });
  assert.throws(() => splitTableName("a.b.c"), PortalError);
  assert.throws(() => splitTableName(""), PortalError);
});
test("buildRowQuery binds filter values, quotes identifiers, compares by column kind", () => {
  const query = {
    schema: "public",
    table: 'me"nu',
    columns: ["name", "price"],
    keyColumn: "id",
    filters: [
      { column: "is_active", op: "eq" as const, value: 1 },
      { column: "category", op: "in" as const, value: ["커피", "'; DROP TABLE menu; --"] },
      { column: "price", op: "lte" as const, value: "20,000", kind: "number" as const },
      { column: "description", op: "not_null" as const },
    ],
  };
  const q = buildRowQuery(query);
  assert.match(q.sql, /FROM "public"\."me""nu"/);
  assert.match(q.sql, /"is_active" = \$1/);
  assert.match(q.sql, /"category"::text IN \(\$2,\$3\)/);
  assert.match(q.sql, /"price" <= \$4/, "number kind compares natively even when the value is a string");
  assert.match(q.sql, /"description" IS NOT NULL/);
  assert.ok(!q.sql.includes("DROP"), "values never appear in sql text");
  assert.deepEqual(q.params, [1, "커피", "'; DROP TABLE menu; --", 20000]);
  assert.equal(q.cursorIndex, null);
  assert.match(q.sql, /ORDER BY "id" ASC LIMIT 500$/);
  const paged = buildRowQuery(query, "postgres", 100, true);
  assert.equal(paged.cursorIndex, 5);
  assert.match(paged.sql, /"id" > \$5/, "keyset cursor compares on the native key type");
  assert.match(paged.sql, /LIMIT 100$/);
  const bare = buildRowQuery({ schema: "public", table: "m", columns: [], keyColumn: "id", filters: [] });
  assert.equal(bare.sql.replace(/\s+/g, " "), 'SELECT "id" FROM "public"."m" ORDER BY "id" ASC LIMIT 500');
  assert.throws(
    () => buildRowQuery({ schema: "public", table: "m", columns: [], keyColumn: "id", filters: [{ column: "a", op: "like" as never, value: "x" }] }),
    PortalError,
  );
  assert.throws(
    () => buildRowQuery({ schema: "public", table: "m", columns: [], keyColumn: "id", filters: [{ column: "a", op: "in", value: [] }] }),
    PortalError,
  );
  assert.throws(
    () => buildRowQuery({ schema: "public", table: "m", columns: [], keyColumn: "id", filters: [{ column: "a", op: "lt", value: "abc", kind: "number" }] }),
    PortalError,
  );
});
test("humanizeConnectionError maps codes to Korean guidance without leaking details", () => {
  const env = { DATA_CONNECTION_EGRESS_IPS: "203.0.113.10" };
  const secretish = "password=hunter2 host=db.internal user=admin";
  const cases: [unknown, RegExp][] = [
    [{ code: "28P01", message: secretish }, /비밀번호가 틀렸어요/],
    [{ code: "28000", message: "no pg_hba.conf entry for host, no encryption" }, /SSL이 필요한 서버/],
    [{ code: "28000", message: "no pg_hba.conf entry" }, /pg_hba.*203\.0\.113\.10/],
    [{ code: "3D000", message: secretish }, /데이터베이스 이름을 찾지 못했어요/],
    [{ code: "42501" }, /읽기 권한이 없어요/],
    [{ code: "57014" }, /20초/],
    [{ code: "ECONNREFUSED", message: secretish }, /연결을 거부했어요.*203\.0\.113\.10/],
    [{ code: "CONNECT_TIMEOUT" }, /시간 초과/],
    [{ errno: "ETIMEDOUT" }, /시간 초과/],
    [{ code: "ENOTFOUND" }, /호스트 주소를 찾지 못했어요/],
    [{ code: "ECONNRESET" }, /중간에 끊겼어요/],
    [{ message: "The server does not support SSL connections" }, /SSL 연결을 받지 않아요/],
    [new Error("boom"), /연결하지 못했어요/],
    [null, /연결하지 못했어요/],
  ];
  for (const [error, expected] of cases) {
    const msg = humanizeConnectionError(error, "postgres", env);
    assert.match(msg, expected);
    assert.ok(!msg.includes("hunter2") && !msg.includes("db.internal"), "no leak: " + msg);
  }
  assert.match(humanizeConnectionError({ code: "ER_ACCESS_DENIED_ERROR" }, "mysql", env), /비밀번호가 틀렸어요/);
  assert.match(humanizeConnectionError({ code: "ER_BAD_DB_ERROR" }, "mysql", env), /데이터베이스 이름/);
  assert.match(humanizeConnectionError({ code: "ECONNREFUSED" }, "postgres", {}), /배포 후 안내/);
  assert.equal(egressIpLabel({}), "배포 후 안내");
  assert.equal(egressIpLabel({ DATA_CONNECTION_EGRESS_IPS: "1.1.1.1, 2.2.2.2" }), "1.1.1.1, 2.2.2.2");
});
test("crypto round trip and key mismatch", () => {
  const original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "unit-key-a";
  const secret = "p@ss w0rd/한글:$pecial";
  const enc = encrypt(secret);
  assert.notEqual(enc, secret);
  assert.equal(decrypt(enc), secret);
  assert.notEqual(encrypt(secret), enc, "random iv per call");
  process.env.ENCRYPTION_KEY = "unit-key-b";
  assert.throws(() => decrypt(enc));
  process.env.ENCRYPTION_KEY = original;
});
test("PRIVATE_HOST_MESSAGE is actionable", () => {
  assert.match(PRIVATE_HOST_MESSAGE, /공개 주소/);
});
