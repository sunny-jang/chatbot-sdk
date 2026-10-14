import sql from '../lib/neon';
import {createProactivePreview,readProactivePreview} from '../lib/proactive-preview';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const botId='8f3656de-94a4-4175-9b7f-2912baeb25c4';
async function main(){
 if(process.env.OPERATIONS_LIVE_PROACTIVE!=='1'){console.log('실제 모델 검증은 OPERATIONS_LIVE_PROACTIVE=1일 때만 실행합니다.');return;}
 const bot=(await sql`SELECT public_token FROM bots WHERE id=${botId}`)[0];
 const endpoint=`http://localhost:3001/api/chat/${botId}/proactive`;
 const token=createProactivePreview(botId);const visitId=readProactivePreview(token,botId)!.visitId;
 const body={visitId,evaluationId:randomUUID(),previewToken:token,path:'/services',currentId:'s-rag',activeSeconds:40,sections:[{id:'s-rag',title:'고객 응대 자동화',summary:'챗봇, RAG, LLM Agent. 고객 응대를 대신하고 팀은 중요한 일에 집중합니다. 사내 지식 챗봇 구축.',seconds:25,returns:1}]};
 const send=(payload:unknown,authorization=String(bot.public_token),origin='http://localhost:3010')=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Bot-Token':authorization,Origin:origin},body:JSON.stringify(payload)});
 assert.equal((await send(body,'wrong')).status,401);
 assert.equal((await send({...body,previewToken:''},String(bot.public_token),'https://evil.example')).status,403);
 const results=await Promise.all([send(body),send(body)]);const parsed=await Promise.all(results.map(r=>r.json()));
 console.log('동시 평가 응답:',JSON.stringify(parsed));
 const rows=await sql`SELECT id,result,input_tokens,output_tokens FROM proactive_evaluations WHERE id=${body.evaluationId}`;
 assert.equal(rows.length,1);const offer=rows[0].result;
 assert.equal(offer.reason,'grounded_question');assert.equal(offer.decision,'offer');assert.ok(offer.sourceIds.length);
 const repeated=await(await send(body)).json();assert.equal(repeated.id,body.evaluationId);
 const other={...body,evaluationId:randomUUID(),currentId:'s-other',sections:[{...body.sections[0],id:'s-other'}]};
 const cooldown=await(await send(other)).json();assert.equal(cooldown.reason,'cooldown');
 await send({action:'shown',id:body.evaluationId,visitId,previewToken:token});
 assert.equal((await(await send(other)).json()).reason,'already_shown');
 console.log('실제 모델·등록 지식·동시 예약·재시도·원산지 검증·중복 노출 검증 통과');
}
main().finally(()=>sql.end());
