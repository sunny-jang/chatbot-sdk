"use client";

import { useCallback, useEffect, useState } from "react";

type Handoff = { id:string; session_id:string; status:string; reason:string|null; bot_name:string; customer_name:string|null; assigned_agent_name:string|null; updated_at:number; last_message:string|null; telegram_topic_id:number|null };
type Message = { id:string; sender_type:string; sender_name:string|null; content:string; created_at:number };

export default function SupportPage() {
  const [items,setItems]=useState<Handoff[]>([]); const [selected,setSelected]=useState<Handoff|null>(null);
  const [messages,setMessages]=useState<Message[]>([]); const [text,setText]=useState(""); const [sending,setSending]=useState(false); const [acting,setActing]=useState(false);
  const load=useCallback(async()=>{const r=await fetch("/api/support/handoffs",{cache:"no-store"});if(r.ok)setItems(await r.json())},[]);
  const loadMessages=useCallback(async(id:string)=>{const r=await fetch(`/api/support/handoffs?sessionId=${encodeURIComponent(id)}`,{cache:"no-store"});if(r.ok)setMessages(await r.json())},[]);
  useEffect(()=>{void load();const timer=setInterval(load,5000);return()=>clearInterval(timer)},[load]);
  useEffect(()=>{if(!selected)return;void loadMessages(selected.session_id);const timer=setInterval(()=>loadMessages(selected.session_id),2500);return()=>clearInterval(timer)},[selected,loadMessages]);
  // 처리 중에는 상담 시작·종료를 다시 보내지 않습니다. (여러 번 눌러 안내 메시지가 중복 저장되던 문제)
  // 선택 시점의 값은 갱신되지 않으므로 5초마다 갱신되는 목록에서 같은 상담을 찾아 최신 상태로 판단합니다.
  const current=selected?(items.find(item=>item.id===selected.id)??selected):null;
  const canAccept=current?.status==="waiting"; const canClose=current?.status==="waiting"||current?.status==="active";
  async function action(name:"accept"|"close"){if(!selected||acting)return;setActing(true);try{await fetch("/api/support/handoffs",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:selected.session_id,action:name})});await load();await loadMessages(selected.session_id)}finally{setActing(false)}}
  // 전송 중에는 다시 보내지 않고, 누르자마자 입력칸을 비워 같은 내용이 중복 전송되지 않게 합니다.
  async function send(){if(!selected||!text.trim()||sending)return;const message=text;setSending(true);setText("");try{const r=await fetch("/api/support/handoffs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:selected.session_id,message})});if(!r.ok)setText(message);await loadMessages(selected.session_id)}finally{setSending(false)}}
  const labels:{[key:string]:string}={waiting:"대기 중",active:"상담 중",closed:"종료"};
  return <div className="max-w-6xl"><div className="mb-6"><p className="text-xs font-semibold text-violet-600">HUMAN SUPPORT</p><h1 className="text-2xl font-bold text-gray-900 mt-1">상담원 연결 관리</h1><p className="text-sm text-gray-500 mt-1">Q&A·AI 챗봇에서 이관된 고객 상담을 확인합니다.</p></div>
    <div className="grid grid-cols-[360px_1fr] gap-4 min-h-[650px]">
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden"><div className="p-4 border-b font-semibold text-sm">상담 요청 {items.length}건</div>{items.length?items.map(item=><button key={item.id} onClick={()=>setSelected(item)} className={`w-full text-left p-4 border-b hover:bg-violet-50 ${selected?.id===item.id?"bg-violet-50":""}`}><div className="flex justify-between gap-2"><b className="text-sm text-gray-900">{item.customer_name||"고객"}</b><span className={`text-xs ${item.status==="waiting"?"text-amber-600":item.status==="active"?"text-green-600":"text-gray-400"}`}>{labels[item.status]||item.status}</span></div><p className="text-xs text-gray-500 mt-1">{item.bot_name} · {item.reason||"상담 요청"}</p><p className="text-xs text-gray-400 mt-2 truncate">{item.last_message}</p></button>):<p className="p-8 text-center text-sm text-gray-400">접수된 상담이 없습니다.</p>}</section>
      <section className="bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">{selected?<><header className="p-4 border-b flex items-center justify-between"><div><b className="text-sm">세션 {selected.session_id.slice(0,8)}</b><p className="text-xs text-gray-500 mt-1">{selected.telegram_topic_id?`Telegram Topic #${selected.telegram_topic_id}`:"로컬 상담 대기열"}</p></div><div className="flex gap-2"><button type="button" onClick={()=>action("accept")} disabled={acting||!canAccept} title={canAccept?"상담을 시작합니다":current?.status==="closed"?"이미 종료된 상담입니다":"이미 상담 중입니다"} className="px-3 py-2 rounded-lg bg-violet-600 text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed">{acting&&canAccept?"처리 중":"상담 시작"}</button><button type="button" onClick={()=>action("close")} disabled={acting||!canClose} title={canClose?"상담을 종료합니다":"이미 종료된 상담입니다"} className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs disabled:opacity-40 disabled:cursor-not-allowed">상담 종료</button></div></header><div className="flex-1 overflow-y-auto p-5 space-y-3 bg-gray-50">{messages.map(m=>m.sender_type==="system"
  // 시스템 안내는 누가 보낸 말이 아니므로 가운데에 작게 표시합니다.
  ?<p key={m.id} className="text-center text-xs text-gray-400 py-1">{m.content}</p>
  // 상담원 화면이므로 내가(상담원) 보낸 답장은 오른쪽, 고객·챗봇 메시지는 왼쪽에 둡니다.
  :<div key={m.id} className={`max-w-[75%] rounded-xl px-4 py-3 text-sm ${m.sender_type==="agent"?"ml-auto bg-blue-600 text-white":m.sender_type==="customer"?"bg-white border border-gray-200 text-gray-900":"bg-gray-100 text-gray-600"}`}><p className="whitespace-pre-wrap break-words">{m.content}</p><small className={`block mt-1 opacity-70 ${m.sender_type==="agent"?"text-right":""}`}>{m.sender_name||({customer:"고객",agent:"상담원",bot:"챗봇"}[m.sender_type as "customer"|"agent"|"bot"])}</small></div>)}</div>{current?.status!=="closed"&&<div className="p-4 border-t flex gap-2"><input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key!=="Enter"||e.nativeEvent.isComposing||e.keyCode===229)return;e.preventDefault();void send()}} placeholder="고객에게 답변 입력..." className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"/><button onClick={send} disabled={sending||!text.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-40">{sending?"전송 중":"전송"}</button></div>}</>:<div className="m-auto text-center text-gray-400"><div className="text-4xl mb-3">🎧</div><p className="text-sm">왼쪽에서 상담을 선택하세요.</p></div>}</section>
    </div></div>;
}
