import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { normalizeProactive } from '../lib/proactive';
const source = readFileSync(new URL('../public/chatbot-widget.js', import.meta.url), 'utf8');
const collector = source.slice(source.indexOf('    function installProactive()'), source.indexOf('    installProactive();'));
function harness(enabled = true, saved: unknown = null, mode = "basic") {
  let clock = 0;
  let stored = saved ? JSON.stringify(saved) : null;
  let interval: (() => void) | null = null;
  const listeners: Record<string, (event: unknown) => void> = {};
  const children: unknown[] = [];
  let storageWrites = 0;
  class Element {
    style = { cssText: '' };
    textContent = '';
    isContentEditable = false;
    attrs: Record<string,string> = {};
    events: Record<string, () => void> = {};
    closest(selector: string) { return selector === 'form' ? null : this; }
    getAttribute(name: string) { return this.attrs[name] || null; }
    setAttribute(name: string,value: string) { this.attrs[name] = value; }
    append() {}
    addEventListener(name: string, fn: () => void) { this.events[name] = fn; }
    remove() {}
  }
  const doc = { visibilityState:'visible', hasFocus:()=>true, createElement:()=>new Element(),
    addEventListener:(name:string,fn:(e:unknown)=>void)=>listeners[name]=fn,
    removeEventListener:(name:string)=>delete listeners[name],
  };
  const context = {crypto:{randomUUID},proactivePreviewToken:"",observeContentSections:()=>({rescan(){},tick(){},snapshot:()=>({currentId:"",sections:[],version:0}),cleanup(){}}),settings:{proactive:{enabled,mode,siteOrigin:"https://site.example",delaySeconds:5,message:'도와드릴까요?'}}, endpoint:'https://api.example',botId:'test',
    sessionStorage:{getItem:()=>stored,setItem:(_key:string,value:string)=>{stored=value;storageWrites++},removeItem:()=>{stored=null}},
    Date:{now:()=>clock},performance:{now:()=>clock},location:{pathname:'/services',origin:'https://site.example'},Element,
    document:doc,window:{scrollY:0,history:{pushState(){},replaceState(){}},addEventListener:(name:string,fn:(e:unknown)=>void)=>listeners[name]=fn,removeEventListener:(name:string)=>delete listeners[name]},
    root:{setAttribute:()=>{},contains:()=>false,appendChild:(el:unknown)=>children.push(el)},
    conversationRestored:true,open:false,handoffActive:false,history:[],panel:{querySelector:()=>null},togglePanel:()=>{},stopProactive:()=>{},
    setInterval:(fn:()=>void)=>{interval=fn;return 1},clearInterval:()=>{interval=null},
  };
  runInNewContext(`${collector}; installProactive();`,context);
  return {context,doc,listeners,children,Element,stored:()=>stored?JSON.parse(stored):null,writes:()=>storageWrites,
    tick:(n:number)=>{for(let i=0;i<n;i++){clock+=1000;interval?.()}},};
}
test('기본은 끄기, 문구 길이 및 지연 범위 보정',()=>{
  assert.equal(normalizeProactive(null).enabled,false);
  assert.equal(normalizeProactive({enabled:true,delaySeconds:-10,message:'x'.repeat(200)}).delaySeconds,5);
  assert.equal(normalizeProactive({delaySeconds:Infinity}).delaySeconds,30);
  assert.equal(normalizeProactive({message:'x'.repeat(200)}).message.length,120);
});
test('끄면 이벤트 수집과 타이머가 없고 기존 행동도 삭제',()=>{
  const h=harness(false,{events:[{kind:'page'}]});h.tick(30);
  assert.equal(Object.keys(h.listeners).length,0);assert.equal(h.stored(),null);assert.equal(h.children.length,0);assert.equal(h.writes(),0);
});
test('클릭 종류만 저장하고 원문·입력값 없이 지연 후 한 번 제안',()=>{
  const h=harness();const el=new h.Element();el.textContent='가격 안내 contact@example.com';
  h.listeners.click({isTrusted:true,target:el});
  assert.equal(h.stored().events.at(-1).detail,'pricing');
  assert.ok(!JSON.stringify(h.stored()).includes('contact@example.com'));
  h.tick(5);assert.equal(h.children.length,1);h.tick(20);assert.equal(h.children.length,1);
});
test('숨겨진 탭 체류는 제외, 행동이 없어도 설정한 지연 후 제안',()=>{
  const h=harness();h.doc.visibilityState='hidden';h.tick(20);assert.equal(h.stored().activeSeconds,0);
  h.doc.visibilityState='visible';h.tick(4);assert.equal(h.children.length,0);h.tick(1);assert.equal(h.children.length,1);
});
test('이미 제안했거나 대화를 시작한 방문에서는 수집·제안 반복 없음',()=>{
  for(const key of ['shown','engaged']){const h=harness(true,{updatedAt:0,[key]:true,events:[]});h.tick(20);assert.equal(h.children.length,0);assert.equal(Object.keys(h.listeners).length,0)}
});
test('SPA 이동 감지, 최근 12개 제한, 수동 열기 후 수집 중단',()=>{
  const h=harness();for(let i=0;i<20;i++){h.context.location.pathname='/service/'+i;h.context.window.history.pushState()}
  assert.equal(h.stored().events.length,12);h.context.stopProactive();assert.equal(h.stored().engaged,true);assert.equal(Object.keys(h.listeners).length,0);h.tick(20);assert.equal(h.children.length,0);
});
test('과거 대화 기록과 문서 포커스 없음은 보이는 탭의 제안을 막지 않는다',()=>{
  const h=harness();h.context.history.push({} as never);h.doc.hasFocus=()=>false;
  h.tick(10);assert.equal(h.children.length,1);
});
test('현재 상담 중에는 제안하지 않는다',()=>{
  const h=harness();h.context.handoffActive=true;h.tick(20);assert.equal(h.children.length,0);
});

test('스크롤하며 같은 구간을 읽으면 체류 누적, 다른 구간으로 이동하면 응답 무효화',()=>{
  const observed: unknown[]=[];
  let callback:(entries:unknown[])=>void=()=>{};
  const makeBlock=(title:string)=>({isConnected:true,parentElement:null,closest:()=>null,querySelectorAll:()=>[],cloneNode:()=>({textContent:title,querySelectorAll:()=>[]}),getBoundingClientRect:()=>({top:0,bottom:600,height:600})});
  const first=makeBlock('고객 응대 자동화');const second=makeBlock('홈페이지 제작');
  const headings=[first,second].map((block,i)=>({parentElement:block,textContent:i?'홈페이지 제작':'고객 응대 자동화',closest:()=>null,getClientRects:()=>[{}]}));
  const container={querySelectorAll:()=>headings};
  const ctx={document:{querySelector:()=>container,body:{},addEventListener:()=>{},removeEventListener:()=>{}},location:{pathname:'/services'},innerHeight:800,performance:{now:()=>0},Element:class{},setTimeout:()=>1,clearTimeout:()=>{},
    IntersectionObserver:class{constructor(fn:typeof callback){callback=fn;}observe(el:unknown){observed.push(el);}unobserve(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}}};
  const observerSource=source.slice(source.indexOf('  function publicSnippet('),source.indexOf('  // Remove any pre-existing widget'));
  const reader=runInNewContext(`${observerSource};observeContentSections();`,ctx);
  callback([{target:observed[0],isIntersecting:true}]);
  for(let i=0;i<15;i++)reader.tick(1);
  const before=reader.snapshot();assert.equal(before.sections[0].seconds,15);
  reader.tick(1);assert.equal(reader.snapshot().version,before.version);
  callback([{target:observed[0],isIntersecting:false},{target:observed[1],isIntersecting:true}]);reader.tick(1);
  assert.notEqual(reader.snapshot().currentId,before.currentId);assert.ok(reader.snapshot().version>before.version);
});

test('AI 관심 구간이 없으면 방문 30초 후 기본 도움 제안을 한 번 표시',()=>{
 const h=harness(true,null,"ai");h.tick(29);assert.equal(h.children.length,0);h.tick(1);assert.equal(h.children.length,1);h.tick(30);assert.equal(h.children.length,1);
});
test('기본 도움 제안도 제외 페이지와 상담 중에는 표시하지 않는다',()=>{
 const excluded=harness(true,null,"ai");excluded.context.location.pathname='/checkout';excluded.tick(40);assert.equal(excluded.children.length,0);
 const active=harness(true,null,"ai");active.context.handoffActive=true;active.tick(40);assert.equal(active.children.length,0);
});
