const SCRIPT_ID = "__ideal-ai-chatbot-sdk-script";
const WIDGET_ID = "__chatbot-widget";
const STYLE_ID = "__chatbot-widget-style";
function removeWidget() {
    document.getElementById(WIDGET_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(SCRIPT_ID)?.remove();
}
function validateOptions(options) {
    if (!options.botId?.trim())
        throw new Error("botId는 필수입니다.");
    if (!options.endpoint?.trim())
        throw new Error("endpoint는 필수입니다.");
    try {
        return new URL(options.endpoint).toString().replace(/\/$/, "");
    }
    catch {
        throw new Error("endpoint는 http 또는 https로 시작하는 올바른 URL이어야 합니다.");
    }
}
/**
 * IDEAL AI 챗봇 위젯을 현재 페이지에 설치합니다.
 */
export async function initIdealAIChatbot(options) {
    if (typeof window === "undefined" || typeof document === "undefined") {
        throw new Error("IDEAL AI Chatbot SDK는 브라우저에서만 초기화할 수 있습니다.");
    }
    const endpoint = validateOptions(options);
    const mount = () => new Promise((resolve, reject) => {
        removeWidget();
        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.async = true;
        script.src = options.scriptUrl || `${endpoint}/chatbot-widget.js`;
        script.setAttribute("data-bot-id", options.botId.trim());
        script.setAttribute("data-endpoint", endpoint);
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("IDEAL AI 챗봇 위젯을 불러오지 못했습니다."));
        document.head.appendChild(script);
    });
    await mount();
    return {
        destroy: removeWidget,
        reload: mount,
    };
}
export default initIdealAIChatbot;
//# sourceMappingURL=index.js.map