import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import sql from "../lib/neon";
import { api, login, agency, desk } from "./helpers/portal-http";
const results: { name: string; status: string; error?: string }[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, status: "pass" });
    console.log("PASS", name);
  } catch (e) {
    results.push({
      name,
      status: "fail",
      error: e instanceof Error ? e.message : String(e),
    });
    console.log("FAIL", name);
  }
}
async function main() {
  const db = new URL(process.env.POSTGRES_URL || "");
  if (
    !["127.0.0.1", "localhost"].includes(db.hostname) ||
    db.pathname != "/chatbot_qa"
  )
    throw Error("로컬 QA DB만 허용");
  const fixture = JSON.parse(
    await readFile("/tmp/chatbot-qa-runtime/portal-fixture.json", "utf8"),
  );
  const owner = await login(fixture.owner, agency, "credentials"),
    agent = await login(fixture.agent, desk);
  let demoId = "",
    token = "",
    secondId = "";
  const qa = randomUUID(),
    foreignQa = randomUUID();
  await sql`INSERT INTO qa_pairs(id,bot_id,question,answer) VALUES(${qa},'portal-cafe-bot','데모 테스트 질문','데모 전용 답변'),(${foreignQa},'portal-shop-bot','다른 질문','다른 답변')`;
  try {
    await check("에이전시만 데모 관리·내부 홈페이지 주소 차단", async () => {
      assert.equal((await api("/api/demos", desk, agent)).status, 403);
      const invalid = await api("/api/demos", agency, owner, "POST", {
        customerId: "qa-cafe",
        botId: "portal-cafe-bot",
        website: "http://127.0.0.1",
      });
      assert.equal(invalid.status, 400);
    });
    await check("홈페이지 데모 생성·해시 저장·공개 접근", async () => {
      const r = await api("/api/demos", agency, owner, "POST", {
        customerId: "qa-cafe",
        botId: "portal-cafe-bot",
        website: "https://example.com",
        hours: 24,
      });
      assert.equal(r.status, 201);
      demoId = r.data.id;
      token = new URL(r.data.url).pathname.split("/").pop()!;
      const [row] =
        await sql`SELECT token_hash FROM customer_demos WHERE id=${demoId}`;
      assert.notEqual(row.token_hash, token);
      const page = await api("/demo/" + token, agency);
      assert.equal(page.status, 200);
      assert.ok(page.data.includes("체험용 화면"));
      assert.ok(!page.data.includes("공간 설정"));
    });
    const endpoint = () => `/api/demo/${token}/api/chat/portal-cafe-bot`;
    const call = (path: string, method = "GET", input?: unknown) =>
      api(path, agency, "", method, input, { "X-Bot-Token": token });
    await check("실제 위젯 설정은 등록 Q&A·안전한 표시값만 제공", async () => {
      const r = await call(`/api/demo/${token}/api/widget/portal-cafe-bot`);
      assert.equal(r.status, 200);
      assert.ok(
        r.data.qaFolders.some((f: { questions: { id: string }[] }) =>
          f.questions.some((q) => q.id === qa),
        ),
      );
      assert.equal(r.data.proactive.enabled, false);
      assert.ok(!("public_token" in r.data));
    });
    const session = "demo-session-" + randomUUID(),
      requestId = randomUUID();
    await check(
      "대화는 데모 전용 저장·동일 요청 멱등·운영 미노출",
      async () => {
        const before =
          await sql`SELECT (SELECT count(*) FROM chat_sessions WHERE tenant_id='portal-agency-qa')::int AS sessions,(SELECT count(*) FROM chat_logs WHERE bot_id='portal-cafe-bot')::int AS logs`;
        const input = {
          sessionId: session,
          requestId,
          message: "데모 테스트 질문",
          qaId: qa,
        };
        const rs = await Promise.all([
          call(endpoint(), "POST", input),
          call(endpoint(), "POST", input),
        ]);
        assert.ok(rs.some((r) => r.status === 200));
        assert.ok(rs.every((r) => [200, 409].includes(r.status)));
        const retry = await call(endpoint(), "POST", input);
        assert.equal(retry.status, 200);
        assert.equal(retry.data.reply, "데모 전용 답변");
        assert.equal(
          (
            await sql`SELECT count(*)::int AS n FROM demo_turns WHERE demo_id=${demoId} AND session_id=${session}`
          )[0].n,
          1,
        );
        assert.deepEqual(
          await sql`SELECT (SELECT count(*) FROM chat_sessions WHERE tenant_id='portal-agency-qa')::int AS sessions,(SELECT count(*) FROM chat_logs WHERE bot_id='portal-cafe-bot')::int AS logs`,
          before,
        );
        const history = await call(
          endpoint() + "/handoff?sessionId=" + session,
        );
        assert.equal(history.data.messages.length, 2);
        assert.equal(
          (await call(endpoint() + "/handoff?sessionId=another-session")).data
            .messages.length,
          0,
        );
        assert.equal(
          (
            await call(endpoint(), "POST", {
              ...input,
              requestId: randomUUID(),
              qaId: foreignQa,
            })
          ).status,
          404,
        );
      },
    );
    await check("다른 데모는 같은 대화 ID로 기록 조회 불가", async () => {
      const r = await api("/api/demos", agency, owner, "POST", {
        customerId: "qa-cafe",
        botId: "portal-cafe-bot",
        website: "https://example.com",
        hours: 1,
      });
      assert.equal(r.status, 201);
      secondId = r.data.id;
      const secondToken = new URL(r.data.url).pathname.split("/").pop()!;
      const history = await api(
        `/api/demo/${secondToken}/api/chat/portal-cafe-bot/handoff?sessionId=${session}`,
        agency,
      );
      assert.equal(history.status, 200);
      assert.equal(history.data.messages.length, 0);
    });
    await check("링크 해제·만료 후 대화와 설정 차단", async () => {
      assert.equal(
        (await api("/api/demos", agency, owner, "PATCH", { id: demoId }))
          .status,
        200,
      );
      assert.equal(
        (await call(`/api/demo/${token}/api/widget/portal-cafe-bot`)).status,
        410,
      );
      assert.equal(
        (
          await call(endpoint(), "POST", {
            sessionId: session,
            message: "새 질문",
          })
        ).status,
        410,
      );
    });
  } finally {
    await sql`DELETE FROM qa_pairs WHERE id IN (${qa},${foreignQa})`;
    for (const id of [demoId, secondId].filter(Boolean)) {
      await sql`DELETE FROM access_audit_logs WHERE target_id=${id}`;
      await sql`DELETE FROM customer_demos WHERE id=${id}`;
    }
  }
  await writeFile(
    "/tmp/demo-http-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: results.filter((r) => r.status === "pass").length,
      failed: results.filter((r) => r.status === "fail").length,
    }),
  );
  if (results.some((r) => r.status === "fail")) process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
