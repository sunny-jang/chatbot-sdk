import {
  uploadCustomerDocument,
  unchangedCustomerDocument,
  importCustomerQa,
  customerBot,
  configureCustomerBot,
  mutateKnowledge,
  listKnowledge,
} from "../lib/customer-portal/bots";
import { updateCustomer, recordDenied } from "../lib/customer-portal/customers";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compare } from "bcryptjs";
import sql from "../lib/neon";
import type { AccessDatabase } from "../lib/access/schema";
import { createAccessSchema } from "../lib/access/schema";
import {
  readCustomerInbox,
  readCustomerMessages,
  mutateCustomerSupport,
} from "../lib/customer-portal/support";
import {
  createInvitation,
  activateInvitation,
  updateMember,
} from "../lib/customer-portal/management";
import { mutateCustomerRequest } from "../lib/customer-portal/requests";
import { resetCustomerPassword } from "../lib/customer-portal/password-reset";
import { tokenHash } from "../lib/customer-portal/input";
async function main() {
  if (process.env.PORTAL_DB_CHECK !== "1") {
    console.log("미실행: PORTAL_DB_CHECK=1 필요");
    return;
  }
  const url = new URL(process.env.POSTGRES_URL || "");
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname != "/chatbot_qa"
  )
    throw Error("전용 로컬 QA DB만 허용");
  const rollback = new Error("verification rollback");
  let checks = 0;
  try {
    await sql.begin(async (tx) => {
      const db = tx as unknown as AccessDatabase;
      await createAccessSchema(db);
      const suffix = randomUUID(),
        tenant = "portal-" + suffix,
        foreign = "portal-other-" + suffix,
        customer = "customer-" + suffix,
        other = "customer-other-" + suffix,
        bot = "bot-" + suffix,
        otherBot = "bot-other-" + suffix,
        owner = "owner-" + suffix,
        agent = "agent-" + suffix,
        second = "second-" + suffix,
        admin = "admin-" + suffix,
        session = "session-" + suffix,
        otherSession = "session-other-" + suffix;
      await tx`INSERT INTO tenants(id,name,api_key) VALUES(${tenant},'테스트 에이전시',${randomUUID()}),(${foreign},'다른 에이전시',${randomUUID()})`;
      await tx`INSERT INTO users(id,name,email) VALUES(${owner},'에이전시 담당자',${owner + "@example.test"}),(${agent},'담당자 A',${agent + "@example.test"}),(${second},'담당자 B',${second + "@example.test"}),(${admin},'고객사 관리자',${admin + "@example.test"})`;
      await tx`INSERT INTO partner_memberships(tenant_id,user_id) VALUES(${tenant},${owner})`;
      await tx`INSERT INTO customers(id,tenant_id,name) VALUES(${customer},${tenant},'카페 A'),(${other},${tenant},'쇼핑몰 B')`;
      await tx`INSERT INTO customer_memberships(customer_id,user_id,role) VALUES(${customer},${agent},'agent'),(${customer},${second},'agent'),(${customer},${admin},'admin')`;
      await tx`INSERT INTO bots(id,tenant_id,customer_id,name,type,public_token) VALUES(${bot},${tenant},${customer},'A 봇','qa',${randomUUID()}),(${otherBot},${tenant},${other},'B 봇','qa',${randomUUID()})`;
      await tx`INSERT INTO chat_sessions(id,tenant_id,bot_id,status) VALUES(${session},${tenant},${bot},'waiting'),(${otherSession},${tenant},${otherBot},'waiting')`;
      await tx`INSERT INTO support_handoffs(id,session_id,bot_id,status) VALUES(${randomUUID()},${session},${bot},'waiting'),(${randomUUID()},${otherSession},${otherBot},'waiting')`;
      const a = { id: agent, name: "담당자 A" },
        b = { id: second, name: "담당자 B" };
      assert.equal(
        (await readCustomerInbox(agent, customer, "", "", "", db)).length,
        1,
      );
      checks++;
      assert.equal(
        (await readCustomerInbox(agent, other, "", "", otherSession, db))
          .length,
        0,
      );
      checks++;
      await assert.rejects(
        () => readCustomerMessages(agent, customer, otherSession, db),
        { status: 404 },
      );
      checks++;
      await assert.rejects(
        () =>
          mutateCustomerSupport(db, a, customer, {
            sessionId: session,
            action: "message",
            message: "먼저 수락",
            idempotencyKey: "early",
          }),
        { status: 409 },
      );
      checks++;
      await mutateCustomerSupport(db, a, customer, {
        sessionId: session,
        action: "accept",
        agentName: "위조 이름",
      });
      await assert.rejects(
        () =>
          mutateCustomerSupport(db, b, customer, {
            sessionId: session,
            action: "accept",
          }),
        { status: 409 },
      );
      checks++;
      const first = await mutateCustomerSupport(db, a, customer, {
        sessionId: session,
        action: "message",
        message: "고객님 안내드립니다.",
        idempotencyKey: "one",
        sender_user_id: second,
      });
      const again = await mutateCustomerSupport(db, a, customer, {
        sessionId: session,
        action: "message",
        message: "고객님 안내드립니다.",
        idempotencyKey: "one",
      });
      assert.equal(
        "message" in first && first.message?.id,
        "message" in again && again.message?.id,
      );
      assert.equal(
        (
          await tx`SELECT sender_user_id FROM chat_messages WHERE id=${"message" in first ? String(first.message?.id) : ""}`
        )[0].sender_user_id,
        agent,
      );
      checks++;
      await assert.rejects(
        () =>
          mutateCustomerSupport(db, a, customer, {
            sessionId: session,
            action: "message",
            message: "다른 내용",
            idempotencyKey: "one",
          }),
        { status: 409 },
      );
      checks++;
      await assert.rejects(
        () =>
          mutateCustomerSupport(db, b, customer, {
            sessionId: session,
            action: "assign",
            assignee: second,
          }),
        { status: 403 },
      );
      checks++;
      await mutateCustomerSupport(
        db,
        { id: admin, name: "고객사 관리자" },
        customer,
        { sessionId: session, action: "assign", assignee: second },
      );
      await assert.rejects(
        () =>
          mutateCustomerSupport(db, a, customer, {
            sessionId: session,
            action: "close",
          }),
        { status: 409 },
      );
      checks++;
      await mutateCustomerSupport(db, b, customer, {
        sessionId: session,
        action: "close",
      });
      await assert.rejects(
        () =>
          mutateCustomerSupport(db, b, customer, {
            sessionId: session,
            action: "message",
            message: "늦은 전송",
            idempotencyKey: "late",
          }),
        { status: 409 },
      );
      assert.equal(
        (await tx`SELECT status FROM chat_sessions WHERE id=${session}`)[0]
          .status,
        "closed",
      );
      checks++;
      await assert.rejects(
        () =>
          createInvitation(db, admin, customer, {
            email: "evil@example.test",
            role: "admin",
          }),
        { status: 403 },
      );
      checks++;
      const invite = await createInvitation(db, owner, customer, {
          email: "new-" + suffix + "@example.test",
          role: "agent",
        }),
        challenge = "challenge-" + suffix;
      assert.equal(
        (
          await tx`SELECT token_hash FROM customer_invitations WHERE id=${invite.id}`
        )[0].token_hash,
        tokenHash(invite.token),
      );
      checks++;
      await tx`INSERT INTO customer_invite_challenges(token_hash,invitation_id,expires_at) VALUES(${tokenHash(challenge)},${invite.id},EXTRACT(EPOCH FROM NOW())::BIGINT+900)`;
      const tenantsBefore = Number(
        (await tx`SELECT count(*)::int AS n FROM tenants`)[0].n,
      );
      await activateInvitation(
        db,
        challenge,
        { name: "새 담당자", password: "valid-test-password" },
        null,
      );
      assert.equal(
        Number((await tx`SELECT count(*)::int AS n FROM tenants`)[0].n),
        tenantsBefore,
      );
      checks++;
      await assert.rejects(
        () =>
          activateInvitation(
            db,
            challenge,
            { name: "중복", password: "other-test-password" },
            null,
          ),
        { status: 410 },
      );
      checks++;
      const user = (
        await tx`SELECT id,password_hash FROM users WHERE email=${"new-" + suffix + "@example.test"}`
      )[0];
      assert.equal(
        await compare("valid-test-password", String(user.password_hash)),
        true,
      );
      checks++;
      const old = await createInvitation(db, owner, customer, {
        email: "reinvite-" + suffix + "@example.test",
        role: "agent",
      });
      await createInvitation(db, owner, customer, {
        email: "reinvite-" + suffix + "@example.test",
        role: "agent",
      });
      assert.equal(
        (
          await tx`SELECT status FROM customer_invitations WHERE id=${old.id}`
        )[0].status,
        "revoked",
      );
      checks++;
      const existingInvite = await createInvitation(db, owner, customer, {
          email: admin + "@example.test",
          role: "agent",
        }),
        existingChallenge = "existing-" + suffix;
      await tx`INSERT INTO customer_invite_challenges(token_hash,invitation_id,expires_at) VALUES(${tokenHash(existingChallenge)},${existingInvite.id},EXTRACT(EPOCH FROM NOW())::BIGINT+900)`;
      await assert.rejects(
        () =>
          activateInvitation(
            db,
            existingChallenge,
            { password: "overwrite-password" },
            agent,
          ),
        { status: 401 },
      );
      checks++;
      const request = "request-" + suffix;
      await tx`INSERT INTO customer_requests(id,receipt,bot_id,tenant_id,kind,name,email,message,consent_text,consent_version,retention_days,idempotency_key,payload_hash) VALUES(${request},${randomUUID()},${bot},${tenant},'quote','테스트 고객','qa@example.test','견적 확인','테스트','v1',1,${randomUUID()},'hash')`;
      await mutateCustomerRequest(db, agent, customer, {
        requestId: request,
        status: "in_progress",
      });
      assert.equal(
        (await tx`SELECT status FROM customer_requests WHERE id=${request}`)[0]
          .status,
        "in_progress",
      );
      checks++;
      await assert.rejects(
        () =>
          mutateCustomerRequest(db, owner, other, {
            requestId: request,
            status: "completed",
          }),
        { status: 404 },
      );
      checks++;
      await updateMember(db, owner, customer, { userId: agent, revoke: true });
      assert.equal(
        (await readCustomerInbox(agent, customer, "", "", "", db)).length,
        0,
      );
      await assert.rejects(
        () =>
          mutateCustomerSupport(db, a, customer, {
            sessionId: session,
            action: "accept",
          }),
        { status: 403 },
      );
      checks++;
      await assert.rejects(
        () =>
          updateMember(db, admin, customer, { userId: admin, revoke: true }),
        { status: 403 },
      );
      checks++;
      const reset = "reset-" + suffix;
      await tx`INSERT INTO customer_password_reset_tokens(token_hash,user_id,expires_at) VALUES(${tokenHash(reset)},${user.id},EXTRACT(EPOCH FROM NOW())::BIGINT+900)`;
      await resetCustomerPassword(db, reset, "new-valid-password");
      assert.equal(
        (await tx`SELECT auth_version FROM users WHERE id=${user.id}`)[0]
          .auth_version,
        2,
      );
      await assert.rejects(
        () => resetCustomerPassword(db, reset, "another-password"),
        { status: 410 },
      );
      checks++;
      await updateCustomer(db, admin, customer, {
        name: "수정된 카페",
        website: "https://example.test/cafe",
      });
      assert.equal(
        (await tx`SELECT name FROM customers WHERE id=${customer}`)[0].name,
        "수정된 카페",
      );
      checks++;
      await assert.rejects(
        () => updateCustomer(db, second, customer, { name: "변조" }),
        { status: 404 },
      );
      checks++;
      await assert.rejects(
        () => updateCustomer(db, admin, other, { name: "변조" }),
        { status: 404 },
      );
      checks++;
      await assert.rejects(
        () => updateCustomer(db, owner, customer, { status: "inactive" }),
        { status: 409 },
      );
      checks++;
      const empty = "empty-" + suffix;
      await tx`INSERT INTO customers(id,tenant_id,name) VALUES(${empty},${tenant},'비활성화 테스트')`;
      await updateCustomer(db, owner, empty, { status: "inactive" });
      assert.equal(
        (await tx`SELECT status FROM customers WHERE id=${empty}`)[0].status,
        "inactive",
      );
      await updateCustomer(db, owner, empty, { status: "active" });
      assert.equal(
        (await tx`SELECT status FROM customers WHERE id=${empty}`)[0].status,
        "active",
      );
      checks++;
      await assert.rejects(
        () => updateCustomer(db, admin, customer, { status: "inactive" }),
        { status: 403 },
      );
      checks++;
      await recordDenied(db, second, customer, "member.invite");
      assert.equal(
        (
          await tx`SELECT count(*)::int AS n FROM access_audit_logs WHERE actor_user_id=${second} AND action='member.invite' AND outcome='denied'`
        )[0].n,
        1,
      );
      checks++;
      await assert.rejects(
        () => updateCustomer(db, owner, customer, { status: ["inactive"] }),
        { status: 400 },
      );
      assert.equal(
        (await tx`SELECT status FROM customers WHERE id=${customer}`)[0].status,
        "active",
      );
      checks++;
      const cancel = await createInvitation(db, owner, customer, {
        email: "cancel-" + suffix + "@example.test",
      });
      await updateMember(db, owner, customer, { invitationId: cancel.id });
      await assert.rejects(
        () => updateMember(db, owner, customer, { invitationId: cancel.id }),
        { status: 409 },
      );
      assert.equal(
        (
          await tx`SELECT count(*)::int AS n FROM access_audit_logs WHERE action='member.invite.revoke' AND target_id=${cancel.id}`
        )[0].n,
        1,
      );
      checks++;
      await assert.rejects(
        () => customerBot(db, second, customer, bot, "bot.configure"),
        { status: 404 },
      );
      checks++;
      await assert.rejects(
        () => customerBot(db, admin, customer, otherBot, "bot.configure"),
        { status: 404 },
      );
      checks++;
      await configureCustomerBot(db, admin, customer, bot, {
        widget_title: "고객사 설정",
        support_mode: "hybrid",
        greeting_message: "안녕하세요",
      });
      assert.equal(
        (await tx`SELECT widget_title FROM bots WHERE id=${bot}`)[0]
          .widget_title,
        "고객사 설정",
      );
      checks++;
      const vec = Array.from({ length: 1536 }, () => 0.01);
      const uploadInput = {
        title: "재업로드 검증",
        content: "초기 본문",
        folder_id: null,
      };
      const firstDoc = await uploadCustomerDocument(
        db,
        admin,
        customer,
        bot,
        uploadInput,
        vec,
      );
      const repeated = await uploadCustomerDocument(
        db,
        admin,
        customer,
        bot,
        uploadInput,
        vec,
      );
      assert.equal(repeated.id, firstDoc.id);
      assert.equal(repeated.skipped, true);
      checks++;
      const revised = await uploadCustomerDocument(
        db,
        admin,
        customer,
        bot,
        { ...uploadInput, content: "수정 본문" },
        vec,
      );
      assert.equal(revised.id, firstDoc.id);
      assert.equal(revised.updated, true);
      const matchingDocs =
        await tx`SELECT content FROM documents WHERE bot_id=${bot} AND title=${uploadInput.title}`;
      assert.equal(matchingDocs.length, 1);
      assert.equal(matchingDocs[0].content, "수정 본문");
      checks++;
      await assert.rejects(
        () =>
          uploadCustomerDocument(db, agent, customer, bot, uploadInput, vec),
        { status: 403 },
      );
      checks++;
      assert.equal(
        (
          await unchangedCustomerDocument(
            db,
            admin,
            customer,
            bot,
            uploadInput.title,
            "수정 본문",
          )
        )?.skipped,
        true,
      );
      assert.equal(
        await unchangedCustomerDocument(
          db,
          admin,
          customer,
          bot,
          uploadInput.title,
          "다른 본문",
        ),
        null,
      );
      checks++;
      const workbookRows = [
        {
          folder: "시트 A",
          question: "반복 가져오기 질문 A",
          answer: "기존 답변",
        },
        {
          folder: "시트 B",
          question: "반복 가져오기 질문 B",
          answer: "다른 답변",
        },
      ];
      await importCustomerQa(db, admin, customer, bot, workbookRows, null, [
        vec,
        vec,
      ]);
      const beforeImport =
        await tx`SELECT q.id,q.question,f.name FROM qa_pairs q JOIN qa_folders f ON f.id=q.folder_id WHERE q.bot_id=${bot} AND q.question LIKE '반복 가져오기 질문%' ORDER BY q.question`;
      assert.deepEqual(
        beforeImport.map((r) => r.name),
        ["시트 A", "시트 B"],
      );
      checks++;
      await importCustomerQa(
        db,
        admin,
        customer,
        bot,
        workbookRows.map((r) => ({ ...r, answer: "수정된 답변" })),
        null,
        [vec, vec],
      );
      const afterImport =
        await tx`SELECT id,answer FROM qa_pairs WHERE bot_id=${bot} AND question LIKE '반복 가져오기 질문%' ORDER BY question`;
      assert.deepEqual(
        afterImport.map((r) => r.id),
        beforeImport.map((r) => r.id),
      );
      assert.ok(afterImport.every((r) => r.answer === "수정된 답변"));
      checks++;
      const qa = await mutateKnowledge(
        db,
        admin,
        customer,
        bot,
        "qa",
        "POST",
        { question: "관리자 질문", answer: "관리자 답변" },
        null,
        vec,
      );
      assert.ok(
        (await listKnowledge(db, admin, customer, bot, "qa")).some(
          (r) => r.id === qa.id,
        ),
      );
      checks++;
      await assert.rejects(
        () =>
          mutateKnowledge(
            db,
            admin,
            customer,
            otherBot,
            "qa",
            "DELETE",
            {},
            qa.id,
            null,
          ),
        { status: 404 },
      );
      checks++;
      const foreignQa = "foreign-qa-" + suffix;
      await tx`INSERT INTO qa_pairs(id,bot_id,question,answer) VALUES(${foreignQa},${otherBot},'다른 질문','다른 답변')`;
      await assert.rejects(
        () =>
          mutateKnowledge(
            db,
            admin,
            customer,
            bot,
            "qa",
            "DELETE",
            {},
            foreignQa,
            null,
          ),
        { status: 404 },
      );
      checks++;
      const otherFolder = "other-folder-" + suffix;
      await tx`INSERT INTO qa_folders(id,bot_id,name) VALUES(${otherFolder},${otherBot},'다른 폴더')`;
      await assert.rejects(
        () =>
          mutateKnowledge(
            db,
            admin,
            customer,
            bot,
            "qa",
            "POST",
            { question: "변조", answer: "변조", folder_id: otherFolder },
            null,
            vec,
          ),
        { status: 404 },
      );
      checks++;
      await mutateKnowledge(
        db,
        admin,
        customer,
        bot,
        "qa",
        "PUT",
        { question: "수정 질문", answer: "수정 답변" },
        qa.id,
        vec,
      );
      await mutateKnowledge(
        db,
        admin,
        customer,
        bot,
        "qa",
        "DELETE",
        {},
        qa.id,
        null,
      );
      assert.ok(
        !(await listKnowledge(db, admin, customer, bot, "qa")).some(
          (r) => r.id === qa.id,
        ),
      );
      checks++;
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  console.log(
    `고객사 격리·담당 수락·멱등 전송·종료 재개 차단·인계·초대/검증/회수·비밀번호 재설정 ${checks}개 검증 통과. 전체 롤백.`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
