"use client";
import { useEffect, useRef, useState } from "react";

type Usage={evaluations:number;input_tokens:number;output_tokens:number;shown:number;clicked:number};
type Sample={title:string;content:string};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const states:Record<string,string>={collecting:"콘텐츠 구간 감지 중",analyzing:"AI가 상담 질문을 만들고 있습니다",shown:"제안 표시",skipped:"지금은 제안하지 않음",error:"요청을 처리하지 못함",already_shown_or_engaged:"이미 표시했거나 대화를 시작한 방문",excluded_page:"분석 제외 페이지",unregistered_site:"등록되지 않은 사이트"};
const reasons:Record<string,string>={not_helpful:"관련 도움을 제안하기 어려운 상황",no_knowledge:"관련 등록 지식을 찾지 못했습니다",missing_key:"API 키가 없어 기본 인사로 대체",provider_error:"모델 요청 실패로 기본 인사 대체",provider_timeout_or_invalid_output:"모델 지연 또는 응답 형식 오류로 기본 인사 대체",monthly_limit:"월 평가 한도 도달",visit_limit:"방문당 평가 한도 도달",cooldown:"다음 평가까지 대기",short_visit:"방문 체류 시간 부족",short_section:"같은 설명 구간의 노출 시간 부족",invalid_evidence:"질문 또는 근거 검증 실패",processing:"처리 중인 평가",unsafe_message:"제안 문구 검증 실패",grounded_question:"등록 지식에 근거한 상담 질문"};

export default function ProactiveTest({botId}:{botId:string}){
  const frame=useRef<HTMLIFrameElement>(null);
  const [source,setSource]=useState(""),[usage,setUsage]=useState<Usage|null>(null),[samples,setSamples]=useState<Sample[]>([]),[status,setStatus]=useState(""),[detail,setDetail]=useState(""),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false);
  const [activeSeconds,setActiveSeconds]=useState(0),[sections,setSections]=useState<{title:string;seconds:number}[]>([]);
  async function load(){const res=await fetch(`/api/bots/${botId}/proactive`);if(!res.ok)return;const d=await res.json();setUsage(d.usage);setSamples(d.samples);setEnabled(d.config.enabled&&d.config.mode==="ai");}
  useEffect(()=>{const timer=setTimeout(()=>{void load()},0);return()=>clearTimeout(timer)},[botId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{function receive(event:MessageEvent){if(event.source!==frame.current?.contentWindow||event.data?.type!=="proactive-preview")return;setStatus(states[event.data.state]||event.data.state);const data=event.data.detail||{};setDetail(data.message||reasons[data.reason]||data.error||"");if(typeof data.activeSeconds==="number")setActiveSeconds(data.activeSeconds);if(Array.isArray(data.sections))setSections(data.sections);}window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive)},[]);
  async function start(){
    setBusy(true);setSource("");setStatus("테스트 준비 중");setDetail("");setActiveSeconds(0);setSections([]);
    try{
      const res=await fetch(`/api/bots/${botId}/proactive`,{method:"POST"});const d=await res.json();if(!res.ok)throw Error(d.error);if(!d.config.enabled||d.config.mode!=="ai")throw Error("챗봇 설정에서 상황별 AI 제안을 켜고 저장해주세요.");
      const endpoint=window.location.origin;
      const blocks=samples.length?samples:[{title:"등록 자료 없음",content:"문서나 Q&A에 업체의 서비스 설명을 등록한 뒤 시험해주세요."}];
      const markup=blocks.map(s=>`<section style="padding:26px 12px;min-height:360px"><h2>${escape(s.title)}</h2><p>${escape(s.content)}</p><p>이 설명 구간에 머물거나 아래로 스크롤하여 다른 구간을 확인하세요.</p></section>`).join("");
      setSource(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:24px;background:#faf9fe;font:16px/1.7 system-ui"><h1>상담형 제안 테스트</h1><p>등록된 자료 일부로 구성한 테스트 페이지입니다. 대화를 보내면 실제 기록과 대화 사용량에 반영됩니다.</p><main>${markup}</main><script>setInterval(()=>{const el=document.getElementById('__chatbot-widget');if(!el)return;let detail={};try{detail=JSON.parse(el.getAttribute('data-proactive-detail')||'{}')}catch{}parent.postMessage({type:'proactive-preview',state:el.getAttribute('data-proactive-state')||'collecting',detail},${JSON.stringify(endpoint)})},1000)</script><script src="${escape(endpoint)}/chatbot-widget.js" data-bot-id="${escape(botId)}" data-bot-token="${escape(d.botToken)}" data-proactive-preview="${escape(d.token)}" data-endpoint="${escape(endpoint)}"></script></body></html>`);
    }catch(e){setStatus(e instanceof Error?e.message:"테스트를 시작하지 못했습니다.")}finally{setBusy(false);void load()}
  }
  return <section className="mt-6 bg-white border border-gray-200 rounded-xl p-5 space-y-4">
    <h2 className="text-lg font-semibold">상황별 AI 제안 테스트</h2>
    <p className="text-sm text-gray-600">같은 설명 구간에 최소 5초, 전체 방문에 최소 30초 머물면 AI가 판단합니다. 테스트 다시 시작은 고객 대화를 삭제하지 않고 새 테스트 방문만 만듭니다. 테스트도 모델 비용과 AI 평가 한도에 포함됩니다.</p>
    {usage&&<p className="text-sm">이번 달 평가 {usage.evaluations}회 · 노출 {usage.shown}회 · 클릭 {usage.clicked}회 · 입력/출력 토큰 {usage.input_tokens}/{usage.output_tokens}</p>}
    <div className="flex gap-2"><button type="button" onClick={start} disabled={busy||!enabled} className="bg-violet-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">{source?"테스트 다시 시작":"테스트 시작"}</button><button type="button" onClick={()=>void load()} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">사용량 새로고침</button></div>
    {!enabled&&<p className="text-sm text-gray-600">챗봇 설정에서 상황별 AI 제안을 켜고 저장한 뒤 사용하세요.</p>}
    {status&&<div role="status" aria-live="polite" className="bg-gray-50 p-3 rounded-lg text-sm"><strong>{status}</strong>{detail&&<p className="mt-1">{detail}</p>}{source&&<p className="mt-1">체류 {activeSeconds}초 {sections.map(s=>` / ${s.title}: ${s.seconds}초`).join("")}</p>}</div>}
    {source&&<iframe ref={frame} srcDoc={source} title="상담형 AI 제안 테스트 페이지" className="w-full border border-gray-200 rounded-lg" style={{height:640}} />}
  </section>;
}
