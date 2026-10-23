import assert from "node:assert/strict";
import { test } from "node:test";
import { extractText } from "../lib/knowledge/file-text";
test("HTML uploads keep visible text only; script, style and noscript bodies are dropped", async () => {
  const html = `<html><head><title>제품</title><style>.a{color:red}</style></head><body><h1>안내</h1><script>track("secret-id")</script><noscript>JS를 켜주세요</noscript><p>영업시간 9시</p></body></html>`;
  const text = await extractText("page.html", new TextEncoder().encode(html).buffer as ArrayBuffer);
  assert.equal(text, "안내 영업시간 9시");
});
test("plain text uploads are decoded as UTF-8 and trimmed", async () => {
  const text = await extractText("memo.txt", new TextEncoder().encode("  메모 내용\n").buffer as ArrayBuffer);
  assert.equal(text, "메모 내용");
});
