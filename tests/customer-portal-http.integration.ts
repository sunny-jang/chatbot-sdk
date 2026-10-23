import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "../lib/neon";
import {
  api,
  login,
  localFetch,
  base,
  desk,
  agency,
} from "./helpers/portal-http";
import { tokenHash } from "../lib/customer-portal/input";
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
  const u = new URL(process.env.POSTGRES_URL || "");
  if (
    !["localhost", "127.0.0.1"].includes(u.hostname) ||
    u.pathname != "/chatbot_qa"
  )
    throw Error("전용 로컬 QA DB만 허용");
  const f = JSON.parse(
    await readFile("/tmp/chatbot-qa-runtime/portal-fixture.json", "utf8"),
  );
  await check("서브도메인 로그인은 고객사 전용 화면", async () => {
    const r = await api("/login", desk);
    assert.equal(r.status, 200);
    assert.ok(r.data.includes("상담함 로그인"));
    assert.ok(r.data.includes("에이전시 워크스페이스 로그인"));
    assert.ok(!r.data.includes("Google로 로그인"));
  });
  await check("비로그인 상담 루트는 고객사 로그인으로", async () => {
    const r = await api("/", desk);
    assert.equal(r.status, 307);
    assert.ok(r.location?.includes("/customer/login"));
  });
  const owner = await login(f.owner, agency, "credentials"),
    agent = await login(f.agent, desk),
    admin = await login(f.admin, desk),
    other = await login(f.other, desk);
  await check("에이전시 로그인은 기존 tenant 유지", async () =>
    assert.equal(
      (await api("/api/auth/session", agency, owner)).data.tenant_id,
      "portal-agency-qa",
    ),
  );
  await check("에이전시 분석은 고객사 봇의 대화 원문을 숨기고 집계만 포함", async () => {
    const ownBot = "own-bot-" + randomUUID(),
      customerLog = "log-c-" + randomUUID(),
      ownLog = "log-o-" + randomUUID();
    const [home] =
      await sql`SELECT id FROM customers WHERE tenant_id='portal-agency-qa' AND is_default=TRUE`;
    await sql`INSERT INTO bots(id,tenant_id,customer_id,name,type) VALUES(${ownBot},'portal-agency-qa',${home.id},'우리 회사 봇','qa')`;
    await sql`INSERT INTO chat_logs(id,bot_id,session_id,user_message,bot_reply,created_at) VALUES(${customerLog},'portal-cafe-bot','s-c','고객사 질문 원문','고객사 답변',EXTRACT(EPOCH FROM NOW())::BIGINT),(${ownLog},${ownBot},'s-o','우리 회사 질문 원문','우리 회사 답변',EXTRACT(EPOCH FROM NOW())::BIGINT)`;
    try {
      const r = await api("/api/analytics?days=7&botId=all", agency, owner);
      assert.equal(r.status, 200);
      const texts = JSON.stringify([r.data.conversations, r.data.refusedConversations]);
      assert.ok(!texts.includes("고객사 질문 원문"));
      assert.ok(texts.includes("우리 회사 질문 원문"));
      assert.ok(r.data.summary.messages >= 2, "aggregates still count customer bots");
      assert.ok(r.data.restricted.bots.some((b: { id: string }) => b.id === "portal-cafe-bot"));
      assert.ok(r.data.restricted.hiddenMessages >= 1);
      const single = await api("/api/analytics?days=7&botId=portal-cafe-bot", agency, owner);
      assert.equal(single.data.restricted.selected, true);
      assert.equal(single.data.conversations.length, 0);
      assert.ok(single.data.summary.messages >= 1);
      assert.equal((await api("/api/bots/portal-cafe-bot/logs", agency, owner)).status, 403);
      assert.equal((await api(`/api/bots/${ownBot}/logs`, agency, owner)).status, 200);
      const page = await api("/bots/portal-cafe-bot/logs", agency, owner);
      assert.ok(page.data.includes("고객사 전용 대화 기록"));
      assert.ok(!page.data.includes("고객사 질문 원문"));
      // The customer's own administrator still sees the text in the desk portal.
      const desk = await api("/api/customer/qa-cafe/bots/portal-cafe-bot/logs", "desk.localhost:3012", admin);
      assert.equal(desk.status, 200);
      assert.ok(JSON.stringify(desk.data).includes("고객사 질문 원문"));
    } finally {
      await sql`DELETE FROM chat_logs WHERE id IN (${customerLog},${ownLog})`;
      await sql`DELETE FROM bots WHERE id=${ownBot}`;
    }
  });
  await check("에이전시 세션은 소유자 auth_version 회수에 즉시 반응", async () => {
    assert.equal((await api("/api/customers", agency, owner)).status, 200);
    await sql`UPDATE users SET auth_version=auth_version+1 WHERE id='portal-owner'`;
    try {
      // Portal-backed routes report 403 (identity no longer usable); legacy tenant routes report 401.
      assert.ok([401, 403].includes((await api("/api/customers", agency, owner)).status));
      assert.equal((await api("/api/bots", agency, owner)).status, 401);
    } finally {
      await sql`UPDATE users SET auth_version=auth_version-1 WHERE id='portal-owner'`;
    }
    assert.equal((await api("/api/customers", agency, owner)).status, 200);
  });
  await check("desk 호스트 OAuth 처리는 고객사 공급자만 노출", async () => {
    const onDesk = (await api("/api/auth/providers", desk)).data,
      onAgency = (await api("/api/auth/providers", agency)).data;
    assert.deepEqual(Object.keys(onDesk).sort(), [
      "customer-credentials",
      "customer-google",
    ]);
    assert.ok(onAgency.google && onAgency.credentials);
    // Sign-in and callback URLs stay on the desk origin instead of being rewritten to AUTH_URL.
    assert.ok(
      onDesk["customer-google"].callbackUrl.startsWith("http://" + desk + "/api/auth/callback/"),
      onDesk["customer-google"].callbackUrl,
    );
    assert.ok(onAgency.google.callbackUrl.startsWith("http://" + agency + "/"));
    // With a valid CSRF token the agency provider must still be unknown on the desk host.
    const jar = new Map<string, string>();
    const collect = (r: { headers: Headers }) => {
      for (const raw of r.headers.getSetCookie()) {
        const c = raw.split(";")[0];
        jar.set(c.slice(0, c.indexOf("=")), c);
      }
      return [...jar.values()].join("; ");
    };
    collect(await api("/api/auth/csrf", desk));
    const csrf = await api("/api/auth/csrf", desk, [...jar.values()].join("; "));
    const cookie = collect(csrf);
    const start = async (provider: string) =>
      localFetch(base + "/api/auth/signin/" + provider, {
        method: "POST",
        redirect: "manual",
        headers: {
          Host: desk,
          Origin: "http://" + desk,
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Auth-Return-Redirect": "1",
        },
        body: new URLSearchParams({
          csrfToken: csrf.data.csrfToken,
          callbackUrl: "http://" + desk + "/customer",
        }),
      });
    const blocked = await start("google"),
      blockedBody = await blocked.text();
    assert.ok(
      !blockedBody.includes("accounts.google.com") &&
        !(blocked.headers.get("location") || "").includes("accounts.google.com"),
      blockedBody.slice(0, 200),
    );
    assert.ok(/error/i.test(blockedBody) || blocked.status >= 400, String(blocked.status));
    const allowed = await start("customer-google"),
      allowedBody = await allowed.text();
    // Without a Google client in QA the customer provider errors too, but it is recognised (no unknown-provider error page).
    assert.notEqual(allowedBody, blockedBody);
  });
  await check("고객사 로그인은 tenant/admin 권한을 발급하지 않음", async () => {
    const s = (await api("/api/auth/session", desk, agent)).data;
    assert.equal(s.customer_user_id, "portal-agent");
    assert.equal(s.tenant_id, null);
    assert.equal(s.is_admin, false);
  });
  await check("담당자는 자기 고객사 상담함으로 자동 이동", async () => {
    const r = await api("/customer", desk, agent);
    assert.ok(
      r.location?.includes("/customer/qa-cafe/support") ||
        (r.status === 200 &&
          r.data.includes("NEXT_REDIRECT") &&
          r.data.includes("/customer/qa-cafe/support")),
    );
  });
  await check("에이전시 고객사 목록은 자기 고객사만", async () => {
    const r = await api("/api/customers", agency, owner);
    assert.equal(r.status, 200);
    assert.ok(r.data.items.some((c: { id: string }) => c.id === "qa-cafe"));
    const own =
      await sql`SELECT id FROM customers WHERE tenant_id='portal-agency-qa'`;
    assert.deepEqual(
      r.data.items.map((c: { id: string }) => c.id).sort(),
      own.map((c) => c.id).sort(),
    );
  });
  await check("에이전시 상담도 실제 작성자·멱등·종료 정책 적용", async () => {
    const id = "safety-" + randomUUID();
    try {
      await sql`INSERT INTO chat_sessions(id,tenant_id,bot_id,status) VALUES(${id},'portal-agency-qa','portal-cafe-bot','waiting')`;
      await sql`INSERT INTO support_handoffs(id,session_id,bot_id,status) VALUES(${randomUUID()},${id},'portal-cafe-bot','waiting')`;
      assert.equal(
        (
          await api("/api/support/handoffs", agency, owner, "PATCH", {
            sessionId: id,
            action: "accept",
            agentName: "위조",
          })
        ).status,
        200,
      );
      const key = randomUUID();
      const input = {
        sessionId: id,
        message: "에이전시 실제 답변",
        idempotencyKey: key,
        agentName: "위조",
        sender_user_id: "portal-other",
      };
      const replies = await Promise.all([
        api("/api/support/handoffs", agency, owner, "POST", input),
        api("/api/support/handoffs", agency, owner, "POST", input),
      ]);
      assert.ok(replies.every((r) => r.status === 200));
      assert.equal(replies[0].data.id, replies[1].data.id);
      const [saved] =
        await sql`SELECT sender_user_id,sender_name FROM chat_messages WHERE id=${replies[0].data.id}`;
      assert.equal(saved.sender_user_id, "portal-owner");
      assert.notEqual(saved.sender_name, "위조");
      assert.equal(
        (
          await api("/api/support/handoffs", agency, owner, "PATCH", {
            sessionId: id,
            action: "close",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await api("/api/support/handoffs", agency, owner, "POST", {
            ...input,
            idempotencyKey: randomUUID(),
          })
        ).status,
        409,
      );
      assert.equal(
        (await sql`SELECT status FROM chat_sessions WHERE id=${id}`)[0].status,
        "closed",
      );
    } finally {
      await sql`DELETE FROM chat_sessions WHERE id=${id}`;
    }
  });
  await check(
    "위젯 위험 입력 차단·기존 저장값 방어·폴더 없는 Q&A",
    async () => {
      const [before] =
        await sql`SELECT widget_title,widget_color,logo_url FROM bots WHERE id='portal-cafe-bot'`;
      const pair = randomUUID();
      try {
        for (const input of [
          { widget_title: "<img src=x onerror=alert(1)>" },
          { widget_color: "red;}body{display:none" },
        ])
          assert.equal(
            (
              await api(
                "/api/bots/portal-cafe-bot",
                agency,
                owner,
                "PUT",
                input,
              )
            ).status,
            400,
          );
        await sql`UPDATE bots SET widget_title='<img onerror=x>',widget_color='red;}body{display:none',logo_url='javascript:alert(1)' WHERE id='portal-cafe-bot'`;
        await sql`INSERT INTO qa_pairs(id,bot_id,question,answer) VALUES(${pair},'portal-cafe-bot','폴더 없는 질문','폴더 없는 답변')`;
        const response = await api("/api/widget/portal-cafe-bot", agency);
        assert.equal(response.status, 200);
        assert.equal(response.data.logo, null);
        assert.equal(response.data.color, "#2563eb");
        assert.ok(!response.data.title.includes("<"));
        assert.ok(
          response.data.qaFolders.some((f: { questions: { id: string }[] }) =>
            f.questions.some((q) => q.id === pair),
          ),
        );
      } finally {
        await sql`DELETE FROM qa_pairs WHERE id=${pair}`;
        await sql`UPDATE bots SET widget_title=${before.widget_title},widget_color=${before.widget_color},logo_url=${before.logo_url} WHERE id='portal-cafe-bot'`;
      }
    },
  );
  await check("고객사 정보 수정은 관리자만·다른 회사 차단", async () => {
    const [before] =
      await sql`SELECT name,website FROM customers WHERE id='qa-cafe'`;
    try {
      assert.equal(
        (
          await api("/api/customer/qa-cafe/settings", desk, agent, "PATCH", {
            name: "변조",
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await api("/api/customer/qa-shop/settings", desk, admin, "PATCH", {
            name: "변조",
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await api("/api/customer/qa-cafe/settings", desk, admin, "PATCH", {
            name: "수정된 카페",
            website: "https://example.test/cafe",
          })
        ).status,
        200,
      );
      assert.equal(
        (await api("/api/customer/qa-cafe/settings", desk, admin)).data.name,
        "수정된 카페",
      );
      assert.equal(
        (
          await api("/api/customer/qa-cafe/settings", desk, admin, "PATCH", {
            status: "inactive",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await api("/api/customers/qa-cafe", agency, owner, "PATCH", {
            status: "inactive",
          })
        ).status,
        409,
      );
    } finally {
      await sql`UPDATE customers SET name=${before.name},website=${before.website} WHERE id='qa-cafe'`;
    }
  });
  await check("빈 고객사는 비활성·재활성 가능하고 변경 감사 기록", async () => {
    const r = await api("/api/customers", agency, owner, "POST", {
      name: "삭제 가능한 QA 고객사",
    });
    assert.equal(r.status, 201);
    const id = r.data.id;
    try {
      assert.equal(
        (
          await api("/api/customers/" + id, agency, owner, "PATCH", {
            status: "inactive",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await api("/api/customers/" + id, agency, owner, "PATCH", {
            status: "active",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await sql`SELECT count(*)::int AS n FROM access_audit_logs WHERE customer_id=${id} AND outcome='success'`
        )[0].n,
        3,
      );
    } finally {
      await sql`DELETE FROM access_audit_logs WHERE customer_id=${id}`;
      await sql`DELETE FROM customers WHERE id=${id}`;
    }
  });
  await check("동시 봇 생성도 에이전시 합산 플랜 한도 준수", async () => {
    const [tenant] =
      await sql`SELECT plan,enterprise_bot_limit FROM tenants WHERE id='portal-agency-qa'`;
    const [count] =
      await sql`SELECT count(*)::int AS n FROM bots WHERE tenant_id='portal-agency-qa'`;
    const name = "limit-" + randomUUID();
    try {
      await sql`UPDATE tenants SET plan='enterprise',enterprise_bot_limit=${Number(count.n) + 1} WHERE id='portal-agency-qa'`;
      const rs = await Promise.all(
        [1, 2].map(() =>
          api("/api/bots", agency, owner, "POST", {
            name,
            type: "qa",
            customer_id: "qa-cafe",
          }),
        ),
      );
      assert.deepEqual(rs.map((r) => r.status).sort(), [201, 403]);
      assert.equal(
        (
          await sql`SELECT count(*)::int AS n FROM bots WHERE tenant_id='portal-agency-qa' AND name=${name}`
        )[0].n,
        1,
      );
    } finally {
      await sql`DELETE FROM bots WHERE tenant_id='portal-agency-qa' AND name=${name}`;
      await sql`UPDATE tenants SET plan=${tenant.plan},enterprise_bot_limit=${tenant.enterprise_bot_limit} WHERE id='portal-agency-qa'`;
    }
  });
  await check("고객사 관리자 챗봇 조회·수정·지식·통계 범위", async () => {
    const base = "/api/customer/qa-cafe/bots/portal-cafe-bot";
    assert.equal((await api(base, desk, agent)).status, 404);
    assert.equal(
      (await api("/api/customer/qa-cafe/bots/portal-shop-bot", desk, admin))
        .status,
      404,
    );
    const original = (await api(base, desk, admin)).data;
    assert.equal(original.id, "portal-cafe-bot");
    assert.ok(!("api_key" in original));
    assert.ok(!("slack_bot_token" in original));
    try {
      assert.equal(
        (
          await api(base, desk, admin, "PATCH", {
            widget_title: "고객사 설정 테스트",
            tenant_id: "forged",
          })
        ).status,
        200,
      );
      assert.equal(
        (await api(base, desk, admin)).data.widget_title,
        "고객사 설정 테스트",
      );
      for (const resource of [
        "docs",
        "qa",
        "folders",
        "qa-folders",
        "web-sources",
        "analytics",
        "logs",
      ])
        assert.equal(
          (await api(base + "/" + resource, desk, admin)).status,
          200,
          resource,
        );
      assert.equal(
        (
          await api(
            "/api/customer/qa-shop/bots/portal-shop-bot/qa",
            desk,
            admin,
          )
        ).status,
        404,
      );
    } finally {
      await sql`UPDATE bots SET widget_title=${original.widget_title} WHERE id='portal-cafe-bot'`;
    }
  });
  await check("동일 파일 재업로드는 모델 키 없이도 건너뛴다", async () => {
    const id = randomUUID(),
      title = "unchanged-" + randomUUID();
    const content = "변하지 않은 합성 문서 본문";
    await sql`INSERT INTO documents(id,bot_id,title,content) VALUES(${id},'portal-cafe-bot',${title},${content})`;
    try {
      const boundary = "qa-boundary-" + randomUUID();
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${title}.txt"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
      const response = await localFetch(
        base + "/api/customer/qa-cafe/bots/portal-cafe-bot/docs/upload",
        {
          method: "POST",
          headers: {
            Host: desk,
            Origin: "http://" + desk,
            Cookie: admin,
            "Content-Type": "multipart/form-data; boundary=" + boundary,
          },
          body,
        },
      );
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.id, id);
      assert.equal(result.skipped, true);
      assert.equal(
        (
          await sql`SELECT count(*)::int AS n FROM documents WHERE bot_id='portal-cafe-bot' AND title=${title}`
        )[0].n,
        1,
      );
    } finally {
      await sql`DELETE FROM documents WHERE id=${id}`;
    }
  });
  await check(
    "고객사 미배정 기존 봇도 에이전시 URL 미리보기 저장 가능",
    async () => {
      const id = "legacy-preview-" + randomUUID();
      await sql`INSERT INTO bots(id,tenant_id,name,type) VALUES(${id},'portal-agency-qa','미배정 합성 봇','ai')`;
      try {
        const response = await api(
          `/api/bots/${id}/web-sources`,
          agency,
          owner,
          "POST",
          { action: "preview", url: "https://example.com" },
        );
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.ok(response.data.previewId);
        assert.equal(
          (
            await sql`SELECT bot_id FROM web_previews WHERE id=${response.data.previewId}`
          )[0].bot_id,
          id,
        );
      } finally {
        await sql`DELETE FROM web_previews WHERE bot_id=${id}`;
        await sql`DELETE FROM bots WHERE id=${id}`;
      }
    },
  );
  await check("지식 폴더와 Q&A 항목 ID 변조 차단", async () => {
    const base = "/api/customer/qa-cafe/bots/portal-cafe-bot";
    const folder = await api(base + "/qa-folders", desk, admin, "POST", {
      name: "QA 폴더",
    });
    assert.equal(folder.status, 201);
    const foreign = "foreign-" + randomUUID();
    try {
      await sql`INSERT INTO qa_pairs(id,bot_id,question,answer) VALUES(${foreign},'portal-shop-bot','다른 고객사 질문','다른 고객사 답변')`;
      assert.equal(
        (await api(base + "/qa/" + foreign, desk, admin, "DELETE")).status,
        404,
      );
      assert.equal(
        (
          await api(
            "/api/bots/portal-cafe-bot/qa/" + foreign,
            agency,
            owner,
            "DELETE",
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await api(
            "/api/bots/portal-cafe-bot/qa/" + foreign,
            agency,
            owner,
            "PUT",
            { answer: "변조" },
          )
        ).status,
        404,
      );
      assert.equal(
        (await sql`SELECT answer FROM qa_pairs WHERE id=${foreign}`)[0].answer,
        "다른 고객사 답변",
      );
      assert.equal(
        (
          await api(
            base + "/qa-folders/" + folder.data.id,
            desk,
            admin,
            "DELETE",
          )
        ).status,
        200,
      );
    } finally {
      await sql`DELETE FROM qa_pairs WHERE id=${foreign}`;
      await sql`DELETE FROM qa_folders WHERE id=${folder.data.id}`;
    }
  });
  await check("전용 상담함에 에이전시/결제/키 메뉴 미노출", async () => {
    const r = await api("/customer/qa-cafe/support", desk, agent);
    assert.equal(r.status, 200);
    for (const word of [
      "공간 설정",
      "플랫폼 관리",
      "초록 상점",
      "에이전시 관리로",
    ])
      assert.ok(!r.data.includes(word), word);
  });
  await check("다른 고객사 화면은 404", async () => {
    const r = await api("/customer/qa-shop/support", desk, agent);
    assert.ok(
      r.status === 404 ||
        (r.status === 200 && r.data.includes("NEXT_HTTP_ERROR_FALLBACK;404")),
    );
    assert.ok(!r.data.includes("배송 문의"));
  });
  await check("담당자의 관리/비밀값 API 직접 접근 차단", async () => {
    for (const path of [
      "/api/customers",
      "/api/admin/tenants",
      "/api/tenants/settings",
      "/api/tenant/plan",
      "/api/bots",
      "/api/bots/portal-cafe-bot",
    ])
      assert.equal((await api(path, desk, agent)).status, 403, path);
  });
  await check(
    "에이전시 호스트로 우회해도 고객사 세션은 관리 API 차단",
    async () =>
      assert.equal((await api("/api/bots", agency, agent)).status, 403),
  );
  await check("고객사 간 목록·선택 세션 격리", async () => {
    const own = await api(
      "/api/customer/qa-cafe/support?selectedSession=portal-shop-session",
      desk,
      agent,
    );
    assert.equal(own.status, 200);
    assert.ok(
      own.data.every(
        (r: { session_id: string }) => r.session_id === "portal-cafe-session",
      ),
    );
    assert.equal(
      (await api("/api/customer/qa-shop/support", desk, agent)).status,
      404,
    );
  });
  await check("다른 고객사 단일 대화 404", async () =>
    assert.equal(
      (
        await api(
          "/api/customer/qa-cafe/support?sessionId=portal-shop-session",
          desk,
          agent,
        )
      ).status,
      404,
    ),
  );
  await check("위조 Origin으로 상담 변경 차단", async () => {
    const r = await localFetch(base + "/api/customer/qa-cafe/support", {
      method: "PATCH",
      headers: {
        Host: desk,
        Cookie: agent,
        Origin: "https://evil.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "portal-cafe-session",
        action: "accept",
      }),
    });
    assert.equal(r.status, 403);
  });
  await check("두 담당자 동시 수락은 한 명만 성공", async () => {
    const r = await Promise.all([
      api("/api/customer/qa-cafe/support", desk, agent, "PATCH", {
        sessionId: "portal-cafe-session",
        action: "accept",
      }),
      api("/api/customer/qa-cafe/support", desk, admin, "PATCH", {
        sessionId: "portal-cafe-session",
        action: "accept",
      }),
    ]);
    assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
  });
  // Explicit admin handoff removes timing dependence for reply tests.
  await api("/api/customer/qa-cafe/support", desk, admin, "PATCH", {
    sessionId: "portal-cafe-session",
    action: "assign",
    assignee: "portal-agent",
  });
  await check("전송 멱등성·실제 사용자 기록·작성자 위조 무시", async () => {
    const payload = {
      sessionId: "portal-cafe-session",
      message: "토요일 예약 가능 여부를 확인해드리겠습니다.",
      idempotencyKey: randomUUID(),
      agentName: "위조",
      sender_user_id: "portal-other",
    };
    const rs = await Promise.all([
      api("/api/customer/qa-cafe/support", desk, agent, "POST", payload),
      api("/api/customer/qa-cafe/support", desk, agent, "POST", payload),
    ]);
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal(rs[0].data.id, rs[1].data.id);
    const [row] =
      await sql`SELECT sender_user_id,sender_name FROM chat_messages WHERE id=${rs[0].data.id}`;
    assert.equal(row.sender_user_id, "portal-agent");
    assert.equal(row.sender_name, "카페 상담 담당자");
  });
  await check("종료 후 답변 거부·상담 재개 없음", async () => {
    assert.equal(
      (
        await api("/api/customer/qa-cafe/support", desk, agent, "PATCH", {
          sessionId: "portal-cafe-session",
          action: "close",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api("/api/customer/qa-cafe/support", desk, agent, "POST", {
          sessionId: "portal-cafe-session",
          message: "늦은 전송",
          idempotencyKey: randomUUID(),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await sql`SELECT status FROM chat_sessions WHERE id='portal-cafe-session'`
      )[0].status,
      "closed",
    );
  });
  await check("신청 목록·상태·내부 메모 고객사 격리", async () => {
    const list = await api("/api/customer/qa-cafe/requests", desk, agent);
    assert.equal(list.status, 200);
    assert.ok(
      list.data.items.some(
        (x: { id: string }) => x.id === "portal-cafe-request",
      ),
    );
    assert.ok(
      !list.data.items.some(
        (x: { id: string }) => x.id === "portal-shop-request",
      ),
    );
    assert.equal(
      (
        await api("/api/customer/qa-cafe/requests", desk, agent, "PATCH", {
          requestId: "portal-cafe-request",
          status: "in_progress",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api("/api/customer/qa-cafe/requests", desk, agent, "PATCH", {
          requestId: "portal-shop-request",
          status: "completed",
        })
      ).status,
      404,
    );
  });
  await check("상담 담당자는 구성원 관리 불가", async () =>
    assert.equal(
      (await api("/api/customer/qa-cafe/members", desk, agent)).status,
      404,
    ),
  );
  await check("고객사 관리자는 상담사만 초대 가능", async () => {
    assert.equal(
      (
        await api("/api/customer/qa-cafe/invitations", desk, admin, "POST", {
          email: "blocked@example.test",
          role: "admin",
        })
      ).status,
      403,
    );
  });
  const invitedEmail = "portal-invited-" + randomUUID() + "@example.test";
  let inviteId = "",
    inviteToken = "";
  await check(
    "에이전시가 초대 링크 생성·원문은 DB에 저장하지 않음",
    async () => {
      const r = await api(
        "/api/customers/qa-cafe/invitations",
        agency,
        owner,
        "POST",
        { email: invitedEmail, role: "agent" },
      );
      assert.equal(r.status, 201);
      assert.ok(r.data.url.startsWith("http://desk.localhost:3012/"));
      inviteId = r.data.id;
      inviteToken = r.data.url.split("/").pop();
      assert.equal(
        (
          await sql`SELECT token_hash FROM customer_invitations WHERE id=${inviteId}`
        )[0].token_hash,
        tokenHash(inviteToken),
      );
    },
  );
  await check("메일 설정 없으면 이메일 확인 우회 없이 503", async () => {
    assert.equal(
      (await api("/api/customer/invitations/" + inviteToken, desk, "", "POST"))
        .status,
      503,
    );
    assert.equal(
      (
        await sql`SELECT count(*)::int AS n FROM customer_invite_challenges WHERE invitation_id=${inviteId}`
      )[0].n,
      0,
    );
  });
  await check(
    "이메일 확인 후 새 담당자만 생성·파트너 공간 미생성",
    async () => {
      const token = randomUUID();
      const before = Number(
        (await sql`SELECT count(*)::int AS n FROM tenants`)[0].n,
      );
      await sql`INSERT INTO customer_invite_challenges(token_hash,invitation_id,expires_at) VALUES(${tokenHash(token)},${inviteId},EXTRACT(EPOCH FROM NOW())::BIGINT+900)`;
      const r = await api("/api/customer/activate/" + token, desk, "", "POST", {
        name: "초대된 담당자",
        password: "new-customer-test-password",
        role: "owner",
        tenant_id: "another",
      });
      assert.equal(r.status, 200);
      assert.equal(
        Number((await sql`SELECT count(*)::int AS n FROM tenants`)[0].n),
        before,
      );
      const [u] = await sql`SELECT id FROM users WHERE email=${invitedEmail}`;
      assert.equal(
        (
          await sql`SELECT role FROM customer_memberships WHERE user_id=${u.id} AND customer_id='qa-cafe'`
        )[0].role,
        "agent",
      );
      assert.equal(
        (
          await api("/api/customer/activate/" + token, desk, "", "POST", {
            name: "중복",
            password: "new-customer-test-password",
          })
        ).status,
        410,
      );
    },
  );
  await check(
    "검증된 로그인 계정은 초대 이메일이 같을 때만 PATCH로 수락·멱등",
    async () => {
      const r = await api(
        "/api/customers/qa-cafe/invitations",
        agency,
        owner,
        "POST",
        { email: f.other.email, role: "agent" },
      );
      assert.equal(r.status, 201);
      const token = r.data.url.split("/").pop(),
        path = "/api/customer/invitations/" + token;
      try {
        assert.equal((await api(path, desk, "", "PATCH")).status, 401);
        assert.equal((await api(path, desk, admin, "PATCH")).status, 403);
        const noOrigin = await localFetch(base + path, {
          method: "PATCH",
          headers: { Host: desk, Cookie: other },
        });
        assert.equal(noOrigin.status, 403);
        assert.equal(
          (
            await sql`SELECT count(*)::int AS n FROM customer_memberships WHERE customer_id='qa-cafe' AND user_id='portal-other'`
          )[0].n,
          0,
        );
        const accepted = await api(path, desk, other, "PATCH");
        assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
        assert.equal(accepted.data.customerId, "qa-cafe");
        assert.equal(accepted.data.duplicate, false);
        const repeat = await api(path, desk, other, "PATCH");
        assert.equal(repeat.status, 200);
        assert.equal(repeat.data.duplicate, true);
        assert.equal(
          (
            await sql`SELECT count(*)::int AS n FROM customer_memberships WHERE customer_id='qa-cafe' AND user_id='portal-other' AND status='active' AND role='agent'`
          )[0].n,
          1,
        );
        assert.equal(
          (await api("/api/customer/qa-cafe/support", desk, other)).status,
          200,
        );
        assert.equal(
          (await api("/api/customer/invitations/" + token, desk)).status,
          405,
        );
      } finally {
        await sql`DELETE FROM customer_memberships WHERE customer_id='qa-cafe' AND user_id='portal-other'`;
        await sql`DELETE FROM access_audit_logs WHERE target_id=${r.data.id}`;
        await sql`DELETE FROM customer_invitations WHERE id=${r.data.id}`;
      }
    },
  );
  await check("고객사 권한 회수는 기존 로그인 세션에 즉시 반영", async () => {
    assert.equal(
      (
        await api("/api/customers/qa-cafe/members", agency, owner, "PATCH", {
          userId: "portal-agent",
          revoke: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (await api("/api/customer/qa-cafe/support", desk, agent)).status,
      404,
    );
    assert.equal(
      (await api("/api/customer/qa-cafe/requests", desk, agent)).status,
      404,
    );
  });
  await sql`UPDATE customer_memberships SET status='active' WHERE customer_id='qa-cafe' AND user_id='portal-agent'`;
  await check("다른 고객사 계정은 원래 고객사만 접근", async () => {
    assert.equal(
      (await api("/api/customer/qa-shop/support", desk, other)).status,
      200,
    );
    assert.equal(
      (await api("/api/customer/qa-cafe/support", desk, other)).status,
      404,
    );
  });
  await writeFile(
    "/tmp/customer-portal-http-results.json",
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
