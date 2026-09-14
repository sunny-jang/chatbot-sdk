(function () {
  // Remove any pre-existing widget to prevent duplicate instances
  const existing = document.getElementById("__chatbot-widget");
  if (existing) existing.remove();
  const existingStyle = document.getElementById("__chatbot-widget-style");
  if (existingStyle) existingStyle.remove();

  const script = document.currentScript;
  const botId = script.getAttribute("data-bot-id");
  const endpoint = (script.getAttribute("data-endpoint") || "").replace(/\/$/, "");
  const botToken = script.getAttribute("data-bot-token") || "";

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
      #__chatbot-fab:hover { transform: scale(1.05); box-shadow: 0 6px 20px ${color}88; }
      #__chatbot-panel {
        position: fixed; bottom: 88px; right: 24px; z-index: 9999;
        width: 360px; height: 520px;
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
    fab.innerHTML = "💬";
    fab.setAttribute("aria-label", "채팅 열기");
    root.appendChild(fab);

    const panel = document.createElement("div");
    panel.id = "__chatbot-panel";
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
    const sessionStorageKey = `ideal-ai-session:${endpoint}:${botId}`;
    let sessionId = localStorage.getItem(sessionStorageKey) || crypto.randomUUID();
    localStorage.setItem(sessionStorageKey, sessionId);
    let handoffActive = false;
    let lastSeen = 0;
    let pollTimer = null;
    const displayedMessageIds = new Set();

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
      fab.innerHTML = open ? "✕" : "💬";
      panel.classList.toggle("open", open);
      if (open) {
        inputEl.focus();
      } else {
        // 세션과 대화는 닫아도 유지합니다. 명시적인 상담 종료 후에만 새 세션을 시작합니다.
      }
    }

    function addMessage(text, role) {
      const el = document.createElement("div");
      el.className = "cb-msg " + role;
      el.textContent = text;
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
      setComposerVisible(false);
      // Q&A 봇은 상담원 연결 전까지 직접 입력을 받지 않고, 질문 목록 선택과 상담원 연결만 제공합니다.
      const choices = qaFolders.map((folder) => ({ label: folder.name, folder }));
      if (canRequestHandoff) choices.push({ label: "상담원 연결", handoff: true });
      addChoices(choices, ({ folder, handoff }) => {
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
          answerEl.textContent = data.reply || data.error || "답변을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
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
      const nextChoices = [{ label: "다른 질문 보기", action: "folders" }];
      if (withHandoff && !handoffActive) nextChoices.push({ label: "상담원 연결", action: "handoff" });
      return addChoices(nextChoices, ({ action }) => {
        if (action === "handoff") requestHandoff(`Q&A 답변 후 상담 요청: ${question.question}`);
        else showFolderChoices();
      });
    }

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || sendBtn.disabled) return;
      if (isQaBot && !handoffActive) return;

      inputEl.value = "";
      sendBtn.disabled = true;
      addMessage(text, "user");
      if (handoffActive) {
        try { await sendHandoffMessage(text); }
        finally { sendBtn.disabled = false; inputEl.focus(); }
        return;
      }
      const typingEl = addMessage("입력 중...", "bot typing");

      try {
        const res = await fetch(`${endpoint}/api/chat/${botId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Token": botToken },
          body: JSON.stringify({ message: text, history, sessionId }),
        });
        const data = await res.json();
        if (res.ok && data.handoffActive) {
          typingEl.remove();
          enterHandoffMode(data.status, { announce: true });
          return;
        }
        typingEl.textContent = data.reply || data.error || "오류가 발생했습니다.";
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
        inputEl.focus();
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
