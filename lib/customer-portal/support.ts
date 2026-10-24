import { randomUUID } from "node:crypto";
import sql from "../neon";
import type { AccessDatabase } from "../access/schema";
import { lockAccess } from "./auth";
import { PortalError, text, tokenHash } from "./input";

type Actor = { id: string; name: string };
export async function readCustomerInbox(
  userId: string,
  customerId: string,
  status: string,
  query: string,
  selected: string,
  db: AccessDatabase = sql,
) {
  const search = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
  return db`WITH inbox AS (
   SELECT h.id,h.session_id,h.status,h.reason,h.summary,h.summary_status,h.requested_at,
   s.customer_name,s.assigned_agent_name,s.assigned_agent_user_id,b.name AS bot_name,
   (SELECT content FROM chat_messages m WHERE m.session_id=s.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message
   FROM support_handoffs h JOIN chat_sessions s ON s.id=h.session_id AND s.bot_id=h.bot_id
   JOIN bots b ON b.id=s.bot_id AND b.tenant_id=s.tenant_id
   JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id AND c.status='active'
   JOIN users u ON u.id=${userId} AND u.status='active'
   WHERE c.id=${customerId} AND (EXISTS(SELECT 1 FROM partner_memberships p WHERE p.user_id=u.id AND p.tenant_id=c.tenant_id AND p.status='active')
     OR EXISTS(SELECT 1 FROM customer_memberships m WHERE m.user_id=u.id AND m.customer_id=c.id AND m.status='active'))
 ) SELECT * FROM inbox WHERE session_id=${selected} OR ((${status}='' OR status=${status}) AND (${query}='' OR CONCAT_WS(' ',customer_name,bot_name,last_message) ILIKE ${search}))
 ORDER BY (session_id=${selected}) DESC,CASE status WHEN 'waiting' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,requested_at,id LIMIT 200`;
}
export async function readCustomerMessages(
  userId: string,
  customerId: string,
  sessionId: string,
  db: AccessDatabase = sql,
) {
  const rows = await readCustomerInbox(
    userId,
    customerId,
    "",
    "",
    sessionId,
    db,
  );
  if (!rows.some((r) => r.session_id === sessionId))
    throw new PortalError("상담을 찾을 수 없습니다.", 404);
  return db`SELECT id,sender_type,sender_name,content,created_at FROM chat_messages WHERE session_id=${sessionId} ORDER BY created_at,id`;
}
export async function mutateCustomerSupport(
  db: AccessDatabase,
  actor: Actor,
  customerId: string,
  input: Record<string, unknown>,
) {
  const grant = await lockAccess(db, actor.id, customerId, "support.work");
  const sessionId = text(input.sessionId, "상담", 200);
  const [s] =
    await db`SELECT s.id,s.status AS session_status,s.assigned_agent_user_id,h.status,h.id AS handoff_id,h.bot_id,h.telegram_topic_id,h.slack_thread_ts
   FROM chat_sessions s JOIN bots b ON b.id=s.bot_id AND b.tenant_id=s.tenant_id
   JOIN support_handoffs h ON h.session_id=s.id AND h.bot_id=s.bot_id
   WHERE s.id=${sessionId} AND b.customer_id=${customerId} AND b.tenant_id=${grant.tenant_id} FOR UPDATE OF s,h`;
  if (!s) throw new PortalError("상담을 찾을 수 없습니다.", 404);
  const action = input.action;
  if (action === "message") {
    const content = text(input.message, "답변", 6000),
      key = text(input.idempotencyKey, "전송 키", 100);
    const payload = tokenHash(actor.id + "\n" + content);
    const [previous] =
      await db`SELECT r.payload_hash,m.id,m.sender_type,m.sender_name,m.content,m.created_at FROM customer_message_requests r JOIN chat_messages m ON m.id=r.message_id WHERE r.session_id=${sessionId} AND r.request_key=${key}`;
    if (previous) {
      if (previous.payload_hash !== payload)
        throw new PortalError("같은 전송 키로 내용을 변경할 수 없습니다.", 409);
      return {
        message: {
          id: previous.id,
          sender_type: previous.sender_type,
          sender_name: previous.sender_name,
          content: previous.content,
          created_at: previous.created_at,
        },
        duplicate: true,
        refs: null,
      };
    }
    if (s.status === "closed" || s.session_status === "closed")
      throw new PortalError("종료된 상담에는 답변할 수 없습니다.", 409);
    if (s.status !== "active" || s.assigned_agent_user_id !== actor.id)
      throw new PortalError(
        "상담을 시작하거나 인계를 받은 뒤 답변해주세요.",
        409,
      );
    const [message] =
      await db`INSERT INTO chat_messages(id,session_id,sender_type,sender_name,sender_user_id,content,source)
     VALUES(${randomUUID()},${sessionId},'agent',${actor.name},${actor.id},${content},'customer_portal') RETURNING id,sender_type,sender_name,content,created_at`;
    await db`INSERT INTO customer_message_requests(session_id,request_key,payload_hash,message_id) VALUES(${sessionId},${key},${payload},${message.id})`;
    await db`UPDATE chat_sessions SET updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${sessionId}`;
    await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${actor.id},${grant.tenant_id},${customerId},'support.message',${message.id},'success')`;
    return { message, duplicate: false, refs: s };
  }
  if (s.status === "closed" || s.session_status === "closed") {
    if (action === "close")
      return { ok: true, alreadyClosed: true, refs: null };
    throw new PortalError("종료된 상담입니다.", 409);
  }
  if (action === "accept") {
    if (s.assigned_agent_user_id && s.assigned_agent_user_id !== actor.id)
      throw new PortalError("다른 담당자가 응대 중입니다.", 409);
    if (s.status === "active" && s.assigned_agent_user_id === actor.id)
      return { ok: true, alreadyAccepted: true, refs: null };
    await db`UPDATE chat_sessions SET status='human',assigned_agent_user_id=${actor.id},assigned_agent_name=${actor.name},updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${sessionId}`;
    await db`UPDATE support_handoffs SET status='active',accepted_at=COALESCE(accepted_at,EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE id=${s.handoff_id}`;
  } else if (action === "assign") {
    if (grant.role === "agent")
      throw new PortalError("담당자 변경 권한이 없습니다.", 403);
    const assignee = text(input.assignee, "담당자", 200);
    const [u] =
      await db`SELECT u.id,u.name FROM users u WHERE u.id=${assignee} AND u.status='active' AND (
     EXISTS(SELECT 1 FROM customer_memberships m WHERE m.user_id=u.id AND m.customer_id=${customerId} AND m.status='active') OR
     EXISTS(SELECT 1 FROM partner_memberships p WHERE p.user_id=u.id AND p.tenant_id=${grant.tenant_id} AND p.status='active'))`;
    if (!u) throw new PortalError("이 고객사의 담당자를 선택해주세요.", 404);
    await db`UPDATE chat_sessions SET status='human',assigned_agent_user_id=${u.id},assigned_agent_name=${u.name},updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${sessionId}`;
    await db`UPDATE support_handoffs SET status='active',accepted_at=COALESCE(accepted_at,EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE id=${s.handoff_id}`;
  } else if (action === "close") {
    if (s.assigned_agent_user_id !== actor.id)
      throw new PortalError(
        "본인이 맡은 상담만 종료할 수 있습니다. 먼저 인계를 받아주세요.",
        409,
      );
    await db`UPDATE chat_sessions SET status='closed',closed_at=EXTRACT(EPOCH FROM NOW())::BIGINT,updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${sessionId}`;
    await db`UPDATE support_handoffs SET status='closed',closed_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${s.handoff_id}`;
  } else throw new PortalError("동작을 확인해주세요.");
  const content =
    action === "close"
      ? "상담이 종료되었습니다."
      : action === "assign"
        ? "담당자가 변경되었습니다."
        : `${actor.name} 담당자가 상담을 시작했습니다.`;
  await db`INSERT INTO chat_messages(id,session_id,sender_type,content,source,sender_user_id) VALUES(${randomUUID()},${sessionId},'system',${content},'customer_portal',${actor.id})`;
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${actor.id},${grant.tenant_id},${customerId},${"support." + String(action)},${sessionId},'success')`;
  return { ok: true, refs: action === "close" ? s : null };
}
