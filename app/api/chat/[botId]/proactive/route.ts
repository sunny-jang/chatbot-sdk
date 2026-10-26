import { withWidgetCors } from "@/lib/widget-origin";
import { initProactiveSchema } from "@/lib/proactive-db";
import sql from "@/lib/neon";
import { normalizeOrigin, normalizeProactive } from "@/lib/proactive";
import { behaviorHash, candidateReason, rankKnowledge, validateBehavior, type ProactiveOffer } from "@/lib/proactive-analysis";
import { generateProactive } from "@/lib/proactive-generation";
import { enforceRateLimit } from "@/lib/support";
import { failure, OperationError } from "@/lib/operations/http";
import { readProactivePreview } from "@/lib/proactive-preview";

export const maxDuration = 60;
const quiet = (reason: string) => ({ decision:"skip", reason });
type Context = { params: Promise<{botId:string}> };

async function smallBody(req: Request) {
  const reader=req.body?.getReader();if(!reader)throw new OperationError("입력 내용을 확인해주세요.");
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>8192){await reader.cancel();throw new OperationError("입력 내용이 너무 큽니다.",413)}chunks.push(part.value)}
  try{const value=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value}catch{throw new OperationError("올바른 요청 형식이 아닙니다.")}
}

async function POSTHandler(req:Request,{params}:Context){
  let reservedId:string|null=null;
  try{
    const {botId}=await params;await initProactiveSchema();
    const rows=await sql`SELECT b.*,t.subscription_status FROM bots b JOIN tenants t ON t.id=b.tenant_id WHERE b.id=${botId}`;
    const bot=rows[0];if(!bot)throw new OperationError("챗봇을 찾을 수 없습니다.",404);
    if(!bot.public_token||req.headers.get("x-bot-token")!==bot.public_token)throw new OperationError("인증을 확인해주세요.",401);
    const config=normalizeProactive(bot.proactive_settings);
    if(!config.enabled||config.mode!=="ai"||bot.subscription_status!=="active")return Response.json(quiet("disabled"));
    const body=await smallBody(req);
    const preview=readProactivePreview(body.previewToken,botId);
    const origin=normalizeOrigin(req.headers.get("origin"));
    // An allowlisted origin is mandatory for paid AI evaluations.
    if(!preview&&(!config.siteOrigin||!origin||origin!==config.siteOrigin))throw new OperationError("등록된 사이트에서만 사용할 수 있습니다.",403);
    if(preview && body.visitId!==preview.visitId)throw new OperationError("테스트 방문이 일치하지 않습니다.",403);
    if(body.action){
      if(!(await enforceRateLimit(`${botId}:proactive-events`,req,30)))return Response.json(quiet("rate_limit"),{status:429});
      if(!["shown","clicked","dismissed"].includes(body.action)||typeof body.id!=="string"||typeof body.visitId!=="string")throw new OperationError("제안 상태를 확인해주세요.");
      const proposals=await sql`SELECT id,result,session_id FROM proactive_evaluations WHERE id=${body.id} AND bot_id=${botId} AND visit_id=${body.visitId} AND state='completed' AND created_at>EXTRACT(EPOCH FROM NOW())-1800`;
      if(!proposals[0])throw new OperationError("만료된 제안입니다.",404);
      const offer=proposals[0].result as unknown as ProactiveOffer;
      if(offer?.decision!=="offer")throw new OperationError("표시할 제안이 없습니다.");
      if(body.action==="shown")await sql`UPDATE proactive_evaluations SET shown_at=COALESCE(shown_at,EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE id=${body.id}`;
      if(body.action==="dismissed")await sql`UPDATE proactive_evaluations SET dismissed_at=COALESCE(dismissed_at,EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE id=${body.id}`;
      if(body.action==="clicked")await sql`UPDATE proactive_evaluations SET clicked_at=COALESCE(clicked_at,EXTRACT(EPOCH FROM NOW())::BIGINT) WHERE id=${body.id}`;
      return Response.json({ok:true});
    }
    if(!(await enforceRateLimit(`${botId}:proactive`,req,6)))return Response.json(quiet("rate_limit"),{status:429});
    const behavior=validateBehavior(body);const reason=candidateReason(behavior,config.delaySeconds,config.excludedPaths);
    if(reason!=="eligible")return Response.json(quiet(reason));
    const sessionId=typeof body.sessionId==="string"&&body.sessionId.length<=200?body.sessionId:null;
    if(sessionId){const active=await sql`SELECT id FROM chat_sessions WHERE id=${sessionId} AND bot_id=${botId} AND status IN ('waiting','human')`;if(active.length)return Response.json(quiet("active_handoff"));}
    const hash=behaviorHash(behavior);const month=new Date().toISOString().slice(0,7);
    const reservation=await sql.begin(async tx=>{
      const locked=await tx`SELECT b.proactive_settings,t.subscription_status FROM bots b JOIN tenants t ON t.id=b.tenant_id WHERE b.id=${botId} FOR UPDATE OF t`;
      const current=normalizeProactive(locked[0]?.proactive_settings);
      if(!current.enabled||current.mode!=="ai"||(!preview&&current.siteOrigin!==origin)||locked[0]?.subscription_status!=="active")return {reason:"disabled"};
      const existing=await tx`SELECT * FROM proactive_evaluations WHERE bot_id=${botId} AND (id=${behavior.evaluationId} OR (visit_id=${behavior.visitId} AND summary_hash=${hash}))`;
      if(existing[0])return {existing:existing[0]};
      const visit=await tx`SELECT COUNT(*)::int AS count,MAX(created_at) AS last,COUNT(*) FILTER(WHERE shown_at IS NOT NULL OR clicked_at IS NOT NULL OR dismissed_at IS NOT NULL)::int AS displayed FROM proactive_evaluations WHERE bot_id=${botId} AND visit_id=${behavior.visitId}`;
      if(Number(visit[0]?.displayed)>0)return {reason:"already_shown"};
      if(Number(visit[0]?.count)>=2)return {reason:"visit_limit"};
      if(Number(visit[0]?.last)>Date.now()/1000-60)return {reason:"cooldown"};
      const usage=await tx`SELECT COUNT(*)::int AS count FROM proactive_evaluations WHERE bot_id=${botId} AND month_key=${month}`;
      if(Number(usage[0]?.count)>=current.monthlyLimit)return {reason:"monthly_limit"};
      await tx`INSERT INTO proactive_evaluations(id,bot_id,tenant_id,visit_id,month_key,summary_hash,session_id,test) VALUES(${behavior.evaluationId},${botId},${bot.tenant_id},${behavior.visitId},${month},${hash},${sessionId},${!!preview})`;
      return {reserved:true};
    });
    if("reason" in reservation)return Response.json(reservation.reason==="monthly_limit"?{decision:"offer",message:config.message.slice(0,60),reason:"monthly_limit"}:quiet(reservation.reason!));
    if("existing" in reservation){const e=reservation.existing!;if(e.visit_id!==behavior.visitId||e.summary_hash!==hash)throw new OperationError("평가 식별자가 일치하지 않습니다.",409);return Response.json(e.result?{...e.result,id:e.id}:quiet("processing"));}
    reservedId=behavior.evaluationId;
    const docs=await sql`SELECT id,title,LEFT(content,12000) AS content FROM documents WHERE bot_id=${botId} ORDER BY created_at DESC LIMIT 60`;
    const qa=await sql`SELECT id,question AS title,LEFT(answer,2000) AS content FROM qa_pairs WHERE bot_id=${botId} ORDER BY created_at DESC LIMIT 100`;
    const knowledge=rankKnowledge(behavior.sections.filter(s=>s.id===behavior.currentId),[...docs,...qa] as unknown as {id:string;title:string;content:string}[]);
    const result=await generateProactive(botId,String(bot.model||"gpt-4o-mini"),behavior,knowledge);
    if(result.offer.decision==="skip")result.offer={decision:"offer",message:"제가 도와드릴까요?",intent:"generic_help",discoveryGoal:"",sourceIds:[],reason:result.offer.reason};
    await sql`UPDATE proactive_evaluations SET state='completed',result=${sql.json(result.offer)},input_tokens=${result.inputTokens},output_tokens=${result.outputTokens} WHERE id=${behavior.evaluationId}`;
    return Response.json({...result.offer,id:behavior.evaluationId});
  }catch(error){
    if(reservedId)await sql`UPDATE proactive_evaluations SET state='failed',result=${sql.json(quiet("evaluation_failed"))} WHERE id=${reservedId}`.catch(()=>{});
    return failure(error)
  }
}

export const POST = withWidgetCors(POSTHandler);
