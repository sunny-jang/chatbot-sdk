(function () {
  // Remove any pre-existing widget to prevent duplicate instances
  const existing = document.getElementById("__chatbot-widget");
  if (existing) existing.remove();

  const script = document.currentScript;
  const botId = script.getAttribute("data-bot-id");
  const endpoint = (script.getAttribute("data-endpoint") || "").replace(/\/$/, "");

  if (!botId || !endpoint) {
    console.error("[Ideal AI Chatbot SDK] data-bot-id and data-endpoint are required");
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

    // ── Styles ────────────────────────────────────────────────────────────────
    const css = `
      #__chatbot-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      #__chatbot-fab {
        position: fixed; bottom: 24px; right: 24px; z-index: 9998;
        width: 52px; height: 52px; border-radius: 50%;
        background: ${color}; color: white; border: none; cursor: pointer;
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
        background: ${color}; color: white; padding: 14px 16px;
        display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0;
      }
      #__chatbot-header .title { font-weight: 600; font-size: 15px; }
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
      #__chatbot-input-area {
        padding: 10px 12px; border-top: 1px solid #f0f0f0;
        display: flex; gap: 8px; flex-shrink: 0;
      }
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
        <span class="title">💬 ${title}</span>
        <button class="close" aria-label="닫기">✕</button>
      </div>
      <div id="__chatbot-messages"></div>
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
    let open = false;
    let history = [];
    let sessionId = crypto.randomUUID();

    if (greeting) addMessage(greeting, "bot");

    function togglePanel() {
      open = !open;
      fab.innerHTML = open ? "✕" : "💬";
      panel.classList.toggle("open", open);
      if (open) {
        inputEl.focus();
      } else {
        // New session when widget is closed and reopened
        history = [];
        sessionId = crypto.randomUUID();
        messagesEl.innerHTML = "";
        if (greeting) addMessage(greeting, "bot");
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

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text) return;

      inputEl.value = "";
      sendBtn.disabled = true;
      addMessage(text, "user");
      const typingEl = addMessage("입력 중...", "bot typing");

      try {
        const res = await fetch(`${endpoint}/api/chat/${botId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history, sessionId }),
        });
        const data = await res.json();
        typingEl.textContent = data.reply || "오류가 발생했습니다.";
        typingEl.classList.remove("typing");
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: data.reply });
        if (history.length > 20) history = history.slice(-20);
      } catch {
        typingEl.textContent = "네트워크 오류가 발생했습니다.";
        typingEl.classList.remove("typing");
      } finally {
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    fab.addEventListener("click", togglePanel);
    closeBtn.addEventListener("click", togglePanel);
    sendBtn.addEventListener("click", sendMessage);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }
})();
