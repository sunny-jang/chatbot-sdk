import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {validateBehavior,candidateReason,cleanPublicText,behaviorHash,validateOffer,rankKnowledge} from "../lib/proactive-analysis";
import {normalizeProactive,excludedProactivePath} from "../lib/proactive";
import {createProactivePreview,readProactivePreview} from "../lib/proactive-preview";
const sample=()=>({visitId:randomUUID(),evaluationId:randomUUID(),path:"/services",currentId:"s-rag",activeSeconds:40,sections:[{id:"s-rag",title:"RAG 챗봇 개발",summary:"고객 문의 응대 자동화와 사내 지식 검색",seconds:25,returns:1}]});
test("기존 설정은 기본 인사 유지, AI는 명시적 모드와 사이트",()=>{assert.equal(normalizeProactive({enabled:true}).mode,"basic");assert.equal(normalizeProactive({mode:"ai",siteOrigin:"https://example.com/services"}).siteOrigin,"https://example.com");assert.equal(normalizeProactive({siteOrigin:"file:///x"}).siteOrigin,"");});
test("연락처·주소·마크업 제거",()=>{const s=cleanPublicText('<b>문의</b> user@example.com 010-1234-5678 https://example.com/?token=secret',200);assert.ok(!s.includes('@'));assert.ok(!s.includes('1234'));assert.ok(!s.includes('secret'));assert.ok(!s.includes('<b>'));});
test("관심 구간을 검증하고 개인정보를 지운다",()=>{const s=sample();s.sections[0].summary+=' user@example.com';const b=validateBehavior(s);assert.equal(b.sections.length,1);assert.ok(!b.sections[0].summary.includes('@'));assert.equal(candidateReason(b),"eligible");});
for(const [label,change] of [
  ["짧은 방문",(s:ReturnType<typeof sample>)=>{s.activeSeconds=10}],
  ["짧은 노출",(s:ReturnType<typeof sample>)=>{s.sections[0].seconds=5}],
  ["결제 화면",(s:ReturnType<typeof sample>)=>{s.path='/checkout'}],
] as const)test(label,()=>{const s=sample();change(s);assert.notEqual(candidateReason(validateBehavior(s)),"eligible")});
test("임의·과도한 요약 거절",()=>{for(const s of [{...sample(),currentId:'unknown'},{...sample(),path:'/x?secret=yes'},{...sample(),visitId:'bad'},{...sample(),sections:[{...sample().sections[0],seconds:Infinity}]},{...sample(),sections:Array(7).fill(sample().sections[0])}])assert.throws(()=>validateBehavior(s));});
test("평가 해시는 방문 ID나 누적 시간 변화로 재호출되지 않는다",()=>{const a=sample(),b=sample();b.activeSeconds=70;b.sections[0].seconds=50;assert.equal(behaviorHash(validateBehavior(a)),behaviorHash(validateBehavior(b)));b.currentId='new';b.sections[0].id='new';assert.notEqual(behaviorHash(validateBehavior(a)),behaviorHash(validateBehavior(b)));});
test("출처 없는 제안·없는 문서·숫자 약속 거절",()=>{const good={decision:'offer',message:'고객 문의 응대를 자동화하려고 알아보시는 걸까요?',intent:'discover_need',discoveryGoal:'문의 방식 확인',sourceIds:['a']};assert.equal(validateOffer(good,['a']).decision,'offer');for(const v of [{...good,sourceIds:[]},{...good,sourceIds:['other']},{...good,message:'가격은 100만원입니다?'},{...good,message:'서비스를 이용하세요.'}])assert.equal(validateOffer(v,['a']).decision,'skip');});
test("공개 구간과 관련 지식만 선택",()=>{const docs=rankKnowledge(sample().sections,[{id:'a',title:'RAG 챗봇',content:'고객 문의 응대 자동화와 사내 지식 검색을 지원합니다.'},{id:'b',title:'휴가',content:'회사 휴가 신청 기준입니다.'}]);assert.equal(docs[0].id,'a');assert.ok(!docs.some(d=>d.id==='b'));});
test("민감 경로와 관리자 지정 제외 경로",()=>{assert.equal(excludedProactivePath('/account/orders'),true);assert.equal(excludedProactivePath('/private/report','/private'),true);assert.equal(excludedProactivePath('/services'),false);});
test("테스트 토큰의 서명과 봇 범위 검증",()=>{const previous=process.env.AUTH_SECRET;process.env.AUTH_SECRET='test-signing-only';try{const token=createProactivePreview('a');assert.ok(readProactivePreview(token,'a'));assert.equal(readProactivePreview(token,'b'),null);assert.equal(readProactivePreview(token+'x','a'),null);}finally{if(previous===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=previous;}});
