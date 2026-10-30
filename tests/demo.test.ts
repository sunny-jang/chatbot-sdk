import test from "node:test";
import assert from "node:assert/strict";
import { demoSiteUrl } from "../lib/demo/store";
import { demoBackgroundBlocked } from "../lib/demo/background-rules";
import {
  demoBackgroundImage,
  DEMO_BACKGROUND_MAX_BYTES,
} from "../lib/demo/backgrounds";
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
test("http:// homepages are flagged because HTTPS demo pages cannot frame them", () => {
  for (const url of ["http://www.ik-tech.co.kr/", " HTTP://example.com"])
    assert.equal(demoBackgroundBlocked(url), true);
  for (const url of ["https://example.com/", "", "httpx://example.com"])
    assert.equal(demoBackgroundBlocked(url), false);
});
test("demo background screenshots must be real raster images within 3MB", () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  assert.equal(demoBackgroundImage(png, "image/png"), "image/png");
  for (const [bytes, type] of [
    [new TextEncoder().encode("<svg onload=alert(1)>"), "image/svg+xml"],
    [new TextEncoder().encode("<html>"), "image/png"],
    [png, "image/jpeg"],
    [new Uint8Array(), "image/png"],
  ] as const)
    assert.throws(() => demoBackgroundImage(bytes, type));
  const big = new Uint8Array(DEMO_BACKGROUND_MAX_BYTES + 1);
  big.set(png);
  assert.throws(() => demoBackgroundImage(big, "image/png"), /3MB/);
});
