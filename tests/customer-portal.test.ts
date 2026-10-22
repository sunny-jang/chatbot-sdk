import { test } from "node:test";
import assert from "node:assert/strict";
import {
  body,
  email,
  password,
  safeNext,
  sameOrigin,
  tokenHash,
  website,
} from "../lib/customer-portal/input";
import {
  isCustomerPortalHost,
  customerHostPath,
} from "../lib/customer-portal/host";
test("상담 전용 호스트는 설정한 정확한 호스트/포트만 일치", () => {
  assert.equal(
    isCustomerPortalHost("desk.example.com", "https://desk.example.com"),
    true,
  );
  for (const h of [
    "example.com",
    "other.example.com",
    "desk.example.com.evil.test",
    "desk.example.com:444",
  ])
    assert.equal(isCustomerPortalHost(h, "https://desk.example.com"), false);
  assert.equal(
    isCustomerPortalHost("desk.localhost:3012", "http://desk.localhost:3012"),
    true,
  );
});
test("서브도메인 루트/로그인은 고객사 경로로 연결하고 에이전시 경로는 재해석하지 않음", () => {
  assert.equal(customerHostPath("/"), "/customer");
  assert.equal(customerHostPath("/login"), "/customer/login");
  assert.equal(customerHostPath("/invite/test"), "/customer/invite/test");
  assert.equal(customerHostPath("/admin"), "/admin");
});
test("홈페이지/이메일 검증과 외부 리디렉션 차단", () => {
  assert.equal(email(" Agent@EXAMPLE.com "), "agent@example.com");
  assert.equal(website("https://example.com"), "https://example.com/");
  assert.throws(() => website("javascript:alert(1)"));
  assert.throws(() => website("https://u:p@example.com"));
  assert.equal(safeNext("https://evil.test"), "/customer");
  assert.equal(safeNext("//evil.test"), "/customer");
  assert.equal(safeNext("/customer/one/support"), "/customer/one/support");
  assert.equal(safeNext("/customer/\\evil.test"), "/customer");
});
test("비밀번호 길이와 bcrypt 바이트 상한 적용", () => {
  assert.equal(password("a".repeat(12)), "a".repeat(12));
  assert.throws(() => password("short"));
  assert.throws(() => password("가".repeat(25)));
});
test("토큰 원문 대신 결정적 SHA256 해시 저장", () => {
  assert.equal(tokenHash("token").length, 64);
  assert.notEqual(tokenHash("token"), tokenHash("other"));
});
test("Origin 누락/교차 출처 변경 거부", () => {
  assert.throws(() =>
    sameOrigin(new Request("https://desk.example.com/api/customer/x")),
  );
  assert.throws(() =>
    sameOrigin(
      new Request("https://desk.example.com/api/customer/x", {
        headers: { Origin: "https://evil.test" },
      }),
    ),
  );
  sameOrigin(
    new Request("https://desk.example.com/api/customer/x", {
      headers: { Origin: "https://desk.example.com" },
    }),
  );
});
test("JSON 본문은 객체만 허용하고 읽는 도중 크기 제한", async () => {
  assert.deepEqual(
    await body(
      new Request("http://localhost", {
        method: "POST",
        body: '{"name":"QA"}',
      }),
    ),
    { name: "QA" },
  );
  await assert.rejects(() =>
    body(new Request("http://localhost", { method: "POST", body: "[]" })),
  );
  await assert.rejects(
    () =>
      body(
        new Request("http://localhost", {
          method: "POST",
          body: "x".repeat(12001),
        }),
      ),
    { status: 413 },
  );
});
