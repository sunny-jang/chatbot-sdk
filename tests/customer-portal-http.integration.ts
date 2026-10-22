import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "../lib/neon";
import { request } from "node:http";
async function localFetch(url: string, init: RequestInit = {}) {
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      url,
      { method: init.method, headers: init.headers as Record<string, string> },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            for (const item of Array.isArray(value)
              ? value
              : value === undefined
                ? []
                : [value])
              headers.append(key, item);
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    req.end(init.body == null ? undefined : String(init.body));
  });
}
import { tokenHash } from "../lib/customer-portal/input";
const base = "http://127.0.0.1:3012",
  desk = "desk.localhost:3012",
  agency = "localhost:3012";
type Login = { email: string; password: string };
const results: { name: string; status: string; error?: string }[] = [];
async function api(
  path: string,
  host: string,
  cookie = "",
  method = "GET",
  body?: unknown,
) {
  const r = await localFetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      Host: host,
      Origin: "http://" + host,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return {
    status: r.status,
    data,
    location: r.headers.get("location"),
    headers: r.headers,
  };
}
async function login(
  account: Login,
  host: string,
  provider = "customer-credentials",
) {
  let cookie = "";
  const jar = new Map<string, string>();
  const collect = (r: { headers: Headers }) => {
    for (const raw of r.headers.getSetCookie()) {
      const c = raw.split(";")[0];
      jar.set(c.slice(0, c.indexOf("=")), c);
    }
    cookie = [...jar.values()].join("; ");
  };
  collect(await api("/api/auth/csrf", host));
  const csrf = await api("/api/auth/csrf", host, cookie);
  collect(csrf);
  const r = await localFetch(base + "/api/auth/callback/" + provider, {
    method: "POST",
    redirect: "manual",
    headers: {
      Host: host,
      Origin: "http://" + host,
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    body: new URLSearchParams({
      csrfToken: csrf.data.csrfToken,
      ...account,
      callbackUrl: "http://" + host + "/customer",
    }),
  });
  collect(r);
  return cookie;
}
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
    assert.ok(r.data.includes("상담함으로 로그인"));
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
    const own = await sql`SELECT id FROM customers WHERE tenant_id='portal-agency-qa'`;
    assert.deepEqual(r.data.items.map((c: {id: string}) => c.id).sort(), own.map(c => c.id).sort());
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
