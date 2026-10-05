import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { publicAddress, normalizeWebUrl } from "../lib/operations/web-fetch";
import { extractPage } from "../lib/operations/extract";
import { validateRequest } from "../lib/operations/request-validation";
import { defaultRequestSettings } from "../lib/operations/settings";
const settings = {
  ...defaultRequestSettings,
  quote: true,
  consultation: true,
  consentText: "수집 목적: 견적 상담. 보유: 90일.",
  consentVersion: "v1",
};
const input = {
  kind: "quote",
  name: "테스트 고객",
  email: "customer@example.com",
  message: "제품 견적을 요청합니다.",
  consent: true,
  consentVersion: "v1",
  idempotencyKey: "test-1",
};
for (const address of [
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.1.1",
  "100.64.1.1",
  "0.0.0.0",
  "224.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "fc00::1",
  "fe80::1",
  "2002:7f00:1::",
  "64:ff9b::7f00:1",
]) {
  test(`내부 주소 차단: ${address}`, () =>
    assert.equal(publicAddress(address), false));
}
for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
  test(`공개 주소 허용: ${address}`, () =>
    assert.equal(publicAddress(address), true));
}
test("URL fragment 제거와 의미 있는 쿼리 보존", () =>
  assert.equal(
    normalizeWebUrl("https://example.com/faq?lang=ko#top").toString(),
    "https://example.com/faq?lang=ko",
  ));
for (const url of [
  "file:///etc/passwd",
  "ftp://example.com",
  "https://user:pass@example.com",
  "http://example.com:3000",
]) {
  test(`URL 형식 차단: ${url}`, () =>
    assert.throws(() => normalizeWebUrl(url)));
}
test("웹 본문에서 스크립트·메뉴·푸터 제거", () => {
  const result = extractPage(
    "<html><title>배송 FAQ</title><nav>메뉴 비밀</nav><main><h1>배송 정책</h1><p>상품 배송은 주문 접수 후 영업일 기준 이틀에서 사흘 정도 소요됩니다.</p><script>alert('비밀')</script></main><footer>푸터 비밀</footer></html>",
  );
  assert.equal(result.title, "배송 FAQ");
  assert.match(result.content, /영업일/);
  assert.doesNotMatch(result.content, /비밀|alert/);
});
test("빈·과도한 본문 거절", () => {
  assert.throws(() =>
    extractPage("<body><script>window.boot()</script></body>"),
  );
  assert.throws(() => extractPage(`<main>${"가".repeat(50001)}</main>`));
});
test("신청 정상 검증과 결정적 멱등성 해시", () => {
  const a = validateRequest(input, settings),
    b = validateRequest({ ...input, name: " 테스트 고객 " }, settings);
  assert.equal(a.hash, b.hash);
  assert.equal(a.kind, "quote");
});
test("신청 내용 변경은 다른 해시", () =>
  assert.notEqual(
    validateRequest(input, settings).hash,
    validateRequest({ ...input, message: "상담 요청" }, settings).hash,
  ));
for (const override of [
  { email: "" },
  { email: "wrong" },
  { email: "", phone: "abc" },
  { consent: false },
  { consentVersion: "stale" },
  { name: "" },
  { message: "" },
  { kind: "other" },
]) {
  test(`잘못된 신청 거절: ${JSON.stringify(override)}`, () =>
    assert.throws(() => validateRequest({ ...input, ...override }, settings)));
}
test("비활성 폼 차단", () =>
  assert.throws(() => validateRequest(input, { ...settings, quote: false })));
test("이메일 필수와 전화 필수 검증", () => {
  assert.throws(() =>
    validateRequest(
      { ...input, email: "", phone: "010-1234-5678" },
      { ...settings, contact: "email" },
    ),
  );
  assert.throws(() =>
    validateRequest(input, { ...settings, contact: "phone" }),
  );
  assert.doesNotThrow(() =>
    validateRequest(
      { ...input, email: "", phone: "010-1234-5678" },
      { ...settings, contact: "phone" },
    ),
  );
});
test("회사명 표시 비활성 시 미저장", () =>
  assert.equal(
    validateRequest(
      { ...input, company: "비저장" },
      { ...settings, company: false },
    ).company,
    "",
  ));

import { jsonBody } from "../lib/operations/input";
test("한글 50,000자 URL 본문 요청 허용", async () => {
  const content = "가".repeat(50000);
  const body = await jsonBody(
    new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  );
  assert.equal(body.content, content);
});
test("배열·null·잘못된 JSON 요청 거절", async () => {
  for (const body of ["null", "[]", "{"])
    await assert.rejects(() =>
      jsonBody(new Request("http://localhost", { method: "POST", body })),
    );
});
test("헤더가 없어도 과도한 요청 본문 거절", async () => {
  await assert.rejects(() =>
    jsonBody(
      new Request("http://localhost", {
        method: "POST",
        body: "a".repeat(400001),
      }),
    ),
  );
});

const widgetSource = readFileSync(new URL("../public/chatbot-widget.js", import.meta.url), "utf8");
const quoteDetector = widgetSource.slice(widgetSource.indexOf("  function wantsQuote"), widgetSource.indexOf("  // Remove any pre-existing"));
test("견적 의사를 판별하고 거절·일반 가격 질문에는 열지 않는다", () => {
  const wantsQuote = runInNewContext(`${quoteDetector}; wantsQuote`);
  for (const value of ["견적 받고 싶어요", "견적받고싶어요", "견적 요청합니다", "홈페이지 제작 견적을 받아볼 수 있을까요?", "견적서 보내주세요", "견적이 필요해요", "견적 받을 수 있나요?"]) assert.equal(wantsQuote(value), true, value);
  for (const value of ["가격이 얼마예요?", "견적이란 무슨 뜻인가요?", "견적은 필요 없어요", "견적 받고 싶지 않아요", "견적 요청 취소할게요", "견적 안 받을게요", "견적 신청은 하지 마세요", "안녕하세요"]) assert.equal(wantsQuote(value), false, value);
});
test("활성화된 견적 폼만 고객 메시지로 열고 작성 중인 폼은 유지한다", async () => {
  const offer = widgetSource.slice(widgetSource.indexOf("    async function offerQuoteFromMessage"), widgetSource.indexOf("    function focusComposer"));
  for (const [enabled, existing, expected] of [[true, false, 1], [false, false, 0], [true, true, 0]]) {
    const calls: unknown[][] = [];
    const handler = runInNewContext(`${quoteDetector}
${offer}; offerQuoteFromMessage`, {
      requestSettingsReady: Promise.resolve(), requestSettings: { quote: enabled },
      panel: { querySelector: () => existing }, openRequestForm: (...args: unknown[]) => calls.push(args),
    });
    await handler("견적 받고 싶어요");
    assert.equal(calls.length, expected);
    if (expected) assert.equal(calls[0][2], "견적 받고 싶어요");
  }
});
test("첫 화면 설정 로딩은 견적 폼이나 견적 버튼을 표시하지 않는다", async () => {
  const load = widgetSource.slice(widgetSource.indexOf("    async function loadRequestSettings"), widgetSource.indexOf("    function openRequestForm"));
  const bar = { style: { display: "none" }, childElementCount: 0, replaceChildren() {}, appendChild() { throw Error("견적 버튼이 첫 화면에 추가됨"); } };
  const handler = runInNewContext(`${load}; loadRequestSettings`, {
    endpoint: "", botId: "test", botToken: "test", requestSettings: null, requestBar: bar,
    fetch: async () => ({ ok: true, json: async () => ({ quote: true, consultation: false }) }),
    openRequestForm: () => { throw Error("첫 화면에서 폼이 열림"); },
  });
  await handler();
  assert.equal(bar.style.display, "none");
});
