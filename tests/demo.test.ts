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
