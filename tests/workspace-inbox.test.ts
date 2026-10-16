import { test } from "node:test";
import assert from "node:assert/strict";
import { filterInbox, draftAfterSend } from "../lib/workspace-inbox";
const row = (id: string, status: string, requested_at: number) => ({
  id,
  status,
  requested_at,
  customer_name: null,
  bot_name: "홈페이지 AI",
  last_message: null,
});
test("대기 상담을 먼저, 같은 상태에서는 오래 기다린 고객을 먼저 정렬", () => {
  const items = [
    row("closed", "closed", 1),
    row("later", "waiting", 30),
    row("active", "active", 2),
    row("earlier", "waiting", 10),
  ];
  assert.deepEqual(
    filterInbox(items, "", "").map((i) => i.id),
    ["earlier", "later", "active", "closed"],
  );
  assert.equal(items[0].id, "closed");
});
test("상태와 검색어를 함께 적용하고 검색 대소문자와 빈 고객명을 처리", () => {
  const items = [
    row("a", "waiting", 10),
    {
      ...row("b", "active", 20),
      customer_name: "홍길동",
      last_message: "견적이 필요해요",
    },
  ];
  assert.deepEqual(
    filterInbox(items, "waiting", " ai ").map((i) => i.id),
    ["a"],
  );
  assert.deepEqual(
    filterInbox(items, "", "견적").map((i) => i.id),
    ["b"],
  );
  assert.equal(filterInbox(items, "waiting", "홍길동").length, 0);
});
test("전송 성공 시 해당 초안만 비우고 전송 중 새로 작성한 답변은 유지", () => {
  assert.equal(draftAfterSend("이전 답변", "이전 답변"), "");
  assert.equal(draftAfterSend("추가 답변", "이전 답변"), "추가 답변");
  assert.equal(draftAfterSend(undefined, "이전 답변"), "");
});
