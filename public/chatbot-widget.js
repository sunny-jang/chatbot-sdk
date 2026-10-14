(function () {
  function wantsQuote(message) {
    const text = message.normalize("NFKC").replace(/\s+/g, "");
    // 단순 가격 질문이나 거절에는 신청 폼을 열지 않습니다.
    if (/견적.{0,16}(필요없|원하지않|받고싶지않|받기싫|요청하지않|안받|괜찮|취소|받지않|안필요|불필요|안해|하지마)/.test(text) || /견적.{0,8}(이란|뜻|무슨뜻)/.test(text)) return false;
    return /견적.{0,16}(받고싶|받을수|받으려|받아보고|받아볼|받아야|받는방법|받으려면|받을래|받겠습니다|요청|문의|신청|부탁|주세요|주실|내줘|내주|알려|보내|가능|필요|원해|원합니다)/.test(text);
  }
  function publicSnippet(value, max) {
    return String(value || "").replace(/\b\S+@\S+\.\S+\b/g, "[연락처 제외]").replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[연락처 제외]").replace(/https?:\/\/\S+/g, "[주소 제외]").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function observeContentSections() {
    const nodes = new Map();
    const visible = new Set();
    let currentId = "", version = 0, scanTimer = null;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target);
      }
    });
    const hash = text => { let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);return `s-${(h>>>0).toString(36)}`; };
    const excluded = el => el.closest("nav,header,footer,form,[role='dialog'],[contenteditable],#__chatbot-widget,[hidden],[aria-hidden='true']");
    const scan = () => {
      scanTimer = null;
      for (const [el] of nodes) if (!el.isConnected) { observer.unobserve(el);nodes.delete(el);visible.delete(el); }
      const container = document.querySelector("main") || document.body;
      for (const heading of Array.from(container.querySelectorAll("h1,h2,h3")).slice(0,40)) {
        if (excluded(heading) || !heading.getClientRects().length) continue;
        let el = heading.parentElement;
        for(let depth=0;depth<3;depth++){
          const parent=el.parentElement;
          if(!parent||parent===container||excluded(parent)||parent.querySelectorAll("h1,h2,h3").length>1)break;
          el=parent;
        }
        if(el===container&&el.querySelectorAll("h1,h2,h3").length>1)continue;
        if(nodes.has(el)||nodes.size>=40)continue;
        const title=publicSnippet(heading.textContent,100);
        if(title.length<3)continue;
        const clone=el.cloneNode(true);clone.querySelectorAll("script,style,form,input,textarea,select,[hidden],[aria-hidden='true'],[contenteditable],nav,header,footer").forEach(n=>n.remove());
        const summary=publicSnippet(clone.textContent,200);
        const id=hash(`${location.pathname}:${title}`);
        if([...nodes.values()].some(s=>s.id===id))continue;
        nodes.set(el,{id,title,summary,seconds:0,returns:0});observer.observe(el);
      }
    };
    const mutations=new MutationObserver(records=>{
      if(records.every(r=>r.target instanceof Element&&r.target.closest("#__chatbot-widget")))return;
      if(!scanTimer)scanTimer=setTimeout(scan,1000);
    });
    mutations.observe(document.body,{childList:true,subtree:true});
    scan();
    return {
      tick(elapsed) {
        let best=null,bestArea=0;
        for(const el of visible){if(!el.isConnected||excluded(el))continue;const rect=el.getBoundingClientRect();const area=Math.max(0,Math.min(rect.bottom,innerHeight)-Math.max(rect.top,0));if(area>=Math.min(rect.height*.5,innerHeight*.25)&&area>bestArea){best=nodes.get(el);bestArea=area}}
        const next=best?.id||"";
        if(next!==currentId){currentId=next;version++;if(best)best.returns++}
        if(best)best.seconds=Math.min(3600,best.seconds+elapsed);
      },
      snapshot() { return {currentId,version,sections:[...nodes.values()].filter(s=>s.seconds>=5||s.id===currentId).sort((a,b)=>Number(b.id===currentId)-Number(a.id===currentId)||b.seconds-a.seconds).slice(0,6).map(s=>({...s,seconds:Math.floor(s.seconds)}))}; },
      rescan() { visible.clear();currentId="";version++;nodes.forEach((_s,el)=>observer.unobserve(el));nodes.clear();scan(); },
      cleanup() { observer.disconnect();mutations.disconnect();clearTimeout(scanTimer); }
    };
  }
  // Remove any pre-existing widget to prevent duplicate instances
  const existing = document.getElementById("__chatbot-widget");
  if (existing) { existing.cleanupProactive?.(); existing.remove(); }
  const existingStyle = document.getElementById("__chatbot-widget-style");
  if (existingStyle) existingStyle.remove();

  const script = document.currentScript;
  const botId = script.getAttribute("data-bot-id");
  const endpoint = (script.getAttribute("data-endpoint") || "").replace(/\/$/, "");
  const botToken = script.getAttribute("data-bot-token") || "";
  const proactivePreviewToken = script.getAttribute("data-proactive-preview") || "";
  let proactivePreviewClaims = null;
  try { if(proactivePreviewToken)proactivePreviewClaims=JSON.parse(atob(proactivePreviewToken.split(".")[0].replace(/-/g,"+").replace(/_/g,"/"))); } catch { /* Invalid preview is rejected by server. */ }

  if (!botId || !endpoint || !botToken) {
    console.error("[Ideal AI Chatbot SDK] data-bot-id, data-endpoint and data-bot-token are required");
    return;
  }

  // ── Fetch bot settings then initialize ──────────────────────────────────────
  fetch(`${endpoint}/api/widget/${botId}`)
    .then((r) => r.ok ? r.json() : {})
    .then((settings) => init(settings))
    .catch(() => init({}));

  function init(settings) {
    const color = settings.color || "#2563eb";
    const title = settings.title || "💬 Ideal AI";
    const greeting = settings.greeting || null;
    const logo = settings.logo || null;
    const fabLogo = logo || `${endpoint}/logo.png`;
    const qaFolders = settings.qaFolders || [];
    const isQaBot = settings.type === "qa";
    const supportMode = settings.supportMode || "unattended";
    // 설정이 없던 기존 응답도 켜짐으로 취급합니다.
    const qaHandoffAlways = settings.qaHandoffAlways !== false;
    // 운영 시간 밖이면 새 상담원 연결을 제공하지 않습니다. 이미 진행 중인 상담은 계속 이어집니다.
    const supportAvailable = settings.supportAvailable !== false;
    const supportHoursText = settings.supportHoursText || null;
    const supportUnavailableReason = settings.supportUnavailableReason || null;
    const canRequestHandoff = supportMode === "hybrid" && supportAvailable;

    // ── Styles ────────────────────────────────────────────────────────────────
    const css = `
      #__chatbot-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      #__chatbot-fab {
        position: fixed; bottom: 24px; right: 24px; z-index: 9998;
        width: 52px; height: 52px; border-radius: 50%;
        background: linear-gradient(135deg, #ec4899, ${color}); color: white; border: none; cursor: pointer;
        font-size: 22px; box-shadow: 0 4px 16px ${color}66;
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      #__chatbot-fab .fab-logo {
        width: 52px; height: 52px; padding: 0; border-radius: 50%;
        object-fit: cover; display: block;
      }
      #__chatbot-fab:hover { transform: scale(1.05); box-shadow: 0 6px 20px ${color}88; }
      #__chatbot-panel {
        position: fixed; bottom: 88px; right: 24px; z-index: 9999;
        width: 360px; max-width: calc(100vw - 48px); height: 520px; max-height: calc(100dvh - 112px);
        background: #fff; border-radius: 16px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.15);
        display: flex; flex-direction: column; overflow: hidden;
        transform: scale(0.9) translateY(10px); opacity: 0;
        transition: transform 0.2s, opacity 0.2s; pointer-events: none;
      }
      #__chatbot-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }
      #__chatbot-header {
        background: linear-gradient(135deg, #ec4899, ${color}); color: white; padding: 14px 16px;
        display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0;
      }
      #__chatbot-header .title { font-weight: 600; font-size: 15px; }
      #__chatbot-header .title { display: flex; align-items: center; gap: 9px; }
      #__chatbot-header .logo { width: 30px; height: 30px; border-radius: 8px; background: white; object-fit: contain; }
      #__chatbot-header .close { background: none; border: none; color: white; cursor: pointer; font-size: 18px; line-height: 1; opacity: 0.8; }
      #__chatbot-header .close:hover { opacity: 1; }
      #__chatbot-messages {
        flex: 1; overflow-y: auto; padding: 12px;
        display: flex; flex-direction: column; gap: 8px;
      }
      #__chatbot-messages::-webkit-scrollbar { width: 4px; }
      #__chatbot-messages::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 2px; }
      .cb-msg {
        max-width: 80%; padding: 9px 13px; border-radius: 12px;
        font-size: 14px; line-height: 1.5; word-break: break-word;
      }
      .cb-msg p { margin: 0 0 8px; }
      .cb-msg p:last-child { margin-bottom: 0; }
      .cb-msg strong { font-weight: 700; }
      .cb-msg em { font-style: italic; }
      .cb-msg code { padding: 1px 4px; border-radius: 4px; background: rgba(0,0,0,0.06); font-size: 0.92em; }
      .cb-msg ol, .cb-msg ul { margin: 6px 0 8px 20px; padding: 0; }
      .cb-msg li { margin: 4px 0; padding-left: 2px; }
      .cb-msg li:last-child { margin-bottom: 0; }
      .cb-msg.user { align-self: flex-end; background: ${color}; color: white; border-bottom-right-radius: 4px; }
      .cb-msg.bot { align-self: flex-start; background: #f3f4f6; color: #111; border-bottom-left-radius: 4px; }
      .cb-msg.typing { color: #9ca3af; font-style: italic; }
      .cb-choices { display: flex; flex-wrap: wrap; gap: 7px; align-self: stretch; margin: 2px 0 6px; }
      .cb-choice { padding: 8px 11px; border-radius: 999px; border: 1px solid ${color}55; background: #fff; color: ${color}; font-size: 13px; cursor: pointer; text-align: left; }
      .cb-choice:hover { background: ${color}0d; border-color: ${color}; }
      #__chatbot-input-area {
        padding: 10px 12px; border-top: 1px solid #f0f0f0;
        display: flex; gap: 8px; flex-shrink: 0;
      }
      #__chatbot-support-bar { padding: 7px 12px; border-top: 1px solid #f0f0f0; background: #fafafa; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #6b7280; }
      #__chatbot-support-bar button { border: 0; background: transparent; color: ${color}; font-size: 11px; font-weight: 600; cursor: pointer; }
      #__chatbot-input {
        flex: 1; padding: 9px 13px; border: 1.5px solid #e5e7eb;
        border-radius: 24px; font-size: 14px; outline: none;
        transition: border-color 0.15s;
      }
      #__chatbot-input:focus { border-color: ${color}; }
      #__chatbot-send {
        width: 38px; height: 38px; border-radius: 50%;
        background: ${color}; color: white; border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: background 0.15s;
      }
      #__chatbot-send:hover { filter: brightness(0.9); }
      #__chatbot-send:disabled { opacity: 0.5; cursor: default; }
    `;

    const styleEl = document.createElement("style");
    styleEl.id = "__chatbot-widget-style";
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ── DOM ───────────────────────────────────────────────────────────────────
    const root = document.createElement("div");
    root.id = "__chatbot-widget";
    document.body.appendChild(root);

    const fab = document.createElement("button");
    fab.id = "__chatbot-fab";
    fab.setAttribute("aria-label", "채팅 열기");
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-controls", "__chatbot-panel");
    const fabLogoEl = document.createElement("img");
    fabLogoEl.className = "fab-logo";
    fabLogoEl.src = fabLogo;
    fabLogoEl.alt = "";
    fabLogoEl.addEventListener("error", () => {
      fabLogoEl.remove();
      fab.appendChild(document.createTextNode("💬"));
    }, { once: true });
    fab.appendChild(fabLogoEl);
    root.appendChild(fab);

    const panel = document.createElement("div");
    panel.id = "__chatbot-panel";
    panel.setAttribute("aria-hidden", "true");
    panel.inert = true;
    panel.innerHTML = `
      <div id="__chatbot-header">
        <span class="title">${logo ? `<img class="logo" src="${logo}" alt="" />` : "💬"}<span>${title}</span></span>
        <button class="close" aria-label="닫기">✕</button>
      </div>
      <div id="__chatbot-messages"></div>
      <div id="__chatbot-support-bar" style="display:none"><span>24시간 챗봇 상담</span><button type="button">상담원 연결</button></div>
      <div id="__chatbot-input-area">
        <input id="__chatbot-input" type="text" placeholder="메시지를 입력하세요..." autocomplete="off" />
        <button id="__chatbot-send" aria-label="전송">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;
    root.appendChild(panel);

    // ── Logic ─────────────────────────────────────────────────────────────────
    const messagesEl = panel.querySelector("#__chatbot-messages");
    const inputEl = panel.querySelector("#__chatbot-input");
    const sendBtn = panel.querySelector("#__chatbot-send");
    const closeBtn = panel.querySelector(".close");
    const supportBar = panel.querySelector("#__chatbot-support-bar");
    const supportBtn = supportBar.querySelector("button");
    let open = false;
    let history = [];
    let stopProactive = () => {};
    const sessionStorageKey = `ideal-ai-session:${endpoint}:${botId}`;
    // Keep a conversation across navigations/reloads in this tab, but do not
    // resurrect an old conversation when the visitor opens a new tab/session.
    // Legacy localStorage values are deliberately ignored.
    let sessionId;
    try {
      sessionId = sessionStorage.getItem(sessionStorageKey) || crypto.randomUUID();
      sessionStorage.setItem(sessionStorageKey, sessionId);
    } catch {
      sessionId = crypto.randomUUID();
    }
    let handoffActive = false;
    let qaAiMode = false;
    let lastSeen = 0;
    let pollTimer = null;
    const displayedMessageIds = new Set();
    let conversationRestored = false;
    let proactiveContext = null;

    function installProactive() {
      const config = settings.proactive || {};
      const isAi = config.mode === "ai";
      const previewToken = isAi ? proactivePreviewToken : "";
      const diagnose = (state, data) => { root.setAttribute("data-proactive-state",state);if(previewToken&&data)root.setAttribute("data-proactive-detail",JSON.stringify(data)); };
      const storageKey = `ideal-ai-proactive:${endpoint}:${botId}${isAi ? ':ai' : ''}${previewToken ? ':'+proactivePreviewClaims?.visitId : ''}`;
      const read = () => { try { return JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { return null; } };
      const write = value => { try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Storage unavailable: current page only. */ } };
      if (config.enabled !== true) {
        try { sessionStorage.removeItem(storageKey); } catch { /* optional storage */ }
        return;
      }
      const delay = Math.min(300, Math.max(5, Number(config.delaySeconds) || 30));
      const previous = read();
      const now = Date.now();
      const valid = previous && Number.isFinite(previous.updatedAt) && now - previous.updatedAt < 30 * 60 * 1000;
      const visit = valid ? previous : { events: [], activeSeconds: 0, shown: false, engaged: false };
      visit.events = Array.isArray(visit.events) ? visit.events.slice(-12) : [];
      visit.activeSeconds = Math.max(0, Math.min(3600, Number(visit.activeSeconds) || 0));
      visit.shown = visit.shown === true;
      visit.engaged = visit.engaged === true;
      const save = () => { visit.updatedAt = Date.now(); write(visit); };
      if (visit.shown || visit.engaged) { save(); diagnose("already_shown_or_engaged"); return; }
      const isExcluded = () => /\b(login|signin|signup|account|checkout|payment|mypage|admin|cart)\b|로그인|결제|회원/i.test(location.pathname) || String(config.excludedPaths||"").split("\n").map(p=>p.trim()).filter(Boolean).some(p=>location.pathname.startsWith(p));
      if(isAi&&!previewToken&&config.siteOrigin!==location.origin){diagnose("unregistered_site");return;}
      if(isAi&&isExcluded()){diagnose("excluded_page");return;}
      const sections = isAi ? observeContentSections() : null;
      const visitId = previewToken ? proactivePreviewClaims?.visitId : visit.visitId || crypto.randomUUID();visit.visitId = visitId;
      visit.evaluations = Math.max(0, Math.min(2, Number(visit.evaluations)||0));
      let pendingAnalysis = false, abortAnalysis = null, lastAnalysis = Number(visit.lastAnalysis)||0;
      let lastInput = 0;
      const onInput = () => { lastInput = performance.now(); };
      const notify = (action, proposal) => {
        if(!isAi||!proposal?.id)return;
        fetch(`${endpoint}/api/chat/${botId}/proactive`,{method:"POST",headers:{"Content-Type":"application/json","X-Bot-Token":botToken},body:JSON.stringify({action,id:proposal.id,visitId,previewToken}),keepalive:true}).catch(()=>{});
      };
      let cleaned = false;
      let bubble = null;
      const cleanup = (removeOffer = true) => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(timer);
        abortAnalysis?.abort();
        sections?.cleanup();
        document.removeEventListener("input", onInput, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("scroll", onScroll);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("popstate", onNavigate);
        if (window.history.pushState === wrappedPush) window.history.pushState = originalPush;
        if (window.history.replaceState === wrappedReplace) window.history.replaceState = originalReplace;
        if(removeOffer)bubble?.remove();
      };
      stopProactive = () => { visit.engaged = true; save(); cleanup(); };
      root.cleanupProactive = cleanup;
      let currentPath = "";
      const safePath = () => location.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id").replace(/\d{4,}/g, ":id").slice(0, 160);
      const record = (kind, detail) => {
        if (cleaned || visit.engaged) return;
        visit.events.push({ kind, detail, at: Date.now() });
        visit.events = visit.events.slice(-12);
        save();
      };
      const onNavigate = () => {
        const path = safePath();
        if (path === currentPath) return;
        currentPath = path;
        if(sections){visit.sectionHistory=[...(visit.sectionHistory||[]),...sections.snapshot().sections].filter((s,i,a)=>a.findLastIndex(v=>v.id===s.id)===i).slice(-6);}
        sections?.rescan();abortAnalysis?.abort();if(isAi&&isExcluded())stopProactive();
        record("page", path);
      };
      const onClick = event => {
        if (!event.isTrusted || document.visibilityState !== "visible" || root.contains(event.target)) return;
        const target = event.target instanceof Element ? event.target.closest("a,button,[role='button']") : null;
        if (!target || target.closest("form") || target.isContentEditable) return;
        // Classify in memory; never store the clicked element's full text, URL or input value.
        const label = (target.getAttribute("aria-label") || target.textContent || "").trim().slice(0, 100);
        const category = /가격|요금|비용|price|pricing/i.test(label) ? "pricing"
          : /문의|견적|상담|contact|quote/i.test(label) ? "contact"
          : /서비스|상품|제품|service|product/i.test(label) ? "service" : "navigation";
        record("click", category);
      };
      let scrollRecorded = false;
      const onScroll = () => {
        if (!scrollRecorded && document.visibilityState === "visible" && window.scrollY > 200) {
          scrollRecorded = true; record("scroll", "page");
        }
      };
      const originalPush = window.history.pushState;
      const originalReplace = window.history.replaceState;
      function wrappedPush(...args) { const result = originalPush.apply(this, args); onNavigate(); return result; }
      function wrappedReplace(...args) { const result = originalReplace.apply(this, args); onNavigate(); return result; }
      window.history.pushState = wrappedPush;
      window.history.replaceState = wrappedReplace;
      let lastTick = performance.now();
      const onVisibility = () => { lastTick = performance.now(); save(); };
      const onPageHide = () => {
        if(sections)visit.sectionHistory=[...(visit.sectionHistory||[]),...sections.snapshot().sections].filter((s,i,a)=>a.findLastIndex(v=>v.id===s.id)===i).slice(-6);
        save(); cleanup();
      };
      const timer = setInterval(() => {
        const tick = performance.now();
        const elapsed = Math.min(2, Math.max(0, (tick - lastTick) / 1000));
        lastTick = tick;
        // A visible tab can be read without the document owning keyboard focus.
        if (document.visibilityState !== "visible") return;
        visit.activeSeconds += elapsed;
        sections?.tick(elapsed);
        save();
        if (!conversationRestored || open || handoffActive || panel.querySelector(".cb-request-form")) return;
        if (isAi) {
          if(visit.shown)return;
          if(!visit.evaluations)diagnose("collecting",{activeSeconds:Math.floor(visit.activeSeconds),...sections.snapshot()});
          if(pendingAnalysis)return;
          if(visit.evaluations>=2){diagnose("evaluation_limit");return;}
          if(performance.now()-lastInput<5000 || Date.now()-lastAnalysis<60000)return;
          if(isExcluded())return;
          const snapshot=sections.snapshot();const current=snapshot.sections.find(s=>s.id===snapshot.currentId);
          const prior=Array.isArray(visit.sectionHistory)?visit.sectionHistory.filter(s=>!snapshot.sections.some(v=>v.id===s.id)):[];
          snapshot.sections=[...snapshot.sections,...prior].slice(0,6);
          if(!current || current.seconds<15 || visit.activeSeconds<Math.max(30,delay))return;
          const fingerprint=JSON.stringify({path:currentPath,current:snapshot.currentId,sections:snapshot.sections.map(s=>s.id).sort()});
          if(visit.lastFingerprint===fingerprint)return;
          pendingAnalysis=true;lastAnalysis=Date.now();visit.lastAnalysis=lastAnalysis;visit.lastFingerprint=fingerprint;visit.evaluations++;save();
          diagnose("analyzing");
          const evaluationId=crypto.randomUUID();const path=currentPath;
          abortAnalysis=new AbortController();
          fetch(`${endpoint}/api/chat/${botId}/proactive`,{method:"POST",signal:abortAnalysis.signal,headers:{"Content-Type":"application/json","X-Bot-Token":botToken},body:JSON.stringify({visitId,evaluationId,sessionId,previewToken,path,currentId:snapshot.currentId,activeSeconds:Math.floor(visit.activeSeconds),sections:snapshot.sections})})
            .then(async res=>{const data=await res.json().catch(()=>({reason:"network_error"}));if(!res.ok){diagnose("error",data);return null}return data}).then(proposal=>{
              sections.tick(0);
              if(proposal?.decision==="skip")diagnose("skipped",{reason:proposal.reason});
              if(cleaned || !proposal || proposal.decision!=="offer" || document.visibilityState!=="visible" || open || handoffActive || panel.querySelector(".cb-request-form") || performance.now()-lastInput<5000 || currentPath!==path || sections.snapshot().currentId!==snapshot.currentId || sections.snapshot().version!==snapshot.version)return;
              displayOffer(proposal);
            }).catch(()=>{}).finally(()=>{pendingAnalysis=false;});
          return;
        }
        // A proactive greeting should appear after the configured visible-tab
        // delay even when the visitor has not clicked or scrolled yet.
        if (visit.activeSeconds < delay) return;
        displayOffer({message:config.message});
      }, 1000);
      function displayOffer(proposal) {
        diagnose("shown",{message:proposal.message,reason:proposal.reason,id:proposal.id});
        visit.shown = true; save();
        bubble = document.createElement("div");
        bubble.id = "__chatbot-proactive";
        bubble.style.cssText = "position:fixed;bottom:88px;right:24px;z-index:9998;display:flex;align-items:start;gap:4px;max-width:calc(100vw - 48px);background:white;color:#242134;border:1px solid #dedbe8;border-radius:14px;padding:8px;box-shadow:0 6px 24px #0002";
        const offer = document.createElement("button");offer.type = "button";
        offer.textContent = String(proposal.message || "제가 좀 도와드릴까요?").slice(0, 120);
        offer.style.cssText = "background:none;border:0;color:inherit;padding:9px 10px;text-align:left;white-space:normal;overflow-wrap:anywhere;font:inherit;font-size:14px;cursor:pointer";
        const dismiss = document.createElement("button");dismiss.type = "button";dismiss.textContent = "✕";dismiss.setAttribute("aria-label", "도움 제안 닫기");
        dismiss.style.cssText = "background:none;border:0;color:#555;padding:10px;cursor:pointer";
        offer.addEventListener("click", () => {
          notify("clicked",proposal);bubble.remove();
          if(isAi&&proposal.id){proactiveContext={id:proposal.id,visitId};if(!history.length&&!handoffActive)messagesEl.replaceChildren();addMessage(proposal.message,"bot");history.push({role:"assistant",content:proposal.message});if(isQaBot){qaAiMode=true;setComposerVisible(true);}}
          if (!open) togglePanel();
        });
        dismiss.addEventListener("click", () => {notify("dismissed",proposal);stopProactive();bubble.remove();});
        bubble.append(offer, dismiss);root.appendChild(bubble);
        notify("shown",proposal);
        // Keep a lightweight section watcher until the offer is acted on. It may
        // disappear if the visitor moves to another topic, but never reappear.
        if(isAi){const original=snapshotCurrent();const watcher=setInterval(()=>{if(open||document.visibilityState!=="visible")return;sections?.tick(0);if(snapshotCurrent()!==original){bubble?.remove();clearInterval(watcher)}},1000);const oldCleanup=root.cleanupProactive;root.cleanupProactive=()=>{clearInterval(watcher);oldCleanup?.()};stopProactive=()=>{visit.engaged=true;save();clearInterval(watcher);cleanup();};}
        clearInterval(timer);
        document.removeEventListener("click",onClick,true);document.removeEventListener("input",onInput,true);
        if(!isAi)cleanup(false);
      }
      function snapshotCurrent(){return sections?.snapshot().currentId||"";}
      document.addEventListener("click", onClick, true);
      document.addEventListener("scroll", onScroll, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      if(isAi)document.addEventListener("input",onInput,true);
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("popstate", onNavigate);
      onNavigate();
    }
    installProactive();

    // 견적·상담 신청은 실시간 상담과 별개로 접수합니다.
    const requestBar = document.createElement("div");
    requestBar.style.cssText = "display:none;flex-wrap:wrap;gap:8px;padding:8px 12px;border-top:1px solid #eee";
    panel.insertBefore(requestBar, supportBar);
    let requestSettings = null;
    async function loadRequestSettings() {
      try {
        const response = await fetch(`${endpoint}/api/chat/${botId}/requests`, {headers:{"X-Bot-Token":botToken}});
        if (!response.ok) return;
        requestSettings = await response.json();
        requestBar.replaceChildren();
        // 견적 폼은 관리자에서 활성화하고 고객이 견적 의사를 말했을 때만 엽니다.
        for (const [kind,label] of [["consultation","상담 신청"]]) {
          if (!requestSettings[kind]) continue;
          const button = document.createElement("button"); button.type="button"; button.className="cb-choice"; button.textContent=label;
          button.addEventListener("click",()=>openRequestForm(kind,label));requestBar.appendChild(button);
        }
        requestBar.style.display = requestBar.childElementCount ? "flex" : "none";
      } catch { requestBar.style.display="none"; }
    }
    function openRequestForm(kind,label,initialMessage = "") {
      panel.querySelector(".cb-request-form")?.remove();
      const form=document.createElement("form");form.className="cb-request-form";form.setAttribute("role","dialog");form.setAttribute("aria-modal","true");form.setAttribute("aria-label",label);
      form.style.cssText="position:absolute;inset:58px 0 0;background:white;z-index:5;padding:16px;overflow:auto;display:flex;flex-direction:column;gap:10px";
      const heading=document.createElement("h3");heading.textContent=label;heading.style.margin="0";form.appendChild(heading);
      const close=document.createElement("button");close.type="button";close.textContent="닫기";close.className="cb-choice";close.style.alignSelf="flex-end";close.onclick=()=>{form.remove();inputEl.focus()};form.appendChild(close);
      const fields={};
      for(const [key,name,type,required,max] of [["name","이름","text",true,100],["company","회사명 (선택)","text",false,200],["email","이메일","email",requestSettings.contact==="email",254],["phone","전화번호","tel",requestSettings.contact==="phone",40],["message","문의 내용","textarea",true,5000]]) {
        if(key==="company"&&!requestSettings.company)continue;
        const wrapper=document.createElement("label");wrapper.textContent=name+(required?" *":"");wrapper.style.cssText="display:flex;flex-direction:column;gap:4px;font-size:13px";
        const field=document.createElement(type==="textarea"?"textarea":"input");if(type!=="textarea")field.type=type;else field.rows=4;
        field.required=required;field.maxLength=max;field.name=key;field.style.cssText="border:1px solid #ddd;border-radius:8px;padding:9px;font:inherit;min-width:0";wrapper.appendChild(field);form.appendChild(wrapper);fields[key]=field;
      }
      fields.message.value = initialMessage.slice(0, 5000);
      if(requestSettings.contact==="either"){const hint=document.createElement("small");hint.textContent="이메일 또는 전화번호 중 하나를 입력해주세요.";form.appendChild(hint)}
      const policy=document.createElement("p");policy.textContent=requestSettings.consentText;policy.style.cssText="white-space:pre-wrap;font-size:12px;background:#f9fafb;padding:10px";form.appendChild(policy);
      const agreement=document.createElement("label"),consent=document.createElement("input");consent.type="checkbox";consent.required=true;agreement.append(consent,document.createTextNode(" 개인정보 수집·이용에 동의합니다."));agreement.style.fontSize="12px";form.appendChild(agreement);
      const notice=document.createElement("p");notice.setAttribute("role","status");notice.style.cssText="font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere";form.appendChild(notice);
      const submit=document.createElement("button");submit.type="submit";submit.className="cb-choice";submit.textContent="신청 접수";form.appendChild(submit);
      let pending=false;let key=crypto.randomUUID();let previousPayload="";
      form.addEventListener("submit",async event=>{
        event.preventDefault();if(pending)return;
        const values=Object.fromEntries(Object.entries(fields).map(([name,input])=>[name,input.value.trim()]));
        if(!values.email&&!values.phone){notice.textContent="이메일 또는 전화번호를 입력해주세요.";fields.email.focus();return}
        const payload=JSON.stringify(values);if(previousPayload&&payload!==previousPayload)key=crypto.randomUUID();previousPayload=payload;
        pending=true;submit.disabled=true;notice.textContent="접수 중...";
        try{
          // 첫 대화 전에는 존재하지 않는 세션을 연결하지 않습니다.
          const check=await fetch(`${endpoint}/api/chat/${botId}/handoff?sessionId=${encodeURIComponent(sessionId)}&after=0`,{headers:{"X-Bot-Token":botToken}});
          const session=check.ok?await check.json():null;
          const res=await fetch(`${endpoint}/api/chat/${botId}/requests`,{method:"POST",headers:{"Content-Type":"application/json","X-Bot-Token":botToken},body:JSON.stringify({...values,kind,consent:consent.checked,consentVersion:requestSettings.consentVersion,idempotencyKey:key,sessionId:session?.exists?sessionId:null})});
          const data=await res.json();if(!res.ok)throw Error(data.error||"접수하지 못했습니다.");
          notice.textContent=`신청을 접수했습니다.\n접수번호: ${data.receipt}`;submit.remove();for(const input of Object.values(fields))input.disabled=true;consent.disabled=true;
        }catch(error){notice.textContent=error.message||"접수에 실패했습니다. 다시 시도해주세요.";submit.disabled=false}finally{pending=false}
      });
      form.addEventListener("keydown",event=>{
        if(event.key==="Escape"){event.preventDefault();form.remove();inputEl.focus()}
        if(event.key==="Tab"){
          const elements=Array.from(form.querySelectorAll("input,textarea,button")).filter(el=>!el.disabled);
          const first=elements[0],last=elements[elements.length-1];
          if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
          if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
        }
      });
      panel.appendChild(form);fields.name.focus();
    }
    const requestSettingsReady = loadRequestSettings();
    async function offerQuoteFromMessage(text) {
      if (!wantsQuote(text)) return;
      await requestSettingsReady;
      if (requestSettings?.quote && !panel.querySelector(".cb-request-form")) {
        openRequestForm("quote", "견적 요청", text);
      }
    }
    function focusComposer() {
      if (!panel.querySelector(".cb-request-form")) inputEl.focus();
    }

    function setComposerVisible(visible) {
      inputEl.parentElement.style.display = visible ? "flex" : "none";
      if (visible && open) inputEl.focus();
    }

    if (greeting) addMessage(greeting, "bot");
    if (isQaBot) {
      setComposerVisible(false);
      showFolderChoices();
    }
    if (supportMode === "hybrid") {
      supportBar.style.display = "flex";
      if (!supportAvailable) showOutsideHoursBar();
    }

    function showOutsideHoursBar() {
      supportBar.querySelector("span").textContent = supportUnavailableReason === "forced"
        ? "현재 챗봇 상담만 운영 중입니다"
        : supportHoursText ? `상담원 연결 가능 시간: ${supportHoursText}` : "지금은 상담원 연결 가능 시간이 아닙니다";
      supportBtn.style.display = "none";
    }
    restoreConversation();

    function togglePanel() {
      open = !open;
      if (open) {
        stopProactive();
        root.querySelector("#__chatbot-proactive")?.remove();
        fab.replaceChildren(document.createTextNode("✕"));
      } else if (!fab.querySelector(".fab-logo")) {
        const restoredLogo = document.createElement("img");
        restoredLogo.className = "fab-logo";
        restoredLogo.src = fabLogo;
        restoredLogo.alt = "";
        restoredLogo.addEventListener("error", () => {
          restoredLogo.remove();
          fab.appendChild(document.createTextNode("💬"));
        }, { once: true });
        fab.replaceChildren(restoredLogo);
      }
      panel.classList.toggle("open", open);
      panel.setAttribute("aria-hidden", String(!open));
      panel.inert = !open;
      fab.setAttribute("aria-expanded", String(open));
      fab.setAttribute("aria-label", open ? "채팅 닫기" : "채팅 열기");
      if (open) {
        if (inputEl.parentElement.style.display !== "none") inputEl.focus();
        else (panel.querySelector(".cb-choice") || closeBtn).focus();
      } else {
        // 세션과 대화는 닫아도 유지합니다. 명시적인 상담 종료 후에만 새 세션을 시작합니다.
      }
    }

    function appendInlineMarkdown(parent, text) {
      const tokenPattern = /(\*\*|__)(.+?)\1|(?<!\*)\*([^*\n]+?)\*(?!\*)|(?<!_)_([^_\n]+?)_(?!_)|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
      let cursor = 0;
      let match;

      while ((match = tokenPattern.exec(text))) {
        if (match.index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));

        if (match[2]) {
          const strong = document.createElement("strong");
          strong.textContent = match[2];
          parent.appendChild(strong);
        } else if (match[3] || match[4]) {
          const emphasis = document.createElement("em");
          emphasis.textContent = match[3] || match[4];
          parent.appendChild(emphasis);
        } else if (match[5]) {
          const code = document.createElement("code");
          code.textContent = match[5];
          parent.appendChild(code);
        } else if (match[6] && match[7]) {
          const link = document.createElement("a");
          link.href = match[7];
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = match[6];
          parent.appendChild(link);
        }

        cursor = match.index + match[0].length;
      }

      if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)));
    }

    function renderMarkdown(parent, markdown) {
      parent.replaceChildren();
      const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
      let index = 0;

      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
          index += 1;
          continue;
        }

        const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
        const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
        if (ordered || unordered) {
          const list = document.createElement(ordered ? "ol" : "ul");
          while (index < lines.length) {
            const current = lines[index];
            const item = current.match(ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/);
            if (!item) break;
            const li = document.createElement("li");
            appendInlineMarkdown(li, item[1]);
            list.appendChild(li);
            index += 1;
          }
          parent.appendChild(list);
          continue;
        }

        const heading = line.match(/^\s{0,3}#{1,3}\s+(.+)$/);
        const block = document.createElement(heading ? "strong" : "p");
        appendInlineMarkdown(block, heading ? heading[1] : line);
        parent.appendChild(block);
        index += 1;
      }
    }

    function addMessage(text, role) {
      const el = document.createElement("div");
      el.className = "cb-msg " + role;
      if (role === "bot" || role === "assistant") renderMarkdown(el, text);
      else el.textContent = text;
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return el;
    }

    function addChoices(items, onChoose) {
      const wrap = document.createElement("div");
      wrap.className = "cb-choices";
      items.forEach((item) => {
        const button = document.createElement("button");
        button.className = "cb-choice";
        button.textContent = item.label;
        button.addEventListener("click", () => { wrap.remove(); onChoose(item); });
        wrap.appendChild(button);
      });
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return wrap;
    }

    function showFolderChoices() {
      qaAiMode = false;
      setComposerVisible(false);
      // Q&A 봇은 상담원 연결 전까지 직접 입력을 받지 않고, 질문 목록 선택과 상담원 연결만 제공합니다.
      const choices = qaFolders.map((folder) => ({ label: folder.name, folder }));
      choices.push({ label: "AI에게 질문하기", ai: true });
      if (canRequestHandoff) choices.push({ label: "상담원 연결", handoff: true });
      addChoices(choices, ({ folder, handoff, ai }) => {
        if (ai) {
          qaAiMode = true;
          addMessage("궁금한 내용을 입력해주세요. 등록된 문서를 바탕으로 AI가 답변합니다.", "bot");
          setComposerVisible(true);
          inputEl.placeholder = "AI에게 질문하세요...";
          return;
        }
        if (handoff) {
          requestHandoff("고객이 상담원 연결을 선택했습니다.");
          return;
        }
        addMessage(folder.name, "user");
        addChoices(folder.questions.map((question) => ({ label: question.question, question })), ({ question }) => {
          sendSelectedQuestion(question);
        });
      });
    }

    async function sendSelectedQuestion(question) {
      void offerQuoteFromMessage(question.question);
      if (handoffActive) {
        addMessage(question.question, "user");
        await sendHandoffMessage(question.question);
        return;
      }
      addMessage(question.question, "user");
      // 답은 위젯 설정으로 이미 받아두었으므로 즉시 표시합니다. 대화 기록·월 세션 차감은 뒤이어 서버에서 처리합니다.
      const answerEl = addMessage(question.answer, "bot");
      let choicesEl = addAnswerChoices(question, canRequestHandoff && qaHandoffAlways);
      try {
        const res = await fetch(`${endpoint}/api/chat/${botId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Token": botToken },
          body: JSON.stringify({ message: question.question, qaId: question.id, sessionId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.handoffActive) {
          // 다른 탭 등에서 이미 상담이 진행 중인 세션이면 상담 모드로 전환합니다.
          enterHandoffMode(data.status, { announce: true });
          return;
        }
        if (!res.ok) {
          // 월 세션 한도 초과·구독 중지·삭제된 질문 등 서버가 막은 경우 답 대신 서버 안내를 보여줍니다.
          renderMarkdown(answerEl, data.reply || data.error || "답변을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
          if (choicesEl.isConnected) {
            choicesEl.remove();
            choicesEl = addAnswerChoices(question, false);
          }
          return;
        }
        // "항상 표시"가 꺼져 있으면 서버가 답변 부족으로 판정한 경우에만 상담원 연결을 추가합니다.
        if (!qaHandoffAlways && canRequestHandoff && data.handoffAvailable && choicesEl.isConnected && !handoffActive) {
          choicesEl.remove();
          choicesEl = addAnswerChoices(question, true);
        }
      } catch {
        // 네트워크 실패: 답은 이미 표시되어 있으므로 그대로 두고, 기록만 누락됩니다.
      }
    }

    function addAnswerChoices(question, withHandoff) {
      const nextChoices = [{ label: "다른 질문 보기", action: "folders" }, { label: "AI에게 질문하기", action: "ai" }];
      if (withHandoff && !handoffActive) nextChoices.push({ label: "상담원 연결", action: "handoff" });
      return addChoices(nextChoices, ({ action }) => {
        if (action === "handoff") requestHandoff(`Q&A 답변 후 상담 요청: ${question.question}`);
        else if (action === "ai") {
          qaAiMode = true;
          addMessage("추가 질문을 입력해주세요. 등록된 문서를 바탕으로 AI가 답변합니다.", "bot");
          setComposerVisible(true);
          inputEl.placeholder = "AI에게 질문하세요...";
        } else showFolderChoices();
      });
    }

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || sendBtn.disabled) return;
      if (isQaBot && !handoffActive && !qaAiMode) return;

      inputEl.value = "";
      sendBtn.disabled = true;
      addMessage(text, "user");
      void offerQuoteFromMessage(text);
      if (handoffActive) {
        try { await sendHandoffMessage(text); }
        finally { sendBtn.disabled = false; focusComposer(); }
        return;
      }
      const typingEl = addMessage("입력 중...", "bot typing");

      try {
        const res = await fetch(`${endpoint}/api/chat/${botId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Token": botToken },
          body: JSON.stringify({ message: text, history, sessionId, proactiveContext, mode: isQaBot && qaAiMode ? "rag-ai" : undefined }),
        });
        const data = await res.json();
        if (res.ok && data.handoffActive) {
          typingEl.remove();
          enterHandoffMode(data.status, { announce: true });
          return;
        }
        renderMarkdown(typingEl, data.reply || data.error || "오류가 발생했습니다.");
        typingEl.classList.remove("typing");
        if (res.ok && data.reply) {
          history.push({ role: "user", content: text });
          history.push({ role: "assistant", content: data.reply });
          if (history.length > 20) history = history.slice(-20);
          if (data.handoffAvailable) addChoices([{ label: "상담원에게 문의하기" }], () => requestHandoff("챗봇 답변 부족"));
        }
      } catch {
        typingEl.textContent = "네트워크 오류가 발생했습니다.";
        typingEl.classList.remove("typing");
      } finally {
        sendBtn.disabled = false;
        focusComposer();
      }
    }

    async function requestHandoff(reason) {
      if (handoffActive) return;
      supportBtn.disabled = true;
      // 요청이 처리되는 동안 입력한 메시지가 챗봇으로 가지 않도록 입력을 잠급니다.
      inputEl.disabled = true;
      sendBtn.disabled = true;
      messagesEl.querySelectorAll(".cb-choices").forEach((el) => el.remove());
      addMessage("상담원을 연결하고 있습니다. 잠시만 기다려주세요.", "bot");
      try {
        const res = await fetch(`${endpoint}/api/chat/${botId}/handoff`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Bot-Token": botToken },
          body: JSON.stringify({ sessionId, reason }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "상담 연결에 실패했습니다.");
        enterHandoffMode(data.handoff?.status || "waiting", { announce: true });
      } catch (error) {
        addMessage(error.message || "상담 연결에 실패했습니다.", "bot");
        supportBtn.disabled = false;
        if (isQaBot) showFolderChoices();
      } finally {
        inputEl.disabled = false;
        sendBtn.disabled = false;
      }
    }

    // 상담 대기·상담 중 상태로 전환합니다. 이후 입력은 챗봇이 아니라 상담원에게 전달됩니다.
    function enterHandoffMode(status, { announce = false } = {}) {
      const wasActive = handoffActive;
      handoffActive = true;
      messagesEl.querySelectorAll(".cb-choices").forEach((el) => el.remove());
      supportBar.style.display = "flex";
      supportBar.querySelector("span").textContent = status === "human" ? "상담원 상담 중" : "상담원 연결 대기 중";
      supportBtn.style.display = "none";
      setComposerVisible(true);
      if (announce && !wasActive && status !== "human") {
        addMessage("상담 요청이 접수되었습니다. 곧 상담원이 연결됩니다. 기다리시는 동안 남겨주신 메시지는 상담원에게 바로 전달됩니다.", "bot");
      }
      // 화면에 이미 보이는 챗봇 답변·시스템 메시지를 폴링이 다시 그리지 않도록, 현재까지의 메시지를 표시 완료로 기록합니다.
      if (announce && !wasActive) markExistingMessagesSeen().finally(startPolling);
      else startPolling();
    }

    async function markExistingMessagesSeen() {
      try {
        const res = await fetch(`${endpoint}/api/chat/${botId}/handoff?sessionId=${encodeURIComponent(sessionId)}&after=0`, { headers: { "X-Bot-Token": botToken } });
        if (!res.ok) return;
        const data = await res.json();
        (data.messages || []).forEach((item) => displayedMessageIds.add(item.id));
        if (data.messages?.length) lastSeen = Math.max(lastSeen, ...data.messages.map((item) => Number(item.created_at) || 0));
      } catch { /* 실패하면 기존처럼 폴링만 진행합니다. */ }
    }

    async function sendHandoffMessage(text) {
      try {
        const res = await fetch(`${endpoint}/api/chat/${botId}/handoff/message`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Bot-Token": botToken },
          body: JSON.stringify({ sessionId, message: text }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          addMessage(data.error || "메시지 전송에 실패했습니다. 잠시 후 다시 시도해주세요.", "bot");
        }
      } catch {
        addMessage("메시지 전송에 실패했습니다. 잠시 후 다시 시도해주세요.", "bot");
      }
    }

    async function restoreConversation() {
      try {
        const res = await fetch(`${endpoint}/api/chat/${botId}/handoff?sessionId=${encodeURIComponent(sessionId)}&after=0`, { headers: { "X-Bot-Token": botToken } });
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages && data.messages.length) {
          messagesEl.innerHTML = "";
          data.messages.forEach(renderStoredMessage);
          history = data.messages.filter((item) => item.sender_type === "customer" || item.sender_type === "bot").map((item) => ({
            role: item.sender_type === "customer" ? "user" : "assistant",
            content: item.content,
          })).slice(-20);
          lastSeen = Math.max(...data.messages.map((item) => Number(item.created_at) || 0));
        }
        if (data.status === "waiting" || data.status === "human") {
          enterHandoffMode(data.status);
          if (data.status === "human") supportBar.querySelector("span").textContent = `${data.assigned_agent_name || "상담원"} 상담 중`;
        } else if (isQaBot && data.messages?.length) {
          showFolderChoices();
        }
      } catch { /* 복원 실패는 새 상담 이용을 막지 않습니다. */ }
      finally {
        conversationRestored = true;
        // Restored bot history is not an ongoing conversation in this visit.
        if (handoffActive) stopProactive();
      }
    }

    function renderStoredMessage(item) {
      if (displayedMessageIds.has(item.id)) return;
      displayedMessageIds.add(item.id);
      const role = item.sender_type === "customer" ? "user" : "bot";
      // 상담원 이름("관리자: ")을 붙이지 않고 내용만 표시합니다. 상담 중 여부는 상단 바에 표시됩니다.
      addMessage(item.content, role);
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(`${endpoint}/api/chat/${botId}/handoff?sessionId=${encodeURIComponent(sessionId)}&after=${Math.max(0, lastSeen - 1)}`, { headers: { "X-Bot-Token": botToken } });
          if (!res.ok) return;
          const data = await res.json();
          (data.messages || []).filter((item) => item.sender_type !== "customer").forEach(renderStoredMessage);
          if (data.messages?.length) lastSeen = Math.max(lastSeen, ...data.messages.map((item) => Number(item.created_at) || 0));
          if (data.status === "human") supportBar.querySelector("span").textContent = `${data.assigned_agent_name || "상담원"} 상담 중`;
          if (data.status === "closed") {
            handoffActive = false;
            clearInterval(pollTimer); pollTimer = null;
            supportBar.querySelector("span").textContent = "상담 종료";
            supportBtn.style.display = "inline"; supportBtn.disabled = false;
            if (!supportAvailable) showOutsideHoursBar();
            addMessage("상담이 종료되었습니다. 추가 문의는 챗봇이나 상담원 연결을 이용해주세요.", "bot");
            if (isQaBot) showFolderChoices();
          }
        } catch { /* 다음 폴링에서 재시도 */ }
      }, 2500);
    }

    fab.addEventListener("click", togglePanel);
    closeBtn.addEventListener("click", togglePanel);
    sendBtn.addEventListener("click", sendMessage);
    supportBtn.addEventListener("click", () => requestHandoff("고객이 상담원 연결을 선택했습니다."));
    inputEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      sendMessage();
    });
  }
})();
