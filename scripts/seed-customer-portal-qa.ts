/** Disposable local QA only; never point this at a shared database. */
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import sql from "../lib/neon";
async function main() {
  const u = new URL(process.env.POSTGRES_URL || "");
  if (
    !["localhost", "127.0.0.1"].includes(u.hostname) ||
    u.pathname != "/chatbot_qa"
  )
    throw Error("전용 로컬 QA DB만 허용");
  const ownerPassword = randomUUID(),
    agentPassword = randomUUID(),
    adminPassword = randomUUID(),
    otherPassword = randomUUID(),
    tenant = "portal-agency-qa";
  await sql.begin(async (tx) => {
    await tx`INSERT INTO tenants(id,name,email,password_hash,api_key,plan) VALUES(${tenant},'QA 웹에이전시','portal-owner@example.test',${await hash(ownerPassword, 10)},'portal-agency-local-key','growth') ON CONFLICT(id) DO UPDATE SET password_hash=EXCLUDED.password_hash`;
    await tx`INSERT INTO users(id,legacy_tenant_id,name,email,password_hash,email_verified_at) VALUES('portal-owner',${tenant},'에이전시 운영자','portal-owner@example.test',${await hash(ownerPassword, 10)},EXTRACT(EPOCH FROM NOW())::BIGINT) ON CONFLICT(id) DO UPDATE SET password_hash=EXCLUDED.password_hash,status='active'`;
    await tx`INSERT INTO partner_memberships(tenant_id,user_id) VALUES(${tenant},'portal-owner') ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO customers(id,tenant_id,name,website) VALUES('qa-cafe',${tenant},'달빛 카페','https://cafe.example.test'),('qa-shop',${tenant},'초록 상점','https://shop.example.test') ON CONFLICT DO NOTHING`;
    for (const row of [
      {
        id: "portal-agent",
        name: "카페 상담 담당자",
        email: "cafe-agent@example.test",
        password: agentPassword,
      },
      {
        id: "portal-admin",
        name: "카페 사장님",
        email: "cafe-owner@example.test",
        password: adminPassword,
      },
      {
        id: "portal-other",
        name: "상점 담당자",
        email: "shop-agent@example.test",
        password: otherPassword,
      },
    ])
      await tx`INSERT INTO users(id,name,email,password_hash,email_verified_at) VALUES(${row.id},${row.name},${row.email},${await hash(row.password, 10)},EXTRACT(EPOCH FROM NOW())::BIGINT) ON CONFLICT(id) DO UPDATE SET password_hash=EXCLUDED.password_hash,status='active'`;
    await tx`INSERT INTO customer_memberships(customer_id,user_id,role) VALUES('qa-cafe','portal-agent','agent'),('qa-cafe','portal-admin','admin'),('qa-shop','portal-other','agent') ON CONFLICT(customer_id,user_id) DO UPDATE SET status='active',role=EXCLUDED.role`;
    await tx`INSERT INTO bots(id,tenant_id,customer_id,name,type,public_token,support_mode) VALUES('portal-cafe-bot',${tenant},'qa-cafe','달빛 카페 안내','qa','portal-cafe-local-token','hybrid'),('portal-shop-bot',${tenant},'qa-shop','초록 상점 안내','qa','portal-shop-local-token','hybrid') ON CONFLICT DO NOTHING`;
    for (const [id, bot, name, reason, message] of [
      [
        "portal-cafe-session",
        "portal-cafe-bot",
        "방문 고객",
        "단체 예약 문의",
        "이번 주 토요일에 10명 예약이 가능할까요?",
      ],
      [
        "portal-shop-session",
        "portal-shop-bot",
        "상점 방문 고객",
        "배송 문의",
        "배송 일정을 알고 싶어요.",
      ],
    ]) {
      await tx`INSERT INTO chat_sessions(id,tenant_id,bot_id,status,customer_name) VALUES(${id},${tenant},${bot},'waiting',${name}) ON CONFLICT(id) DO UPDATE SET status='waiting',assigned_agent_user_id=NULL,assigned_agent_name=NULL,closed_at=NULL`;
      await tx`INSERT INTO support_handoffs(id,session_id,bot_id,status,reason,summary,summary_status) VALUES(${id + "-handoff"},${id},${bot},'waiting',${reason},${message},'fallback') ON CONFLICT(session_id) DO UPDATE SET status='waiting',closed_at=NULL`;
      await tx`DELETE FROM chat_messages WHERE session_id=${id}`;
      await tx`INSERT INTO chat_messages(id,session_id,sender_type,content) VALUES(${randomUUID()},${id},'customer',${message}),(${randomUUID()},${id},'bot','담당자가 자세한 내용을 확인해드릴게요.')`;
    }
    await tx`INSERT INTO customer_requests(id,receipt,bot_id,tenant_id,kind,name,email,message,consent_text,consent_version,retention_days,idempotency_key,payload_hash) VALUES('portal-cafe-request','QA-CAFE-001','portal-cafe-bot',${tenant},'consultation','김방문','visitor@example.test','토요일 단체 예약 가능 여부를 확인하고 싶습니다.','QA 안내','v1',30,'portal-cafe-request','qa'),('portal-shop-request','QA-SHOP-001','portal-shop-bot',${tenant},'quote','이방문','shop-visitor@example.test','상품 견적을 받고 싶습니다.','QA 안내','v1',30,'portal-shop-request','qa') ON CONFLICT(id) DO UPDATE SET status='new',created_at=EXTRACT(EPOCH FROM NOW())::BIGINT`;
  });
  await writeFile(
    "/tmp/chatbot-qa-runtime/portal-fixture.json",
    JSON.stringify({
      owner: { email: "portal-owner@example.test", password: ownerPassword },
      agent: { email: "cafe-agent@example.test", password: agentPassword },
      admin: { email: "cafe-owner@example.test", password: adminPassword },
      other: { email: "shop-agent@example.test", password: otherPassword },
    }),
    { mode: 0o600 },
  );
  console.log(
    "로컬 QA 에이전시·고객사 2개·담당자 계정·상담/신청 fixture 준비 완료. 자격 증명은 /tmp의 비공개 파일에 보관.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
