import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "../lib/neon";
import type { AccessDatabase } from "../lib/access/schema";
import { createAccessSchema } from "../lib/access/schema";
import { googleIdentity, GoogleIdentityError } from "../lib/access/google";
import {
  agencySessionValid,
  verifyAgencyCredentials,
} from "../lib/access/credentials";
import { restrictedBotIds } from "../lib/access/visibility";
import { hash } from "bcryptjs";
import {
  acceptVerifiedInvitation,
  createInvitation,
  updateMember,
} from "../lib/customer-portal/management";
import { tokenHash } from "../lib/customer-portal/input";

/** Google identity resolution and verified invitation acceptance. Local QA DB only, fully rolled back. */
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
  const reason = (value: string) => (e: unknown) =>
    e instanceof GoogleIdentityError && e.reason === value;
  try {
    await sql.begin(async (tx) => {
      const db = tx as unknown as AccessDatabase;
      await createAccessSchema(db);
      const suffix = randomUUID(),
        tenant = "portal-" + suffix,
        customer = "customer-" + suffix,
        owner = "owner-" + suffix,
        profile = (subject: string, email: string, verified = true) => ({
          subject,
          email,
          name: "구글 사용자",
          verified,
        });
      await tx`INSERT INTO tenants(id,name,api_key) VALUES(${tenant},'테스트 에이전시',${randomUUID()})`;
      await tx`INSERT INTO users(id,name,email,email_verified_at) VALUES(${owner},'에이전시 담당자',${owner + "@example.test"},1)`;
      await tx`INSERT INTO partner_memberships(tenant_id,user_id) VALUES(${tenant},${owner})`;
      await tx`INSERT INTO customers(id,tenant_id,name) VALUES(${customer},${tenant},'카페 A')`;
      const tenantsBefore = Number(
        (await tx`SELECT count(*)::int AS n FROM tenants`)[0].n,
      );
      const count = async (table: string, column: string, value: string) =>
        Number(
          (
            await tx`SELECT count(*)::int AS n FROM ${tx(table)} WHERE ${tx(column)}=${value}`
          )[0].n,
        );

      // Unverified profiles never create or link anything.
      await assert.rejects(
        () =>
          googleIdentity(db, profile("sub-x", "x-" + suffix + "@example.test", false), false),
        reason("unverified"),
      );
      checks++;

      // Normal signup: tenant + owner + default customer, idempotent on retry.
      const fresh = "fresh-" + suffix + "@example.test";
      const signup = await googleIdentity(db, profile("sub-fresh-" + suffix, fresh), false);
      assert.ok(signup.tenantId);
      assert.equal(signup.email, fresh);
      const again = await googleIdentity(db, profile("sub-fresh-" + suffix, fresh), false);
      assert.equal(again.id, signup.id);
      assert.equal(again.tenantId, signup.tenantId);
      assert.equal(
        Number((await tx`SELECT count(*)::int AS n FROM tenants`)[0].n),
        tenantsBefore + 1,
      );
      assert.equal(await count("customers", "tenant_id", signup.tenantId!), 1);
      assert.equal(
        (
          await tx`SELECT email_verified_at FROM users WHERE id=${signup.id}`
        )[0].email_verified_at > 0,
        true,
      );
      checks++;

      // Same email with a different Google subject is refused; nothing is relinked.
      await assert.rejects(
        () => googleIdentity(db, profile("sub-other-" + suffix, fresh), false),
        reason("other_google"),
      );
      assert.equal(await count("user_accounts", "user_id", signup.id), 1);
      checks++;

      // Customer-only login without a pending invitation creates no identity.
      const stranger = "stranger-" + suffix + "@example.test";
      await assert.rejects(
        () => googleIdentity(db, profile("sub-stranger-" + suffix, stranger), true),
        reason("no_invitation"),
      );
      assert.equal(await count("users", "email", stranger), 0);
      checks++;

      // Invited customer-only login creates the identity only: no tenant, no membership yet.
      const invited = "invited-" + suffix + "@example.test";
      const invite = await createInvitation(db, owner, customer, { email: invited });
      const identity = await googleIdentity(db, profile("sub-invited-" + suffix, invited), true);
      assert.equal(identity.tenantId, null);
      assert.equal(
        Number((await tx`SELECT count(*)::int AS n FROM tenants`)[0].n),
        tenantsBefore + 1,
      );
      assert.equal(await count("customer_memberships", "user_id", identity.id), 0);
      checks++;

      // Explicit accept by the matching verified identity creates one membership and is idempotent.
      const accepted = await acceptVerifiedInvitation(db, invite.token, identity.id);
      assert.deepEqual(accepted, { customerId: customer, duplicate: false });
      const repeat = await acceptVerifiedInvitation(db, invite.token, identity.id);
      assert.deepEqual(repeat, { customerId: customer, duplicate: true });
      assert.equal(await count("customer_memberships", "user_id", identity.id), 1);
      assert.equal(
        (
          await tx`SELECT count(*)::int AS n FROM access_audit_logs WHERE action='member.accept' AND target_id=${invite.id}`
        )[0].n,
        1,
      );
      checks++;

      // A different signed-in user cannot consume someone else's invitation.
      await assert.rejects(
        () => acceptVerifiedInvitation(db, invite.token, signup.id),
        { status: 403 },
      );
      checks++;

      // Revoked members do not return through the old accepted invitation.
      await updateMember(db, owner, customer, { userId: identity.id, revoke: true });
      await assert.rejects(
        () => acceptVerifiedInvitation(db, invite.token, identity.id),
        { status: 410 },
      );
      checks++;

      // Re-invitation revokes the previous pending link; only the new one accepts.
      const reinvite = await createInvitation(db, owner, customer, { email: invited });
      const stale = await createInvitation(db, owner, customer, { email: invited });
      await assert.rejects(
        () => acceptVerifiedInvitation(db, reinvite.token, identity.id),
        { status: 410 },
      );
      await acceptVerifiedInvitation(db, stale.token, identity.id);
      assert.equal(
        (
          await tx`SELECT status FROM customer_memberships WHERE customer_id=${customer} AND user_id=${identity.id}`
        )[0].status,
        "active",
      );
      checks++;

      // An inviter who lost the permission retires the link with 410 instead of blaming the invitee.
      const adminUser = "admin-" + suffix;
      await tx`INSERT INTO users(id,name,email,email_verified_at) VALUES(${adminUser},'고객사 관리자',${adminUser + "@example.test"},1)`;
      await tx`INSERT INTO customer_memberships(customer_id,user_id,role) VALUES(${customer},${adminUser},'admin')`;
      const byAdmin = await createInvitation(db, adminUser, customer, {
        email: "by-admin-" + suffix + "@example.test",
      });
      await tx`INSERT INTO users(id,name,email,email_verified_at) VALUES(${"by-admin-" + suffix},'관리자 초대',${"by-admin-" + suffix + "@example.test"},1)`;
      await updateMember(db, owner, customer, { userId: adminUser, revoke: true });
      await assert.rejects(
        () => acceptVerifiedInvitation(db, byAdmin.token, "by-admin-" + suffix),
        { status: 410 },
      );
      assert.equal(
        (await tx`SELECT status FROM customer_invitations WHERE id=${byAdmin.id}`)[0].status,
        "revoked",
      );
      assert.equal(await count("customer_memberships", "user_id", "by-admin-" + suffix), 0);
      checks++;

      // Expired and revoked invitations, and inactive customers, are refused.
      const expired = await createInvitation(db, owner, customer, {
        email: "expired-" + suffix + "@example.test",
      });
      await tx`UPDATE customer_invitations SET expires_at=created_at-5,created_at=created_at-10 WHERE id=${expired.id}`;
      await tx`INSERT INTO users(id,name,email,email_verified_at) VALUES(${"expired-" + suffix},'만료',${"expired-" + suffix + "@example.test"},1)`;
      await assert.rejects(
        () => acceptVerifiedInvitation(db, expired.token, "expired-" + suffix),
        { status: 410 },
      );
      await assert.rejects(
        () => acceptVerifiedInvitation(db, "missing-token", identity.id),
        { status: 410 },
      );
      checks++;

      // Unverified email/password users must finish verification before accepting.
      const pending = "pending-" + suffix + "@example.test";
      await tx`INSERT INTO users(id,name,email,password_hash) VALUES(${"pending-" + suffix},'미검증',${pending},'x')`;
      const pendingInvite = await createInvitation(db, owner, customer, { email: pending });
      await assert.rejects(
        () => acceptVerifiedInvitation(db, pendingInvite.token, "pending-" + suffix),
        { status: 403 },
      );
      // ...and Google never auto-merges into that unverified account.
      await assert.rejects(
        () => googleIdentity(db, profile("sub-pending-" + suffix, pending), true),
        reason("verify_existing"),
      );
      assert.equal(await count("user_accounts", "user_id", "pending-" + suffix), 0);
      checks++;

      // Verified existing users link Google on first login and keep their id.
      const linked = await googleIdentity(db, profile("sub-owner-" + suffix, owner + "@example.test"), true);
      assert.equal(linked.id, owner);
      assert.equal(linked.tenantId, null);
      checks++;

      // Legacy tenant rows: subject match maps to the provisioned owner; email-only match is refused.
      const legacy = "legacy-" + suffix;
      await tx`INSERT INTO tenants(id,name,email,api_key,oauth_provider,oauth_sub) VALUES(${legacy},'기존 구글 에이전시',${legacy + "@example.test"},${randomUUID()},'google',${"sub-legacy-" + suffix})`;
      const mapped = await googleIdentity(db, profile("sub-legacy-" + suffix, legacy + "@example.test"), false);
      assert.equal(mapped.tenantId, legacy);
      const emailOnly = "legacy-email-" + suffix;
      await tx`INSERT INTO tenants(id,name,email,api_key) VALUES(${emailOnly},'이메일만 있는 기존 계정',${emailOnly + "@example.test"},${randomUUID()})`;
      await assert.rejects(
        () => googleIdentity(db, profile("sub-legacy-email-" + suffix, emailOnly + "@example.test"), false),
        reason("legacy_email"),
      );
      assert.equal(await count("users", "legacy_tenant_id", emailOnly), 0);
      checks++;

      // Disabled identities cannot log in even with a linked subject.
      await tx`UPDATE users SET status='disabled' WHERE id=${signup.id}`;
      await assert.rejects(
        () => googleIdentity(db, profile("sub-fresh-" + suffix, fresh), false),
        reason("disabled"),
      );
      checks++;

      assert.equal(
        (await tx`SELECT token_hash FROM customer_invitations WHERE id=${invite.id}`)[0]
          .token_hash,
        tokenHash(invite.token),
      );

      // Conversation text is restricted for bots assigned to non-default customers only.
      const homeCustomer = "home-" + suffix,
        assignedBot = "bot-assigned-" + suffix,
        homeBot = "bot-home-" + suffix,
        looseBot = "bot-loose-" + suffix;
      await tx`INSERT INTO customers(id,tenant_id,name,is_default) VALUES(${homeCustomer},${tenant},'우리 회사',TRUE)`;
      await tx`INSERT INTO bots(id,tenant_id,customer_id,name,type) VALUES(${assignedBot},${tenant},${customer},'고객사 봇','qa'),(${homeBot},${tenant},${homeCustomer},'자사 봇','qa'),(${looseBot},${tenant},NULL,'미배정 봇','qa')`;
      const restrictedSet = await restrictedBotIds(db, tenant);
      assert.equal(restrictedSet.has(assignedBot), true);
      assert.equal(restrictedSet.has(homeBot), false);
      assert.equal(restrictedSet.has(looseBot), false);
      checks++;

      // Agency email login prefers the common identity's password once the users row exists.
      const legacyTenant = "pw-" + suffix,
        legacyOwner = "pw-owner-" + suffix,
        legacyMail = legacyTenant + "@example.test";
      await tx`INSERT INTO tenants(id,name,email,api_key,password_hash) VALUES(${legacyTenant},'비밀번호 에이전시',${" PW-" + legacyTenant + "@Example.test "},${randomUUID()},${await hash("tenant-password-1", 4)})`;
      const [onlyTenant] = await tx`UPDATE tenants SET email=${legacyMail} WHERE id=${legacyTenant} RETURNING id`;
      assert.ok(onlyTenant);
      assert.ok(await verifyAgencyCredentials(db, legacyMail, "tenant-password-1"));
      assert.equal(await verifyAgencyCredentials(db, legacyMail, "wrong"), null);
      assert.equal(await agencySessionValid(db, legacyTenant, null), true);
      await tx`INSERT INTO users(id,legacy_tenant_id,name,email,password_hash,auth_version) VALUES(${legacyOwner},${legacyTenant},'소유자',${legacyMail},${await hash("user-password-2", 4)},3)`;
      await tx`INSERT INTO partner_memberships(tenant_id,user_id) VALUES(${legacyTenant},${legacyOwner})`;
      assert.equal(await verifyAgencyCredentials(db, legacyMail, "tenant-password-1"), null);
      const byUser = await verifyAgencyCredentials(db, " " + legacyMail.toUpperCase() + " ", "user-password-2");
      assert.equal(byUser?.tenantId, legacyTenant);
      assert.equal(byUser?.userId, legacyOwner);
      assert.equal(byUser?.authVersion, 3);
      assert.equal(await agencySessionValid(db, legacyTenant, 3), true);
      assert.equal(await agencySessionValid(db, legacyTenant, 2), false);
      await tx`UPDATE users SET status='disabled' WHERE id=${legacyOwner}`;
      assert.equal(await verifyAgencyCredentials(db, legacyMail, "user-password-2"), null);
      assert.equal(await agencySessionValid(db, legacyTenant, 3), false);
      await tx`UPDATE users SET status='active' WHERE id=${legacyOwner}`;
      await tx`UPDATE partner_memberships SET status='revoked' WHERE tenant_id=${legacyTenant}`;
      assert.equal(await agencySessionValid(db, legacyTenant, 3), false);
      await tx`UPDATE partner_memberships SET status='active' WHERE tenant_id=${legacyTenant}`;
      checks++;

      // A signed-in password session may link Google to its own unverified address; nobody else may.
      await assert.rejects(
        () => googleIdentity(db, profile("sub-pw-" + suffix, legacyMail), false),
        reason("verify_existing"),
      );
      await assert.rejects(
        () => googleIdentity(db, profile("sub-pw-" + suffix, legacyMail), false, { sessionUserId: owner }),
        reason("verify_existing"),
      );
      const linkedOwner = await googleIdentity(db, profile("sub-pw-" + suffix, legacyMail), false, {
        sessionUserId: legacyOwner,
      });
      assert.equal(linkedOwner.id, legacyOwner);
      assert.equal(linkedOwner.tenantId, legacyTenant);
      assert.ok(
        Number((await tx`SELECT email_verified_at FROM users WHERE id=${legacyOwner}`)[0].email_verified_at) > 0,
      );
      assert.equal(await count("user_accounts", "user_id", legacyOwner), 1);
      checks++;
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  console.log(
    `Google 신원 생성/연결/거부·초대 수락 멱등/재초대/회수/만료·에이전시 공통 비밀번호/세션 ${checks}개 검증 통과. 전체 롤백.`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
