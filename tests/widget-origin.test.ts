import { test } from "node:test";
import assert from "node:assert/strict";
import { hostKey, widgetOriginAllowed } from "../lib/widget-origin";

const own = ["app.example.test", "desk.example.test", "localhost"];

test("hostKey normalizes scheme, www and trailing paths", () => {
  assert.equal(hostKey("https://www.Cafe.co.kr/menu"), "cafe.co.kr");
  assert.equal(hostKey("cafe.co.kr"), "cafe.co.kr");
  assert.equal(hostKey("not a url"), null);
  assert.equal(hostKey(null), null);
});

test("no website → every origin allowed (legacy installs keep working)", () => {
  assert.equal(widgetOriginAllowed("https://anything.com", null, own), true);
  assert.equal(widgetOriginAllowed("https://anything.com", "", own), true);
});

test("website set → only that host (www-insensitive) and our own hosts", () => {
  const site = "https://www.cafe.co.kr";
  assert.equal(widgetOriginAllowed("https://cafe.co.kr", site, own), true);
  assert.equal(widgetOriginAllowed("http://www.cafe.co.kr", site, own), true);
  assert.equal(widgetOriginAllowed("https://desk.example.test", site, own), true);
  // 우리 자체 호스트가 localhost여도(로컬 QA) 운영 모드와 무관하게 허용
  assert.equal(widgetOriginAllowed("http://localhost:3012", site, own), true);
  assert.equal(widgetOriginAllowed("https://evil.com", site, own), false);
  assert.equal(widgetOriginAllowed("https://cafe.co.kr.evil.com", site, own), false);
});

test("missing or opaque Origin (server-to-server, same-origin GET) is not blocked", () => {
  assert.equal(widgetOriginAllowed(null, "https://cafe.co.kr", own), true);
  assert.equal(widgetOriginAllowed("null", "https://cafe.co.kr", own), true);
});
