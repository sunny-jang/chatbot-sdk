const SCRIPT_ID = "__ideal-ai-chatbot-sdk-script";
const WIDGET_ID = "__chatbot-widget";
const STYLE_ID = "__chatbot-widget-style";

export interface IdealAIChatbotOptions {
  /** 관리자 화면에서 발급된 챗봇 ID */
  botId: string;
  /** 관리자 화면에서 발급된 공개 위젯 호출 토큰 */
  botToken: string;
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
  if (!options.botToken?.trim()) throw new Error("botToken은 필수입니다.");
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
    script.setAttribute("data-bot-token", options.botToken.trim());
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

export interface IdealAIRequestSettings {
  quote: boolean;
  consultation: boolean;
  company: boolean;
  contact: "either" | "email" | "phone";
  consentText: string;
  consentVersion: string;
  retentionDays: number;
}
export interface IdealAIRequestInput {
  kind: "quote" | "consultation";
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  message: string;
  consent: true;
  consentVersion: string;
  /** 같은 제출 재시도에는 같은 키를 사용합니다. 내용 변경 시 새 키를 사용하세요. */
  idempotencyKey: string;
  /** 이 봇의 채팅 API에서 생성된 세션만 지정합니다. */
  sessionId?: string;
}
async function requestAPI(options: IdealAIChatbotOptions, init?: RequestInit) {
  const endpoint = validateOptions(options);
  const response = await fetch(`${endpoint}/api/chat/${encodeURIComponent(options.botId)}/requests`, {
    ...init, headers: { "Content-Type": "application/json", "X-Bot-Token": options.botToken },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "신청 요청에 실패했습니다.");
  return data;
}
/** 개인정보 안내와 최신 동의 버전을 조회합니다. */
export async function getIdealAIRequestSettings(options: IdealAIChatbotOptions): Promise<IdealAIRequestSettings> {
  return requestAPI(options);
}
/** 위젯 없이 견적·상담 신청을 제출합니다. */
export async function submitIdealAIRequest(options: IdealAIChatbotOptions, input: IdealAIRequestInput): Promise<{ok: true; receipt: string}> {
  return requestAPI(options, { method: "POST", body: JSON.stringify(input) });
}
