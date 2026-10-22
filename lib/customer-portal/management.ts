import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import type { AccessDatabase } from "../access/schema";
import { canManageCustomerMember } from "../access/policy";
import { lockAccess } from "./auth";
import {
  PortalError,
  text,
  email,
  newToken,
  tokenHash,
  password,
} from "./input";
export async function createInvitation(
  db: AccessDatabase,
  actorId: string,
  customerId: string,
  input: Record<string, unknown>,
) {
  const grant = await lockAccess(db, actorId, customerId, "members.agent");
  if (
    input.role !== undefined &&
    !["agent", "admin"].includes(String(input.role))
  )
    throw new PortalError("역할을 확인해주세요.");
  const address = email(input.email),
    role = input.role === "admin" ? "admin" : "agent";
  if (role === "admin" && grant.role !== "owner")
    throw new PortalError(
      "고객사 관리자 초대는 에이전시 소유자만 할 수 있습니다.",
      403,
    );
  await db`UPDATE customer_invitations SET status='revoked' WHERE customer_id=${customerId} AND email=${address} AND status='pending'`;
  const token = newToken(),
    id = randomUUID();
  await db`INSERT INTO customer_invitations(id,customer_id,email,role,invited_by,token_hash,expires_at) VALUES(${id},${customerId},${address},${role},${actorId},${tokenHash(token)},EXTRACT(EPOCH FROM NOW())::BIGINT+259200)`;
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${actorId},${grant.tenant_id},${customerId},'member.invite',${id},'success')`;
  return { id, token };
}
export async function updateMember(
  db: AccessDatabase,
  actorId: string,
  customerId: string,
  input: Record<string, unknown>,
) {
  const grant = await lockAccess(db, actorId, customerId, "members.agent");
  if (input.invitationId) {
    const id = text(input.invitationId, "초대", 200);
    const [invite] =
      await db`SELECT id,role FROM customer_invitations WHERE id=${id} AND customer_id=${customerId}`;
    if (!invite) throw new PortalError("초대를 찾을 수 없습니다.", 404);
    if (invite.role === "admin" && grant.role !== "owner")
      throw new PortalError("초대 취소 권한이 없습니다.", 403);
    const revoked =
      await db`UPDATE customer_invitations SET status='revoked' WHERE id=${id} AND status='pending' AND expires_at>EXTRACT(EPOCH FROM NOW()) RETURNING id`;
    if (!revoked.length)
      throw new PortalError("이미 처리되었거나 만료된 초대입니다.", 409);
    await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${actorId},${grant.tenant_id},${customerId},'member.invite.revoke',${id},'success')`;
    return;
  }
  const target = text(input.userId, "담당자", 200),
    next =
      input.revoke === true
        ? null
        : input.role === "admin"
          ? "admin"
          : input.role === "agent"
            ? "agent"
            : undefined;
  if (next === undefined) throw new PortalError("역할을 확인해주세요.");
  const [member] =
    await db`SELECT role FROM customer_memberships WHERE customer_id=${customerId} AND user_id=${target} AND status='active'`;
  if (!member) throw new PortalError("담당자를 찾을 수 없습니다.", 404);
  if (
    !canManageCustomerMember(
      { userId: actorId, role: grant.role },
      { userId: target, role: member.role as "admin" | "agent" },
      next,
    )
  )
    throw new PortalError("이 담당자의 권한을 변경할 수 없습니다.", 403);
  await db`UPDATE customer_memberships SET role=${next ?? member.role},status=${next === null ? "revoked" : "active"},updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE customer_id=${customerId} AND user_id=${target}`;
  if (next === null)
    await db`UPDATE chat_sessions s SET assigned_agent_user_id=NULL,assigned_agent_name=NULL FROM bots b WHERE b.id=s.bot_id AND b.customer_id=${customerId} AND b.tenant_id=${grant.tenant_id} AND s.tenant_id=b.tenant_id AND s.assigned_agent_user_id=${target} AND s.status<>'closed'`;
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${actorId},${grant.tenant_id},${customerId},${next === null ? "member.revoke" : "member.role"},${target},'success')`;
}
/** A token sent to the invited mailbox proves possession. The copied invitation alone cannot create a login. */
export async function activateInvitation(
  db: AccessDatabase,
  challengeToken: string,
  input: Record<string, unknown>,
  loggedInUserId: string | null,
) {
  const digest = tokenHash(challengeToken);
  const [initial] =
    await db`SELECT i.customer_id FROM customer_invite_challenges c JOIN customer_invitations i ON i.id=c.invitation_id WHERE c.token_hash=${digest}`;
  if (!initial) throw new PortalError("확인 링크가 유효하지 않습니다.", 410);
  await db`SELECT id FROM customers WHERE id=${initial.customer_id} FOR UPDATE`;
  const [c] =
    await db`SELECT c.token_hash,c.used_at,c.expires_at,i.id AS invitation_id,i.email,i.role,i.status,i.expires_at AS invitation_expires_at,i.invited_by,i.customer_id,cu.tenant_id,cu.status AS customer_status FROM customer_invite_challenges c JOIN customer_invitations i ON i.id=c.invitation_id JOIN customers cu ON cu.id=i.customer_id WHERE c.token_hash=${digest} FOR UPDATE OF c,i`;
  const now = Math.floor(Date.now() / 1000);
  if (
    !c ||
    c.used_at ||
    Number(c.expires_at) <= now ||
    c.status !== "pending" ||
    Number(c.invitation_expires_at) <= now ||
    c.customer_status !== "active"
  )
    throw new PortalError("만료되었거나 취소된 확인 링크입니다.", 410);
  await lockAccess(
    db,
    String(c.invited_by),
    String(c.customer_id),
    c.role === "admin" ? "members.admin" : "members.agent",
  );
  let [user] =
    await db`SELECT id,status FROM users WHERE email=${c.email} FOR UPDATE`;
  if (user) {
    if (user.status !== "active")
      throw new PortalError("사용할 수 없는 계정입니다.", 403);
    if (user.id !== loggedInUserId)
      throw new PortalError(
        "이미 등록된 이메일입니다. 해당 담당자 계정으로 로그인한 뒤 링크를 다시 열어주세요.",
        401,
      );
  } else {
    const name = text(input.name, "이름", 80),
      secret = password(input.password);
    [user] =
      await db`INSERT INTO users(id,name,email,password_hash,email_verified_at) VALUES(${randomUUID()},${name},${c.email},${await hash(secret, 12)},${now}) RETURNING id,status`;
  }
  await db`UPDATE users SET email_verified_at=COALESCE(email_verified_at,${now}) WHERE id=${user.id}`;
  await db`INSERT INTO customer_memberships(customer_id,user_id,role) VALUES(${c.customer_id},${user.id},${c.role}) ON CONFLICT(customer_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT`;
  await db`UPDATE customer_invitations SET status='accepted',accepted_by=${user.id},accepted_at=${now} WHERE id=${c.invitation_id}`;
  await db`UPDATE customer_invite_challenges SET used_at=${now} WHERE token_hash=${digest}`;
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${user.id},${c.tenant_id},${c.customer_id},'member.accept',${c.invitation_id},'success')`;
  return { customerId: String(c.customer_id) };
}

/** Verified signed-in identities accept the copied invitation without a second email challenge. */
export async function acceptVerifiedInvitation(db: AccessDatabase, token: string, userId: string) {
  const digest = tokenHash(token);
  const [initial] = await db`SELECT customer_id FROM customer_invitations WHERE token_hash=${digest}`;
  if (!initial) throw new PortalError("유효하지 않은 초대입니다.",410);
  await db`SELECT id FROM customers WHERE id=${initial.customer_id} FOR UPDATE`;
  const [invite] = await db`SELECT i.*,c.tenant_id,c.status AS customer_status FROM customer_invitations i JOIN customers c ON c.id=i.customer_id WHERE i.token_hash=${digest} FOR UPDATE OF i`;
  const [user] = await db`SELECT id,email,email_verified_at,status FROM users WHERE id=${userId} FOR UPDATE`;
  if (!user || user.status !== 'active' || !user.email_verified_at) throw new PortalError("이메일 확인을 마친 계정으로 로그인해주세요.",403);
  if (user.email !== invite.email) throw new PortalError("초대받은 이메일과 로그인 계정이 다릅니다. 계정을 바꿔주세요.",403);
  if (invite.customer_status !== 'active') throw new PortalError("사용할 수 없는 고객사입니다.",410);
  if (invite.status === 'accepted' && invite.accepted_by === user.id) {
    const [membership] = await db`SELECT id FROM customers c JOIN customer_memberships m ON m.customer_id=c.id WHERE c.id=${invite.customer_id} AND m.user_id=${user.id} AND m.status='active'`;
    if (!membership) throw new PortalError("해제된 권한은 새 초대로 복귀할 수 있습니다.",410);
    return {customerId:String(invite.customer_id), duplicate:true};
  }
  if (invite.status !== 'pending' || Number(invite.expires_at) <= Date.now()/1000) throw new PortalError("만료되었거나 취소된 초대입니다.",410);
  await lockAccess(db,String(invite.invited_by),String(invite.customer_id),invite.role === 'admin' ? 'members.admin' : 'members.agent');
  await db`INSERT INTO customer_memberships(customer_id,user_id,role) VALUES(${invite.customer_id},${user.id},${invite.role}) ON CONFLICT(customer_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',updated_at=EXTRACT(EPOCH FROM NOW())::bigint`;
  await db`UPDATE customer_invitations SET status='accepted',accepted_by=${user.id},accepted_at=EXTRACT(EPOCH FROM NOW())::bigint WHERE id=${invite.id}`;
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${user.id},${invite.tenant_id},${invite.customer_id},'member.accept',${invite.id},'success')`;
  return {customerId:String(invite.customer_id), duplicate:false};
}
