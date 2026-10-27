import sql from "./neon";
import type { ProactiveOffer } from "./proactive-analysis";


export async function bindProactiveContext(botId: string, sessionId: string, value: unknown) {
  if (!value || typeof value !== "object") {
    const remembered = await sql`SELECT id,visit_id FROM proactive_evaluations WHERE bot_id=${botId} AND session_id=${sessionId} AND clicked_at IS NOT NULL AND dismissed_at IS NULL AND created_at>EXTRACT(EPOCH FROM NOW())-1800 ORDER BY created_at DESC LIMIT 1`;
    if(!remembered[0])return null;
    value={id:remembered[0].id,visitId:remembered[0].visit_id};
  }
  const input=value as Record<string,unknown>;
  if(typeof input.id!=="string"||typeof input.visitId!=="string")return null;
  const {id,visitId}=input as {id:string;visitId:string};
  const bound=await sql.begin(async tx=>{
    const rows=await tx`SELECT id,result,session_id FROM proactive_evaluations WHERE id=${id} AND bot_id=${botId} AND visit_id=${visitId} AND state='completed' AND dismissed_at IS NULL AND created_at>EXTRACT(EPOCH FROM NOW())-1800 AND (session_id IS NULL OR session_id=${sessionId}) FOR UPDATE`;
    const row=rows[0];if(!row)return null;
    const offer=row.result as unknown as ProactiveOffer;if(offer?.decision!=="offer")return null;
    const first=!(await tx`SELECT id FROM chat_messages WHERE session_id=${sessionId} AND source='proactive' LIMIT 1`).length;
    await tx`UPDATE proactive_evaluations SET session_id=${sessionId},clicked_at=COALESCE(clicked_at,EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE id=${id}`;
    if(first)await tx`INSERT INTO chat_messages(id,session_id,sender_type,content,source) VALUES(${crypto.randomUUID()},${sessionId},'bot',${offer.message},'proactive')`;
    return offer;
  });
  if(!bound)return null;
  const ids=bound.sourceIds;
  const docs=ids.length?await sql`SELECT title,LEFT(content,2000) AS content FROM documents WHERE bot_id=${botId} AND archived_at IS NULL AND id=ANY(${ids}::text[])`:[];
  const qa=ids.length?await sql`SELECT question AS title,LEFT(answer,2000) AS content FROM qa_pairs WHERE bot_id=${botId} AND id=ANY(${ids}::text[])`:[];
  return {offer:bound,knowledge:[...docs,...qa]};
}
