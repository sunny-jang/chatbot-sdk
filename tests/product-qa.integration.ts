/** Full-product HTTP regression against the disposable LOCAL QA database only. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sql from '../lib/neon';
const base=process.env.OPERATIONS_TEST_URL||'http://localhost:3012';
const results:{id:string;status:string;note:string}[]=[];
let cookie='';
async function api(path:string,method='GET',body?:unknown,auth=true){
 const r=await fetch(base+path,{method,redirect:'manual',headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw}return {status:r.status,data,location:r.headers.get('location')};
}
async function check(id:string,run:()=>Promise<void>){try{await run();results.push({id,status:'pass',note:'격리 로컬 DB + 실제 HTTP 검증 통과'});console.log('PASS',id)}catch(e){results.push({id,status:'fail',note:e instanceof Error?e.message:String(e)});console.log('FAIL',id)}}
async function main(){
 const u=new URL(process.env.POSTGRES_URL||'');
 if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!='/chatbot_qa'||new URL(base).port!=='3012')throw Error('전용 로컬 QA DB/3012 서버만 허용');
 const d=JSON.parse(await readFile('/tmp/ideal-ai-operations-fixture.json','utf8'));
 const jar=new Map<string,string>();const collect=(r:Response)=>{for(const raw of r.headers.getSetCookie()){const c=raw.split(';')[0];jar.set(c.slice(0,c.indexOf('=')),c)}cookie=[...jar.values()].join('; ')};
 collect(await fetch(base+'/api/auth/csrf'));
 const csrf=await fetch(base+'/api/auth/csrf',{headers:{Cookie:cookie}});const csrfData=await csrf.json();collect(csrf);
 collect(await fetch(base+'/api/auth/callback/credentials',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie,'X-Auth-Return-Redirect':'1'},body:new URLSearchParams({csrfToken:csrfData.csrfToken,email:d.email,password:d.password,callbackUrl:base})}));
 await sql`DELETE FROM chat_sessions WHERE tenant_id=${d.tenant} AND (id LIKE 'qa-old-%' OR id LIKE 'qa-closed-%')`;
 await sql`UPDATE chat_sessions SET status='waiting' WHERE id=${d.session}`;await sql`UPDATE support_handoffs SET status='waiting' WHERE session_id=${d.session}`;
 await sql`DELETE FROM chat_messages WHERE session_id=${d.session} AND sender_type='system'`;
 // A retained fixture from an interrupted integration run still has a valid test-only cookie.
 await check('AUTH-session',async()=>assert.equal((await api('/api/auth/session')).data.tenant_id,d.tenant));
 await check('A01',async()=>{for(const p of ['/support','/requests','/bots']){const r=await api(p,'GET',undefined,false);assert.equal(r.status,307);assert.ok(r.location?.includes('/login'))}});
 await check('A02',async()=>assert.equal((await api('/api/support/handoffs','GET',undefined,false)).status,401));
 await check('A05',async()=>{assert.equal((await api(`/api/bots/${d.other}`)).status,404);assert.equal((await api(`/api/bots/${d.other}/requests`)).status,404)});
 await check('W06-general',async()=>assert.equal((await api('/api/admin/tenants')).status,403));
 const foreignSession='qa-foreign-'+randomUUID();
 await sql`INSERT INTO chat_sessions(id,tenant_id,bot_id,status) SELECT ${foreignSession},tenant_id,id,'waiting' FROM bots WHERE id=${d.other}`;
 await check('A03',async()=>assert.equal((await api('/api/support/handoffs?sessionId='+foreignSession)).status,404));
 await check('A04',async()=>{const r=await api('/api/support/handoffs?selectedSession='+foreignSession);assert.equal(r.status,200);assert.ok(!r.data.some((x:{session_id:string})=>x.session_id===foreignSession))});
 const old='qa-old-'+randomUUID(),closed='qa-closed-'+randomUUID();
 await sql`INSERT INTO chat_sessions(id,tenant_id,bot_id,status,customer_name,updated_at) VALUES(${old},${d.tenant},${d.bot},'waiting','QA 오래된 대기',1),(${closed},${d.tenant},${d.bot},'closed','QA 종료',2)`;
 await sql`INSERT INTO support_handoffs(id,session_id,bot_id,status,requested_at) VALUES(${randomUUID()},${old},${d.bot},'waiting',1),(${randomUUID()},${closed},${d.bot},'closed',2)`;
 await sql`INSERT INTO chat_messages(id,session_id,sender_type,content) VALUES(${randomUUID()},${old},'customer','QA 문자 %_ 검색')`;
 for(let i=0;i<205;i++){const id='qa-bulk-'+i;await sql`INSERT INTO chat_sessions(id,tenant_id,bot_id,status,updated_at) VALUES(${id},${d.tenant},${d.bot},'closed',${100+i}) ON CONFLICT DO NOTHING`;await sql`INSERT INTO support_handoffs(id,session_id,bot_id,status,requested_at) VALUES(${randomUUID()},${id},${d.bot},'closed',${100+i}) ON CONFLICT(session_id) DO NOTHING`}
 await check('S01',async()=>{const r=await api('/api/support/handoffs?status=waiting');assert.equal(r.status,200);assert.equal(r.data[0].session_id,old);assert.ok(r.data.every((x:{status:string})=>x.status==='waiting'))});
 await check('S02',async()=>assert.ok((await api('/api/support/handoffs')).data.some((x:{session_id:string})=>x.session_id===old)));
 await check('S03-R06',async()=>{const r=await api('/api/support/handoffs?q='+encodeURIComponent('%_'));assert.equal(r.data.length,1);assert.equal(r.data[0].session_id,old)});
 await check('S04',async()=>assert.ok((await api('/api/support/handoffs?status=waiting&selectedSession='+closed)).data.some((x:{session_id:string})=>x.session_id===closed)));
 await check('R01-R02',async()=>{let r=await api('/api/bots/'+d.bot+'/requests');assert.equal(r.status,200);let item=r.data.items[0];
 if(!item){const settings=await(await fetch(base+'/api/chat/'+d.bot+'/requests',{headers:{'X-Bot-Token':d.token}})).json();const submitted=await pub('/api/chat/'+d.bot+'/requests',{kind:settings.quote?'quote':'consultation',name:'QA 신청 고객',email:'qa@example.test',message:'격리 테스트 신청',consent:true,consentVersion:settings.consentVersion,idempotencyKey:randomUUID()});assert.equal(submitted.status,201);item=(await api('/api/bots/'+d.bot+'/requests')).data.items[0];}
 assert.ok(item);assert.equal((await api('/api/bots/'+d.bot+'/requests','PATCH',{requestId:item.id,status:'in_progress'})).status,200);r=await api('/requests?status=in_progress&q='+encodeURIComponent(item.name));assert.equal(r.status,200);assert.ok(r.data.includes(item.name))});
 await check('R04',async()=>{for(const p of ['/requests?q=one&q=two','/support?status=active&status=closed'])assert.equal((await api(p)).status,200)});
 await check('R05',async()=>{for(const p of ['/requests?status=invalid&q='+encodeURIComponent(' 한글 '.repeat(100)),'/support?status=invalid&q=%20'])assert.equal((await api(p)).status,200)});
 await check('S12-HTTP',async()=>{const r=await api('/api/support/handoffs','POST',{sessionId:old,message:'QA HTTP 왕복 테스트'});assert.equal(r.status,200);const m=(await api('/api/support/handoffs?sessionId='+old)).data;assert.equal(m.filter((x:{content:string})=>x.content==='QA HTTP 왕복 테스트').length,1)});
 await check('S13-closed-late-send',async()=>{const r=await api('/api/support/handoffs','POST',{sessionId:closed,message:'QA 종료 후 늦은 답변'});assert.ok(r.status>=400,'종료 상담 POST가 거부되어야 하나 HTTP '+r.status);});
 await sql`UPDATE chat_sessions SET status='closed' WHERE id=${closed}`;await sql`UPDATE support_handoffs SET status='closed' WHERE session_id=${closed}`;
 await check('S13-double-accept',async()=>{const rs=await Promise.all([api('/api/support/handoffs','PATCH',{sessionId:d.session,action:'accept'}),api('/api/support/handoffs','PATCH',{sessionId:d.session,action:'accept'})]);assert.ok(rs.every(r=>r.status===200));const m=(await api('/api/support/handoffs?sessionId='+d.session)).data;assert.equal(m.filter((x:{sender_type:string;content:string})=>x.sender_type==='system'&&x.content.includes('상담원이 연결')).length,1)});
 await check('S13-double-close',async()=>{await Promise.all([api('/api/support/handoffs','PATCH',{sessionId:d.session,action:'close'}),api('/api/support/handoffs','PATCH',{sessionId:d.session,action:'close'})]);const m=(await api('/api/support/handoffs?sessionId='+d.session)).data;assert.equal(m.filter((x:{content:string})=>x.content==='상담이 종료되었습니다.').length,1)});
 await check('W01-counts',async()=>{const r=await api('/');assert.equal(r.status,200);assert.ok(r.data.includes('오늘의 업무'));assert.ok(r.data.includes('QA 오래된 대기')===false);}); // old was accepted above, no longer waiting
 await check('BOT-isolation-update',async()=>assert.equal((await api('/api/bots/'+d.other,'PUT',{name:'금지된 변경'})).status,404));
 await check('U01-current-regression',async()=>{const r=await api('/api/bots/'+d.bot,'PUT',{widget_title:'<img src=x onerror=alert(1)>',widget_color:'red;}body{display:none'});assert.equal(r.status,400,'악성 설정 저장이 거부되어야 하나 HTTP '+r.status)});
 await sql`UPDATE bots SET widget_title='QA 고객지원',widget_color='#2563eb' WHERE id=${d.bot}`;
 await check('BOT-pages',async()=>{for(const path of ['/bots','/bots/'+d.bot,'/bots/'+d.bot+'/qa','/bots/'+d.bot+'/docs','/bots/'+d.bot+'/test','/bots/'+d.bot+'/logs','/bots/'+d.bot+'/analytics','/analytics','/plan','/guide','/sdk-guide','/settings'])assert.equal((await api(path)).status,200,path)});
 // Restore a waiting item and add an AI bot without any real model key for clean screenshots.
 await sql`UPDATE chat_sessions SET status='waiting' WHERE id=${old}`;await sql`UPDATE support_handoffs SET status='waiting' WHERE session_id=${old}`;
 await sql`UPDATE tenants SET plan='growth' WHERE id=${d.tenant}`;
 await sql`INSERT INTO bots(id,tenant_id,name,type,public_token,widget_title) VALUES('qa-ai-bot',${d.tenant},'QA 지식 상담 봇','ai','qa-local-ai-token','지식 상담') ON CONFLICT DO NOTHING`;
 await sql`INSERT INTO documents(id,bot_id,title,content) VALUES('qa-doc','qa-ai-bot','배송 안내.md','테스트 제품은 영업일 2~3일 안에 발송됩니다.') ON CONFLICT DO NOTHING`;

 async function pub(path:string,body:unknown,token=d.token,origin='http://127.0.0.1:3013'){
  const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Bot-Token':token,Origin:origin},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};
 }
 await check('T02-01-create-edit',async()=>{const r=await api('/api/bots','POST',{name:'QA 생성 검증',type:'qa'});assert.equal(r.status,201);const id=r.data.id;assert.equal((await api('/api/bots/'+id,'PUT',{name:'QA 수정 검증'})).status,200);assert.equal((await api('/api/bots/'+id)).data.name,'QA 수정 검증');assert.equal((await api('/api/bots','POST',{name:'초과 검증',type:'ai'})).status,409);assert.equal((await api('/api/bots/'+id,'DELETE')).status,200);assert.equal((await api('/api/bots/'+id)).status,404);assert.equal((await fetch(base+'/api/widget/'+id)).status,404)});
 await check('T08-01-bot-limits',async()=>{await sql`UPDATE tenants SET plan='starter' WHERE id=${d.tenant}`;assert.equal((await api('/api/bots','POST',{name:'한도 검증',type:'ai'})).data.code,'BOT_LIMIT_REACHED');await sql`UPDATE tenants SET subscription_status='inactive' WHERE id=${d.tenant}`;assert.equal((await api('/api/bots','POST',{name:'중지 검증',type:'qa'})).status,403);await sql`UPDATE tenants SET subscription_status='active',plan='enterprise' WHERE id=${d.tenant}`;assert.equal((await api('/api/bots','POST',{name:'협의 검증',type:'qa'})).data.code,'ENTERPRISE_LIMIT_NOT_SET');await sql`UPDATE tenants SET plan='growth' WHERE id=${d.tenant}`;});
 await check('T03-08-folderless-widget',async()=>{const r=await fetch(base+'/api/widget/'+d.bot);const body=await r.json();assert.ok(body.qaFolders.some((f:{questions:{id:string}[]})=>f.questions.some(q=>q.id===d.qa)),'관리자에 저장된 폴더 없는 Q&A가 실제 위젯 선택지에 없음')});
 await check('T07-02-fallback-retry',async()=>{const {processJobs}=await import('../lib/operations/jobs');await processJobs();const [h]=await sql`SELECT summary_status,summary FROM support_handoffs WHERE session_id=${d.session}`;assert.equal(h.summary_status,'fallback');assert.ok(h.summary.includes('배송'));});
 await check('T06-01-off',async()=>assert.equal((await pub('/api/chat/'+d.bot+'/proactive',{})).data.reason,'disabled'));
 await sql`UPDATE bots SET proactive_settings=${sql.json({enabled:true,mode:'ai',delaySeconds:30,siteOrigin:'http://127.0.0.1:3013',monthlyLimit:200})} WHERE id=${d.bot}`;
 const behavior={visitId:randomUUID(),evaluationId:randomUUID(),path:'/services',currentId:'qa-section',activeSeconds:40,sections:[{id:'qa-section',title:'배송 일정',summary:'주문 배송 일정과 제품 발송 안내',seconds:8,returns:0}]};
 await check('T06-06-origin-token',async()=>{assert.equal((await pub('/api/chat/'+d.bot+'/proactive',behavior,'wrong')).status,401);assert.equal((await pub('/api/chat/'+d.bot+'/proactive',behavior,d.token,'https://other.example')).status,403)});
 await check('T06-02-dwell',async()=>{const r=await pub('/api/chat/'+d.bot+'/proactive',{...behavior,activeSeconds:4});assert.equal(r.data.decision,'skip')});
 await check('T06-04-fallback',async()=>{const r=await pub('/api/chat/'+d.bot+'/proactive',behavior);assert.equal(r.status,200);assert.equal(r.data.decision,'offer');assert.equal(r.data.message,'제가 도와드릴까요?')});
 await check('T06-07-cooldown',async()=>{const r=await pub('/api/chat/'+d.bot+'/proactive',{...behavior,evaluationId:randomUUID(),currentId:'different',sections:[{...behavior.sections[0],id:'different'}]});assert.equal(r.data.reason,'cooldown')});
 await sql`UPDATE bots SET proactive_settings=NULL WHERE id=${d.bot}`;
 await check('T05-04-disabled',async()=>{const [saved]=await sql`SELECT request_settings FROM bots WHERE id=${d.bot}`;await sql`UPDATE bots SET request_settings=${sql.json({...saved.request_settings,quote:false,consultation:false})} WHERE id=${d.bot}`;const r=await pub('/api/chat/'+d.bot+'/requests',{kind:'consultation',name:'QA',email:'qa@example.test',message:'검증',consent:true,consentVersion:'x',idempotencyKey:randomUUID()});assert.ok(r.status>=400);await sql`UPDATE bots SET request_settings=${sql.json(saved.request_settings)} WHERE id=${d.bot}`;});
 await writeFile('/tmp/chatbot-qa-http-results.json',JSON.stringify(results,null,2));
 if(results.some(x=>x.status==='fail'))process.exitCode=1;
 console.log(JSON.stringify({passed:results.filter(x=>x.status==='pass').length,failed:results.filter(x=>x.status==='fail').length}));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>sql.end());
