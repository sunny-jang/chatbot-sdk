const SCRIPT_ID = "__ideal-ai-chatbot-sdk-script";
const WIDGET_ID = "__chatbot-widget";
const STYLE_ID = "__chatbot-widget-style";

export interface IdealAIChatbotOptions {
  /** 관리자 화면에서 발급된 챗봇 ID */
  botId: string;
  /** IDEAL AI 서버 주소. 마지막 슬래시는 자동으로 제거됩니다. */
  endpoint: string;
  /** 자체 호스팅한 위젯 스크립트를 사용할 때만 지정합니다. */
  scriptUrl?: string;
}

export interface IdealAIChatbotInstance {
  /** 위젯을 DOM에서 제거합니다. */
  destroy(): void;
  /** 현재 설정으로 위젯을 다시 불러옵니다. */
  reload(): Promise<void>;
}

function removeWidget() {
  document.getElementById(WIDGET_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(SCRIPT_ID)?.remove();
}

function validateOptions(options: IdealAIChatbotOptions) {
  if (!options.botId?.trim()) throw new Error("botId는 필수입니다.");
  if (!options.endpoint?.trim()) throw new Error("endpoint는 필수입니다.");
  try {
    return new URL(options.endpoint).toString().replace(/\/$/, "");
  } catch {
    throw new Error("endpoint는 http 또는 https로 시작하는 올바른 URL이어야 합니다.");
  }
}

/**
 * IDEAL AI 챗봇 위젯을 현재 페이지에 설치합니다.
 */
export async function initIdealAIChatbot(
  options: IdealAIChatbotOptions,
): Promise<IdealAIChatbotInstance> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("IDEAL AI Chatbot SDK는 브라우저에서만 초기화할 수 있습니다.");
  }

  const endpoint = validateOptions(options);

  const mount = () => new Promise<void>((resolve, reject) => {
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
