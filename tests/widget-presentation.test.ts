import test from "node:test";
import assert from "node:assert/strict";
import {
  widgetColor,
  widgetTitle,
  widgetLogo,
  logoMime,
  widgetTheme,
  widgetTextColor,
  DEFAULT_WIDGET_THEME,
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
test("widget theme keeps only enumerated choices and in-range integers", () => {
  assert.deepEqual(
    widgetTheme({
      position: "left",
      offsetX: 0,
      offsetY: 120,
      corner: "pill",
      launcher: "text",
      launcherText: " 상담하기 ",
      launcherSize: 64,
      bubble: "outline",
      font: "pretendard",
    }),
    {
      position: "left",
      corner: "pill",
      launcher: "text",
      bubble: "outline",
      font: "pretendard",
      offsetX: 0,
      offsetY: 120,
      launcherSize: 64,
      launcherText: "상담하기",
    },
  );
  const { launcherText: _empty, ...defaults } = DEFAULT_WIDGET_THEME;
  assert.equal(_empty, "");
  assert.deepEqual(widgetTheme(DEFAULT_WIDGET_THEME), defaults);
});
test("widget theme drops out-of-range numbers, CSS strings and unknown keys", () => {
  assert.equal(
    widgetTheme({
      position: "right;}body{display:none",
      offsetX: 121,
      offsetY: -1,
      corner: "16px",
      launcher: "url(javascript:alert(1))",
      launcherSize: 47,
      bubble: "filled; background:url(//evil)",
      font: "https://evil.example/font.css",
      css: "body{display:none}",
      fontUrl: "https://evil.example/font.woff2",
    }),
    null,
  );
  assert.equal(widgetTheme({ offsetX: "24" }), null);
  assert.equal(widgetTheme({ launcherSize: 52.5 }), null);
  assert.equal(widgetTheme({ offsetX: Number.NaN }), null);
  assert.equal(widgetTheme("position:left"), null);
  assert.equal(widgetTheme(["left"]), null);
  assert.equal(widgetTheme(null), null);
  assert.deepEqual(widgetTheme({ position: "left", extra: "x" }), {
    position: "left",
  });
});
test("launcher text is short plain text", () => {
  for (const launcherText of [
    "<b>상담</b>",
    "a}body{color:red",
    "a".repeat(21),
    "줄\n바꿈",
    "   ",
    42,
  ])
    assert.equal(widgetTheme({ launcherText }), null);
  assert.deepEqual(widgetTheme({ launcherText: "가".repeat(20) }), {
    launcherText: "가".repeat(20),
  });
});
test("header text color follows background luminance", () => {
  assert.equal(widgetTextColor("#2563eb"), "#ffffff");
  assert.equal(widgetTextColor("#000"), "#ffffff");
  assert.equal(widgetTextColor("#ffffff"), "#111827");
  assert.equal(widgetTextColor("#facc15"), "#111827");
  assert.equal(widgetTextColor("red;}"), "#ffffff");
});
