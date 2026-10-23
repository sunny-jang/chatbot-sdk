import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMasterHost,
  masterHostAllows,
  masterHostPath,
  masterOrigin,
} from "../lib/master-host";
import { dedicatedAuthHost } from "../lib/customer-portal/auth-host";

test("마스터 호스트는 설정한 정확한 Host만 일치", () => {
  assert.equal(isMasterHost("master.example.com", "https://master.example.com"), true);
  assert.equal(isMasterHost("MASTER.example.com", "https://master.example.com"), true);
  for (const h of ["example.com", "desk.example.com", "master.example.com.evil.test", "master.example.com:444"])
    assert.equal(isMasterHost(h, "https://master.example.com"), false);
  assert.equal(isMasterHost("master.localhost:3012", undefined), false);
  assert.equal(masterOrigin({ MASTER_ORIGIN: "https://master.example.com/x" }), "https://master.example.com");
  assert.equal(masterOrigin({}), null);
});

test("마스터 호스트는 콘솔·관리 API·인증·로그인만 허용", () => {
  assert.equal(masterHostPath("/"), "/admin");
  assert.equal(masterHostPath("/admin"), "/admin");
  for (const p of ["/admin", "/admin/tenants", "/api/admin/tenants", "/api/auth/csrf", "/login"])
    assert.equal(masterHostAllows(p), true, p);
  for (const p of ["/", "/support", "/customers", "/api/bots", "/customer/login", "/demo/x"])
    assert.equal(masterHostAllows(p), false, p);
});

test("전용 호스트 OAuth: desk는 고객사 공급자, master는 에이전시 공급자", () => {
  const env = {
    AUTH_URL: "https://app.example.com",
    CUSTOMER_PORTAL_ORIGIN: "https://desk.example.com",
    MASTER_ORIGIN: "https://master.example.com",
  };
  const at = (host: string) => new Request("http://ignored.invalid/api/auth/signin", { headers: { host } });
  assert.deepEqual(dedicatedAuthHost(at("desk.example.com"), env)?.providers, ["customer-google", "customer-credentials"]);
  assert.deepEqual(dedicatedAuthHost(at("master.example.com"), env)?.providers, ["google", "credentials"]);
  assert.equal(dedicatedAuthHost(at("master.example.com"), env)?.origin.href, "https://master.example.com/");
  assert.equal(dedicatedAuthHost(at("app.example.com"), env), null);
  assert.equal(dedicatedAuthHost(at("master.example.com"), { ...env, AUTH_URL: "http://app.example.com" }), null);
});
