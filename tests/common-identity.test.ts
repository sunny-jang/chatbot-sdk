import { test } from "node:test";
import assert from "node:assert/strict";
import { customerReturnPath } from "../lib/customer-portal/return-path";
import {
  customerPortalAuthConfig,
  customerPortalAuthOrigin,
} from "../lib/customer-portal/auth-host";
import {
  GOOGLE_IDENTITY_MESSAGES,
  isGoogleIdentityReason,
} from "../lib/access/google";

test("로그인 복귀 경로는 고객사 내부 경로만 허용하고 인증 화면 루프를 막음", () => {
  assert.equal(customerReturnPath("/customer/one/support?tab=waiting#x"), "/customer/one/support?tab=waiting#x");
  assert.equal(customerReturnPath("/customer"), "/customer");
  assert.equal(customerReturnPath("/customer/invite/abc"), "/customer/invite/abc");
  for (const bad of [
    undefined,
    "",
    "https://evil.test/customer",
    "//evil.test/customer",
    "/customers/x",
    "/customer/../admin",
    "/customer/\\evil.test",
    "/customer/login",
    "/customer/login?next=/customer",
    "/customer/forgot-password",
    "/customer/reset-password/t",
    "/customer/one\r\nSet-Cookie: x",
    "/customer/ one",
  ])
    assert.equal(customerReturnPath(bad), "/customer", String(bad));
});

test("desk 호스트는 설정된 정확한 Host와 같은 스킴일 때만 전용 OAuth 처리", () => {
  const env = {
    CUSTOMER_PORTAL_ORIGIN: "https://desk.example.com",
    AUTH_URL: "https://app.example.com",
  };
  const at = (host: string) =>
    new Request("http://ignored.invalid/api/auth/signin", { headers: { host } });
  assert.equal(customerPortalAuthOrigin(at("desk.example.com"), env)?.href, "https://desk.example.com/");
  assert.equal(customerPortalAuthOrigin(at("DESK.example.com"), env)?.href, "https://desk.example.com/");
  assert.equal(customerPortalAuthOrigin(at("app.example.com"), env), null);
  assert.equal(customerPortalAuthOrigin(at("desk.example.com.evil.test"), env), null);
  assert.equal(customerPortalAuthOrigin(at("desk.example.com:444"), env), null);
  assert.equal(customerPortalAuthOrigin(at("desk.example.com"), { AUTH_URL: env.AUTH_URL }), null);
  assert.equal(
    customerPortalAuthOrigin(at("desk.example.com"), { ...env, AUTH_URL: "http://app.example.com" }),
    null,
  );
  assert.equal(
    customerPortalAuthOrigin(at("desk.example.com"), { ...env, CUSTOMER_PORTAL_ORIGIN: "ftp://desk.example.com" }),
    null,
  );
  assert.equal(
    customerPortalAuthOrigin(at("desk.localhost:3012"), {
      CUSTOMER_PORTAL_ORIGIN: "http://desk.localhost:3012/",
      AUTH_URL: "http://localhost:3012",
    })?.href,
    "http://desk.localhost:3012/",
  );
});

test("desk 전용 설정은 고객사 공급자만 남기고 기본 경로를 고정", () => {
  // Google({ id: "customer-google" }) keeps the default id and stores the custom one in options.
  const provider = (id: string, options?: { id: string }) =>
    ({ id, name: id, type: "credentials", options }) as never;
  const config = customerPortalAuthConfig({
    providers: [
      provider("google"),
      provider("google", { id: "customer-google" }),
      provider("credentials"),
      provider("credentials", { id: "customer-credentials" }),
      provider("customer-google"),
      provider("credentials", { id: "dev-login" }),
      () => provider("credentials", { id: "later" }),
    ],
  });
  assert.deepEqual(
    config.providers.map((p) =>
      typeof p === "function" ? "fn" : ((p as { options?: { id: string } }).options?.id ?? p.id),
    ),
    ["customer-google", "customer-credentials", "customer-google"],
  );
  assert.equal(config.basePath, "/api/auth");
  assert.equal(config.trustHost, true);
});

test("Google 로그인 실패 사유는 알려진 코드만 안내문으로 변환", () => {
  for (const reason of Object.keys(GOOGLE_IDENTITY_MESSAGES))
    assert.equal(isGoogleIdentityReason(reason), true);
  assert.equal(isGoogleIdentityReason("constructor"), false);
  assert.equal(isGoogleIdentityReason("toString"), false);
  assert.equal(isGoogleIdentityReason("<script>"), false);
  assert.equal(isGoogleIdentityReason(undefined), false);
});
