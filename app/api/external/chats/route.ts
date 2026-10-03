import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { classifyIntent, detectRefusal } from "@/lib/analytics";

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
  const analytics = url.searchParams.get("analytics") === "1";

  if (analytics) {
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 365);
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = await sql`
      SELECT l.*, b.name AS bot_name, b.type AS bot_type
      FROM chat_logs l JOIN bots b ON b.id = l.bot_id
      WHERE l.created_at >= ${since}
      ORDER BY l.created_at DESC LIMIT 10000
    `;
    const logs: any[] = (rows as unknown as any[]).map((row: any) => {
      const refusal = row.refused === null ? detectRefusal(String(row.bot_reply ?? "")) : { refused: Boolean(row.refused), reason: row.refusal_reason as string | null };
      return { ...row, created_at: Number(row.created_at), intent: classifyIntent(String(row.user_message ?? "")), refused: refusal.refused, refusal_reason: refusal.reason };
    });
    const sessions = new Set(logs.map((x) => String(x.session_id || x.id)));
    const refused = logs.filter((x) => x.refused);
    const intentMap = new Map<string, number>();
    const refusalMap = new Map<string, number>();
    const toolMap = new Map<string, { calls:number; success:number }>();
    for (const x of logs) {
      const intent = String(x.intent || "기타"); intentMap.set(intent, (intentMap.get(intent) ?? 0) + 1);
      if (x.refused) { const reason = String(x.refusal_reason || "기타"); refusalMap.set(reason, (refusalMap.get(reason) ?? 0) + 1); }
      if (x.tool_name) { const name=String(x.tool_name); const t=toolMap.get(name) ?? {calls:0,success:0}; t.calls++; if(x.tool_success)t.success++; toolMap.set(name,t); }
    }
    const pct=(a:number,b:number)=>b?Number((a/b*100).toFixed(1)):null;
    return NextResponse.json({
      periodDays: days,
      summary: { messages: logs.length, conversations: sessions.size, responseRate: pct(logs.length-refused.length,logs.length), refusalRate:pct(refused.length,logs.length), apiSuccessRate:pct(logs.filter(x=>x.api_success===true).length,logs.filter(x=>x.api_success!==null).length), averageLatencyMs: (()=>{const a=logs.filter(x=>x.latency_ms!==null);return a.length?Math.round(a.reduce((s,x)=>s+Number(x.latency_ms),0)/a.length):null})() },
      intents:[...intentMap].map(([name,count])=>({name,count,share:pct(count,logs.length)})).sort((a,b)=>b.count-a.count),
      refusalReasons:[...refusalMap].map(([name,count])=>({name,count,share:pct(count,refused.length)})).sort((a,b)=>b.count-a.count),
      tools:[...toolMap].map(([name,x])=>({name,calls:x.calls,successRate:pct(x.success,x.calls)})).sort((a,b)=>b.calls-a.calls),
      conversations: logs.slice(0,200).map(x=>({id:x.id,botName:x.bot_name,botType:x.bot_type,sessionId:x.session_id,userMessage:x.user_message,botReply:x.bot_reply,createdAt:x.created_at,intent:x.intent,refused:x.refused,refusalReason:x.refusal_reason,apiSuccess:x.api_success,latencyMs:x.latency_ms,toolName:x.tool_name,qaMatched:x.qa_matched,qaMatchScore:x.qa_match_score})),
    });
  }

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
