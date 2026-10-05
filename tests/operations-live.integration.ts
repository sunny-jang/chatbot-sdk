/** 선택 실행: 기존 고객사의 OpenAI 키로 소량의 임베딩 API 호출 비용이 발생합니다. 외부 상담 메시지는 보내지 않습니다. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import sql from "../lib/neon";
import { summarizeSession } from "../lib/operations/summary";
const d = JSON.parse(
  readFileSync("/tmp/ideal-ai-operations-fixture.json", "utf8"),
);
const base = process.env.OPERATIONS_TEST_URL || "http://localhost:3001";
async function api(path: string, body: unknown, publicCall = false) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(publicCall ? { "X-Bot-Token": d.token } : { Cookie: d.cookie }),
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
void (async () => {
  if (process.env.OPERATIONS_LIVE_EMBEDDINGS !== "1")
    throw Error("OPERATIONS_LIVE_EMBEDDINGS=1을 지정해야 실행합니다.");
  const keys =
    await sql`SELECT openai_api_key FROM tenants WHERE id NOT LIKE 'operations-test-%' AND openai_api_key IS NOT NULL ORDER BY created_at LIMIT 1`;
  if (!keys[0]) throw Error("등록된 고객사 OpenAI 키가 없습니다.");
  const before =
    await sql`SELECT openai_api_key FROM tenants WHERE id=${d.tenant}`;
  try {
    await sql`UPDATE tenants SET openai_api_key=${keys[0].openai_api_key} WHERE id=${d.tenant}`;
    const question = `검증 ${randomUUID().slice(0, 8)} 제품의 배송 일정은?`,
      answer = "검증 제품은 결제 확인 후 영업일 기준 2~3일 내 발송됩니다.";
    const logId = randomUUID();
    await sql`INSERT INTO chat_logs(id,bot_id,session_id,user_message,bot_reply,qa_matched) VALUES(${logId},${d.bot},${d.session},${question},'미응답',FALSE)`;
    let result = await api(`/api/bots/${d.bot}/unanswered`, {
      logId,
      question,
      answer,
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    console.log("PASS 실제 임베딩 기반 Q&A 신규 등록");
    result = await api(
      `/api/chat/${d.bot}`,
      { message: question, sessionId: randomUUID() },
      true,
    );
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.reply, answer);
    console.log("PASS 등록 Q&A 실제 검색·답변");
    result = await api(`/api/bots/${d.bot}/web-sources`, {
      action: "preview",
      url: `https://example.com/?live=${randomUUID()}`,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const preview = result.data;
    result = await api(`/api/bots/${d.bot}/web-sources`, {
      action: "apply",
      previewId: preview.previewId,
      title: preview.title,
      content: preview.content,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    console.log("PASS URL 본문 실제 임베딩·문서 반영");
    const sources =
      await sql`SELECT id FROM web_sources WHERE bot_id=${d.bot} AND document_id=${result.data.documentId}`;
    result = await api(`/api/bots/${d.bot}/web-sources`, {
      action: "preview",
      url: `https://example.com/?live=${randomUUID()}`,
      sourceId: sources[0].id,
    });
    assert.equal(result.data.unchanged, true, JSON.stringify(result.data));
    console.log("PASS 변경 없는 재수집·임베딩 유지");
    const summary = await summarizeSession(d.bot, d.session);
    assert.equal(summary.status, "generated");
    assert.match(summary.text, /배송/);
    console.log("PASS 실제 AI 상담 인계 요약 생성");
  } finally {
    await sql`UPDATE tenants SET openai_api_key=${before[0]?.openai_api_key || null} WHERE id=${d.tenant}`;
    await sql.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
