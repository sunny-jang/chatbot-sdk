import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { fanOutToSupportChannels, saveChatMessage } from "@/lib/support";
import { readTenantId } from "@/lib/auth";

async function tenantId() { return (await readTenantId()) ?? null; }

async function channelRefs(sessionId: string) {
  const rows = await sql`SELECT bot_id, telegram_topic_id, slack_thread_ts FROM support_handoffs WHERE session_id = ${sessionId}`;
  if (!rows[0]) return null;
  return rows[0] as { bot_id: string; telegram_topic_id: number | null; slack_thread_ts: string | null };
}

export async function GET(req: Request) {
  const tenant = await tenantId();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await initSchema();
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (sessionId) {
    const sessions = await sql`SELECT id FROM chat_sessions WHERE id = ${sessionId} AND tenant_id = ${tenant}`;
    if (!sessions[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(await sql`SELECT id, sender_type, sender_name, content, source, created_at FROM chat_messages WHERE session_id = ${sessionId} ORDER BY created_at ASC`);
  }
  const rows = await sql`
    SELECT h.id, h.session_id, h.status, h.reason, h.telegram_topic_id, h.slack_thread_ts, h.requested_at, h.accepted_at, h.closed_at,
           s.customer_name, s.assigned_agent_name, s.updated_at, b.id AS bot_id, b.name AS bot_name,
           (SELECT content FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
    FROM support_handoffs h JOIN chat_sessions s ON s.id = h.session_id JOIN bots b ON b.id = h.bot_id
    WHERE s.tenant_id = ${tenant} ORDER BY s.updated_at DESC LIMIT 200
  `;
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const tenant = await tenantId();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId, message, agentName = "관리자" } = await req.json();
  const sessions = await sql`SELECT id FROM chat_sessions WHERE id = ${sessionId} AND tenant_id = ${tenant}`;
  if (!sessions[0] || !message?.trim()) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  await sql`UPDATE chat_sessions SET status = 'human', assigned_agent_name = ${agentName}, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id = ${sessionId}`;
  await sql`UPDATE support_handoffs SET status = 'active', accepted_at = COALESCE(accepted_at, EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE session_id = ${sessionId}`;
  const saved = await saveChatMessage(sessionId, "agent", message.trim(), "admin", agentName);
  // DB에는 한 번만 저장하고, 연결된 외부 상담원 채널에는 표시용으로 미러링합니다.
  const refs = await channelRefs(sessionId);
  if (refs) await fanOutToSupportChannels(refs.bot_id, refs, `상담원(${agentName}): ${message.trim()}`);
  return NextResponse.json(saved);
}

export async function PATCH(req: Request) {
  const tenant = await tenantId();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId, action, agentName = "관리자" } = await req.json();
  const sessions = await sql`SELECT id FROM chat_sessions WHERE id = ${sessionId} AND tenant_id = ${tenant}`;
  if (!sessions[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (action === "accept") {
    // 대기 중인 상담만 시작합니다. 버튼을 여러 번 눌러도 연결 안내가 한 번만 저장되도록 조건부로 갱신합니다.
    const accepted = await sql`
      UPDATE support_handoffs SET status = 'active', accepted_at = COALESCE(accepted_at, EXTRACT(EPOCH FROM NOW())::BIGINT)
      WHERE session_id = ${sessionId} AND status = 'waiting'
      RETURNING session_id
    `;
    if (accepted.length === 0) return NextResponse.json({ ok: true, alreadyAccepted: true });
    await sql`UPDATE chat_sessions SET status = 'human', assigned_agent_name = ${agentName}, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id = ${sessionId}`;
    await saveChatMessage(sessionId, "system", `${agentName} 상담원이 연결되었습니다.`, "system");
  } else if (action === "close") {
    const now = Math.floor(Date.now() / 1000);
    // 아직 닫히지 않은 상담만 종료합니다. 중복 요청에도 종료 안내와 채널 알림이 한 번만 나가도록 조건부로 갱신합니다.
    const closed = await sql`
      UPDATE support_handoffs SET status = 'closed', closed_at = ${now}
      WHERE session_id = ${sessionId} AND status <> 'closed'
      RETURNING session_id
    `;
    if (closed.length === 0) return NextResponse.json({ ok: true, alreadyClosed: true });
    await sql`UPDATE chat_sessions SET status = 'closed', closed_at = ${now}, updated_at = ${now} WHERE id = ${sessionId}`;
    await saveChatMessage(sessionId, "system", "상담이 종료되었습니다.", "system");
    const refs = await channelRefs(sessionId);
    if (refs) await fanOutToSupportChannels(refs.bot_id, refs, "✅ 상담이 종료되었습니다. (상담함)");
  } else return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
