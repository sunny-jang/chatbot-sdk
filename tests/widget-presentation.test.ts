import test from "node:test";
import assert from "node:assert/strict";
import {
  widgetColor,
  widgetTitle,
  widgetLogo,
  logoMime,
} from "../lib/widget-presentation";
test("style injection and malformed widget colors are rejected", () => {
  for (const value of [
    "red;}body{display:none",
    "#fff;background:red",
    "#12345",
    "rgb(0,0,0)",
    null,
  ])
    assert.equal(widgetColor(value), null);
  for (const value of ["#abc", "#ABCDEF"])
    assert.equal(widgetColor(value), value);
});
test("plain text titles enforce length and reject markup/control characters", () => {
  for (const value of [
    "<img src=x onerror=alert(1)>",
    "a\u0000b",
    "a".repeat(101),
    "",
  ])
    assert.equal(widgetTitle(value), null);
  assert.equal(widgetTitle(" 고객 상담 "), "고객 상담");
});
test("logos permit only bounded raster data or credential-free HTTP URLs", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "https://user:pass@example.com/x",
    'data:image/png;base64,AAAA" onerror="x',
    "data:image/png;base64," + "A".repeat(2800001),
  ])
    assert.equal(widgetLogo(value), null);
  assert.equal(
    widgetLogo("data:image/png;base64,AAAA"),
    "data:image/png;base64,AAAA",
  );
  assert.equal(
    widgetLogo("https://example.com/a.png"),
    "https://example.com/a.png",
  );
});
test("uploaded MIME must be backed by supported raster signature", () => {
  assert.equal(logoMime(new TextEncoder().encode("<svg/>")), null);
  assert.equal(
    logoMime(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/png",
  );
  assert.equal(logoMime(new TextEncoder().encode("GIF89a")), "image/gif");
});
