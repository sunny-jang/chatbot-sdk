import sql from "@/lib/neon";
import { adminBot, failure } from "@/lib/operations/http";
import { createProactivePreview } from "@/lib/proactive-preview";
import { normalizeProactive } from "@/lib/proactive";
import { cleanPublicText } from "@/lib/proactive-analysis";
type Context={params:Promise<{id:string}>};
export async function GET(_:Request,{params}:Context){
  try{
    const {id}=await params;const {bot}=await adminBot(id);const month=new Date().toISOString().slice(0,7);
    const usage=await sql`SELECT COUNT(*)::int AS evaluations,COALESCE(SUM(input_tokens),0)::int AS input_tokens,COALESCE(SUM(output_tokens),0)::int AS output_tokens,COUNT(*) FILTER(WHERE shown_at IS NOT NULL)::int AS shown,COUNT(*) FILTER(WHERE clicked_at IS NOT NULL)::int AS clicked FROM proactive_evaluations WHERE bot_id=${id} AND month_key=${month}`;
    const evaluations=await sql`SELECT id,state,result,input_tokens,output_tokens,test,created_at,shown_at,clicked_at,dismissed_at FROM proactive_evaluations WHERE bot_id=${id} ORDER BY created_at DESC LIMIT 10`;
    const samples=await sql`SELECT title,LEFT(content,800) AS content FROM documents WHERE bot_id=${id} ORDER BY created_at DESC LIMIT 3`;
    return Response.json({config:normalizeProactive(bot.proactive_settings),usage:usage[0],evaluations,samples:samples.map(s=>({title:cleanPublicText(s.title,100),content:cleanPublicText(s.content,600)}))});
  }catch(e){return failure(e)}
}
export async function POST(_:Request,{params}:Context){
  try{const {id}=await params;const {bot}=await adminBot(id);return Response.json({token:createProactivePreview(id),botToken:bot.public_token,config:normalizeProactive(bot.proactive_settings)});}catch(e){return failure(e)}
}
