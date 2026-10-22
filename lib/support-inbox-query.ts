import sql from "./neon";

/** Filter before limiting, and retain the selected conversation within its tenant. */
export async function readSupportInbox(
  tenant: string,
  status: string,
  query: string,
  selectedSession: string,
  db: typeof sql = sql,
) {
  const search = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  return db`
    WITH inbox AS (
      SELECT h.summary,h.summary_status,h.id,h.session_id,h.status,h.reason,
        h.telegram_topic_id,h.slack_thread_ts,h.requested_at,h.accepted_at,h.closed_at,
        s.customer_name,s.assigned_agent_name,s.assigned_agent_user_id,s.updated_at,b.id AS bot_id,b.name AS bot_name,
        (SELECT content FROM chat_messages m WHERE m.session_id=s.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
      FROM support_handoffs h JOIN chat_sessions s ON s.id=h.session_id JOIN bots b ON b.id=h.bot_id
      WHERE s.tenant_id=${tenant} AND b.tenant_id=${tenant}
    )
    SELECT * FROM inbox
    WHERE session_id=${selectedSession} OR (
      (${status}='' OR status=${status}) AND
      (${query}='' OR CONCAT_WS(' ',customer_name,bot_name,last_message) ILIKE ${search})
    )
    ORDER BY (session_id=${selectedSession}) DESC,
      CASE status WHEN 'waiting' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
      requested_at ASC,id ASC LIMIT 200
  `;
}
