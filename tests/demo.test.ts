import test from "node:test";
import assert from "node:assert/strict";
import { demoSiteUrl } from "../lib/demo/store";
test("demo backgrounds accept public HTTP websites only", () => {
  assert.equal(
    demoSiteUrl("https://example.com/path#section"),
    "https://example.com/path",
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/site",
    "http://127.0.0.1",
    "http://localhost",
    "https://site.local",
    "http://169.254.169.254",
    "http://10.1.2.3",
    "https://user:password@example.com",
    "https://example.com:3000",
    "http://[::1]",
  ])
    assert.throws(() => demoSiteUrl(url));
});
test("demo backgrounds never frame the agency app or desk portal", () => {
  const saved = { a: process.env.AUTH_URL, d: process.env.CUSTOMER_PORTAL_ORIGIN };
  process.env.AUTH_URL = "https://app.example.com";
  process.env.CUSTOMER_PORTAL_ORIGIN = "https://desk.example.com";
  try {
    assert.throws(() => demoSiteUrl("https://app.example.com/admin"));
    assert.throws(() => demoSiteUrl("https://DESK.example.com/customer"));
    assert.equal(demoSiteUrl("https://shop.example.com/"), "https://shop.example.com/");
  } finally {
    process.env.AUTH_URL = saved.a;
    process.env.CUSTOMER_PORTAL_ORIGIN = saved.d;
  }
});
