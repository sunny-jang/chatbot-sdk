import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

test("Slack 종료 명령: /close가 막혀도 '종료'·'상담 종료'·'!close'로 끝낼 수 있다", async () => {
  const { isCloseCommand } = await import("../lib/support");
  for (const t of ["/close", "!close", "종료", " 상담 종료 ", "상담종료", "/CLOSE"]) assert.equal(isCloseCommand(t), true, t);
  for (const t of ["종료됐나요?", "상담 종료 시간 알려주세요", "close", "곧 종료할게요"]) assert.equal(isCloseCommand(t), false, t);
});

test("Slack 서명 검증: 맞는 서명만, 5분 넘은 요청은 거부", async () => {
  const { verifySlackSignature } = await import("../lib/support");
  const secret = "test-signing-secret";
  const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = (t: string, b: string) => `v0=${createHmac("sha256", secret).update(`v0:${t}:${b}`).digest("hex")}`;
  assert.equal(verifySlackSignature(secret, body, ts, sign(ts, body)), true);
  assert.equal(verifySlackSignature(secret, body + " ", ts, sign(ts, body)), false);
  assert.equal(verifySlackSignature("other", body, ts, sign(ts, body)), false);
  const old = String(Math.floor(Date.now() / 1000) - 301);
  assert.equal(verifySlackSignature(secret, body, old, sign(old, body)), false);
  assert.equal(verifySlackSignature(secret, body, null, null), false);
});
