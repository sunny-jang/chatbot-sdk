/** 실제 DB에 고유 접두사의 테스트 데이터를 생성하며 종료 시 정리합니다. 외부 상담 채널은 연결하지 않습니다. */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { hash } from "bcryptjs";
import sql from "../lib/neon";
import { initSchema } from "../lib/db";
const base = process.env.OPERATIONS_TEST_URL || "http://localhost:3001";
const fixture =
  process.env.OPERATIONS_REUSE_FIXTURE === "1"
    ? JSON.parse(readFileSync("/tmp/ideal-ai-operations-fixture.json", "utf8"))
    : null;
const suffix = randomUUID(),
  tenant = fixture?.tenant || `operations-test-${suffix}`,
  bot = fixture?.bot || `operations-bot-${suffix}`,
  other = fixture?.other || `operations-other-${suffix}`,
  token = fixture?.token || `ibt-test-${suffix}`,
  session = fixture?.session || `operations-session-${suffix}`,
  log = fixture?.log || `operations-log-${suffix}`,
  qa = fixture?.qa || `operations-qa-${suffix}`;
const email = fixture?.email || `operations-${suffix}@example.test`,
  password = fixture?.password || randomUUID();
let cookie = "";
let passed = 0;
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  publicCall = false,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(publicCall ? { "X-Bot-Token": token } : { Cookie: cookie }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
function check(condition: unknown, name: string) {
  assert.ok(condition, name);
  console.log(`PASS ${name}`);
  passed++;
}
async function login() {
  const jar = new Map<string, string>();
  const collect = (r: Response) => {
    for (const raw of r.headers.getSetCookie()) {
      const c = raw.split(";")[0];
      jar.set(c.slice(0, c.indexOf("=")), c);
    }
    cookie = [...jar.values()].join("; ");
  };
  // middleware and handler can both issue a CSRF cookie: preserve latest value, then read with the established jar.
  let csrf = await fetch(base + "/api/auth/csrf");
  collect(csrf);
  csrf = await fetch(base + "/api/auth/csrf", { headers: { Cookie: cookie } });
  const data = await csrf.json();
  collect(csrf);
  const r = await fetch(base + "/api/auth/callback/credentials", {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      "X-Auth-Return-Redirect": "1",
    },
    body: new URLSearchParams({
      csrfToken: data.csrfToken,
      email,
      password,
      callbackUrl: base,
    }),
  });
  collect(r);

  check(
    (await api("/api/auth/session")).data?.tenant_id === tenant,
    "이메일 로그인·세션 인증",
  );
}

async function main() {
  try {
    if (!fixture) {
      await initSchema();
      await sql`INSERT INTO tenants(id,name,api_key,email,password_hash) VALUES(${tenant},'기능 검증 전용',${`test-${suffix}`},${email},${await hash(password, 10)})`;
      await sql`INSERT INTO bots(id,tenant_id,name,type,public_token,support_mode,summary_enabled) VALUES(${bot},${tenant},'운영 기능 검증 봇','qa',${token},'hybrid',TRUE),(${other},${tenant},'세션 검증 봇','qa',${`other-${suffix}`},'hybrid',FALSE)`;
      await sql`INSERT INTO chat_sessions(id,tenant_id,bot_id) VALUES(${session},${tenant},${bot})`;
      await sql`INSERT INTO chat_messages(id,session_id,sender_type,content) VALUES(${randomUUID()},${session},'customer','배송 예정일을 확인하고 싶어요.'),(${randomUUID()},${session},'bot','일반 배송은 2~3일 소요됩니다.')`;
      await sql`INSERT INTO chat_logs(id,bot_id,session_id,user_message,bot_reply,qa_matched) VALUES(${log},${bot},${session},'주문별 배송 일정을 알려주세요.','등록된 답변을 찾지 못했습니다.',FALSE)`;
      await sql`INSERT INTO qa_pairs(id,bot_id,question,answer) VALUES(${qa},${bot},'배송 일정','주문번호를 알려주세요.')`;
      if (process.env.OPERATIONS_KEEP_FIXTURE === "1")
        await writeFile(
          "/tmp/ideal-ai-operations-fixture.json",
          JSON.stringify({
            tenant,
            bot,
            other,
            session,
            log,
            qa,
            token,
            email,
            password,
          }),
          { mode: 0o600 },
        );
    } else {
      await sql`DELETE FROM operation_jobs WHERE bot_id=${bot}`;
      await sql`DELETE FROM customer_requests WHERE bot_id=${bot}`;
      await sql`DELETE FROM support_handoffs WHERE bot_id=${bot}`;
      await sql`UPDATE chat_sessions SET status='bot' WHERE id=${session}`;
    }
    await login();
    const foreignTenant = tenant + "-other",
      foreignToken = `foreign-${randomUUID()}`;
    await sql`INSERT INTO tenants(id,name,api_key) VALUES(${foreignTenant},'접근 격리 검증',${randomUUID()}) ON CONFLICT(id) DO NOTHING`;
    await sql`UPDATE bots SET tenant_id=${foreignTenant},public_token=${foreignToken} WHERE id=${other}`;
    check(
      (await api(`/api/bots/${other}/operations`)).status === 404,
      "다른 고객사 관리자 접근 차단",
    );
    check(
      (await api(`/api/bots/${bot}/unanswered`)).data.items.some(
        (x: { id: string }) => x.id === log,
      ),
      "미응답 목록 조회",
    );
    let result = await api(`/api/bots/${bot}/unanswered`, "POST", {
      logId: log,
      qaId: qa,
    });
    check(result.status === 201, "기존 Q&A 연결");
    result = await api(`/api/bots/${bot}/unanswered`, "POST", {
      logId: log,
      qaId: qa,
    });
    check(result.status === 200 && result.data.qaId === qa, "중복 등록 멱등성");
    check(
      (
        await api(`/api/bots/${bot}/unanswered?status=resolved`)
      ).data.items.some((item: { id: string }) => item.id === log),
      "보완 완료 상태",
    );
    check(
      (
        await api(`/api/bots/${bot}/unanswered`, "PATCH", {
          logId: log,
          status: "excluded",
        })
      ).status === 200,
      "미응답 제외",
    );
    check(
      (
        await api(`/api/bots/${bot}/unanswered`, "PATCH", {
          logId: log,
          status: "pending",
        })
      ).status === 200,
      "미처리 복원",
    );
    check(
      (
        await api(`/api/bots/${bot}/unanswered`, "POST", {
          logId: log,
          question: "새 질문",
          answer: "새 답변",
        })
      ).status === 400,
      "키 없음 등록 실패·미처리 보존",
    );
    const settings = {
      quote: true,
      consultation: true,
      company: true,
      contact: "either",
      consentText:
        "테스트 문의 접수 목적. 이름·연락처·문의 내용을 1일 보유합니다. 동의를 거부하면 접수할 수 없습니다.",
      retentionDays: 1,
    };
    result = await api(`/api/bots/${bot}/operations`, "PATCH", {
      summaryEnabled: true,
      requests: settings,
    });
    check(result.status === 200, "요약·폼 설정 저장");
    const version = result.data.requests.consentVersion;
    await sql`UPDATE bots SET request_settings=${sql.json(result.data.requests)} WHERE id=${other}`;
    check(
      (await api(`/api/chat/${bot}/requests`, "GET", undefined, true)).data
        .quote === true,
      "공개 폼 설정 조회",
    );
    const submission = {
      kind: "quote",
      name: "검증 고객",
      email: "qa@example.test",
      message: "제품 견적을 요청합니다.",
      consent: true,
      consentVersion: version,
      idempotencyKey: randomUUID(),
      sessionId: session,
    };
    const foreignResponse = await fetch(base + `/api/chat/${other}/requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Token": foreignToken,
      },
      body: JSON.stringify({ ...submission, idempotencyKey: randomUUID() }),
    });
    check(foreignResponse.status === 400, "다른 고객사 세션 연결 차단");
    const results = await Promise.all([
      api(`/api/chat/${bot}/requests`, "POST", submission, true),
      api(`/api/chat/${bot}/requests`, "POST", submission, true),
    ]);
    check(
      results.every((r) => r.status === 201) &&
        results[0].data.receipt === results[1].data.receipt,
      "동시 신청 중복 방지",
    );
    check(
      (
        await api(
          `/api/chat/${bot}/requests`,
          "POST",
          { ...submission, message: "다른 요청" },
          true,
        )
      ).status === 409,
      "멱등성 키 본문 충돌",
    );
    check(
      (
        await api(
          `/api/chat/${bot}/requests`,
          "POST",
          { ...submission, idempotencyKey: randomUUID(), consent: false },
          true,
        )
      ).status === 400,
      "동의 누락 차단",
    );
    check(
      (await api(`/api/chat/${other}/requests`, "POST", submission, true))
        .status === 401,
      "다른 봇 토큰 차단",
    );
    const list = await api(`/api/bots/${bot}/requests`);
    check(list.data.items.length === 1, "접수 목록 조회");
    const requestId = list.data.items[0].id;
    check(
      (
        await api(`/api/bots/${bot}/requests`, "PATCH", {
          requestId,
          cookie,
          status: "in_progress",
        })
      ).status === 200,
      "접수 상태 변경",
    );
    check(
      (
        await api(`/api/bots/${bot}/requests`, "PATCH", {
          requestId,
          cookie,
          action: "note",
          note: "테스트 담당자 확인",
        })
      ).status === 200,
      "내부 메모 저장",
    );
    const detail = await api(
      `/api/bots/${bot}/requests?requestId=${requestId}`,
    );
    check(
      detail.data.notes.length === 2 &&
        detail.data.messages.some(
          (m: { sender_type: string; content: string }) =>
            m.sender_type === "customer" && m.content.includes("배송"),
        ),
      "상태 이력·원문 대화 확인",
    );
    check(
      (
        await api(`/api/bots/${bot}/web-sources`, "POST", {
          action: "preview",
          url: "http://127.0.0.1/admin",
        })
      ).status === 400,
      "URL 내부망 접근 차단",
    );
    // 키를 사용하지 않는 공개 페이지 수집과 발췌 요약을 검증합니다.
    result = await api(`/api/bots/${bot}/web-sources`, "POST", {
      action: "preview",
      url: `https://example.com/?test=${suffix}`,
    });
    check(
      result.status === 200 &&
        result.data.title === "Example Domain" &&
        result.data.content.length > 30,
      "공개 HTML 수집·미리보기",
    );
    result = await api(
      `/api/chat/${bot}/handoff`,
      "POST",
      { sessionId: session, reason: "배송 확인" },
      true,
    );
    check(result.status === 201, "상담 인계 접수");
    const { processJobs } = await import("../lib/operations/jobs");
    await processJobs();
    let summaries =
      await sql`SELECT summary,summary_status FROM support_handoffs WHERE session_id=${session}`;
    for (
      let attempt = 0;
      attempt < 15 && summaries[0]?.summary_status === "pending";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      summaries =
        await sql`SELECT summary,summary_status FROM support_handoffs WHERE session_id=${session}`;
    }
    check(
      summaries[0].summary_status === "fallback" &&
        summaries[0].summary.includes("배송"),
      "키 없음 상담 인계 발췌 저장",
    );
    if (process.env.OPERATIONS_KEEP_FIXTURE === "1") {
      await writeFile(
        "/tmp/ideal-ai-operations-fixture.json",
        JSON.stringify({
          tenant,
          bot,
          other,
          session,
          log,
          qa,
          token,
          email,
          password,
          requestId,
          cookie,
        }),
        { mode: 0o600 },
      );
      console.log(`검증용 fixture 보관: /tmp/ideal-ai-operations-fixture.json`);
    }
    console.log(`통합 검증 ${passed}개 통과`);
  } finally {
    if (process.env.OPERATIONS_KEEP_FIXTURE !== "1") {
      await sql`DELETE FROM bots WHERE tenant_id=${tenant} OR tenant_id=${tenant + "-other"}`;
      await sql`DELETE FROM chat_logs WHERE bot_id=${bot}`;
      await sql`DELETE FROM tenants WHERE id=${tenant} OR id=${tenant + "-other"}`;
    }
    await sql.end();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
