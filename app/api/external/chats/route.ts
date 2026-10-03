import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";

function isAuthorized(req: Request) {
  const expected = process.env.EXTERNAL_DASHBOARD_API_KEY;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && supplied === expected);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await initSchema();
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");

  if (sessionId) {
    const exists = await sql`SELECT id FROM chat_sessions WHERE id = ${sessionId}`;
    if (!exists[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const messages = await sql`
      SELECT id, sender_type, sender_name, content, source, created_at
      FROM chat_messages WHERE session_id = ${sessionId} ORDER BY created_at ASC
    `;
    return NextResponse.json({ sessionId, messages });
  }

  const rows = await sql`
    SELECT s.id AS session_id, s.status, s.customer_name, s.assigned_agent_name,
           s.updated_at, s.closed_at, b.id AS bot_id, b.name AS bot_name,
           b.type AS bot_type, h.status AS handoff_status, h.reason AS handoff_reason,
           (SELECT content FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
           (SELECT COUNT(*)::int FROM chat_messages m WHERE m.session_id = s.id) AS message_count
    FROM chat_sessions s
    JOIN bots b ON b.id = s.bot_id
    LEFT JOIN support_handoffs h ON h.session_id = s.id
    ORDER BY s.updated_at DESC LIMIT 200
  `;
  return NextResponse.json({ sessions: rows });
}
