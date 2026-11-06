import test from "node:test";
import assert from "node:assert/strict";
import { chunkText, groupHits, keywordScorer, queryTerms, CHUNK_TARGET_CHARS } from "../lib/knowledge/chunks";
import { isContactQuestion } from "../lib/knowledge/contact-intent";

test("짧은 문서는 조각 하나로 둡니다", () => {
  assert.deepEqual(chunkText("  배송은 평일 2일 걸립니다.  "), ["배송은 평일 2일 걸립니다."]);
  assert.deepEqual(chunkText("   \n\n "), []);
});

test("긴 문서는 문단 경계에서 자르고 조각끼리 조금 겹칩니다", () => {
  const paragraphs = Array.from({ length: 12 }, (_, i) => `${i + 1}번 항목 설명입니다. `.repeat(12).trim());
  const text = paragraphs.join("\n\n");
  const chunks = chunkText(text);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= CHUNK_TARGET_CHARS + 200, `조각 길이 ${c.length}`);
  // 모든 문단이 어느 조각엔가 들어 있습니다.
  for (const p of paragraphs) assert.ok(chunks.some((c) => c.includes(p.slice(0, 20))));
  // 이웃 조각은 앞 조각 끝부분을 공유합니다.
  const tail = chunks[0].slice(-40);
  assert.ok(chunks[1].includes(tail.slice(tail.indexOf(" ") + 1, tail.indexOf(" ") + 15)));
});

test("공백 없는 긴 글도 멈추지 않고 나눕니다", () => {
  const chunks = chunkText("가".repeat(5000));
  assert.ok(chunks.length >= 5);
  assert.ok(chunks.every((c) => c.length > 0));
});

test("같은 문서 조각은 원래 순서로 묶고 문서는 최고 점수 순으로 정렬합니다", () => {
  const texts: Record<string, string> = { "a:2": "A2", "a:0": "A0", "b:1": "B1", "c:-1": "C 전체" };
  const result = groupHits(
    [
      { docId: "b", index: 1, score: 0.7 },
      { docId: "a", index: 2, score: 0.6 },
      { docId: "c", index: -1, score: 0.5 },
      { docId: "a", index: 0, score: 0.4 },
      { docId: "x", index: 0, score: 0.9 },
    ],
    (h) => texts[`${h.docId}:${h.index}`],
    (id) => id.toUpperCase(),
  );
  assert.deepEqual(result.map((r) => [r.title, r.content, r.score]), [
    ["B", "B1", 0.7],
    ["A", "A0\n…\nA2", 0.6],
    ["C", "C 전체", 0.5],
  ]);
});

test("연락 방법을 묻는 질문에만 연락처 고정 답변을 씁니다", () => {
  for (const q of ["견적 문의드려요", "연락처 알려주세요", "전화번호가 뭐예요?", "이메일 주소 있나요", "상담 신청하고 싶어요", "견적 받고 싶습니다", "문의 방법이 궁금해요", "담당자 연결해주세요"])
    assert.equal(isContactQuestion(q), true, q);
  for (const q of ["Ideal AI 상담 챗봇 설치비는 얼마인가요?", "상담 챗봇은 어떤 기능이 있나요?", "AI 상담사가 뭐예요?", "문의가 많을 때도 응답하나요?", "메일 발송 기능도 있나요?"])
    assert.equal(isContactQuestion(q), false, q);
});

test("질문에서 찾을 낱말을 뽑고 조사를 뗀 형태도 후보로 둡니다", () => {
  assert.deepEqual(queryTerms("장은선이 누구야?"), [["장은선이", "장은선"]]);
  assert.deepEqual(queryTerms("Hybrid RAG가 뭐야"), [["hybrid"], ["rag가", "rag"]]);
  assert.deepEqual(queryTerms("누구야 알려줘"), []);
});

test("드문 낱말이 든 조각은 점수를 더 받고, 흔한 낱말은 거의 받지 않습니다", () => {
  const rows = [
    { term: "장은선", document_id: "a", chunk_index: 3 },
    ...Array.from({ length: 18 }, (_, i) => ({ term: "회사", document_id: "a", chunk_index: i })),
  ];
  const score = keywordScorer([["장은선이", "장은선"], ["회사"]], rows, 20);
  assert.ok(score("a:3") > 0.18, `드문 낱말 ${score("a:3")}`);
  assert.ok(score("a:1") < 0.01, `흔한 낱말 ${score("a:1")}`);
  assert.equal(score("b:0"), 0);
  assert.equal(keywordScorer([], rows, 20)("a:3"), 0);
});
