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
/**
 * IDEAL AI 챗봇 위젯을 현재 페이지에 설치합니다.
 */
export declare function initIdealAIChatbot(options: IdealAIChatbotOptions): Promise<IdealAIChatbotInstance>;
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
/** 개인정보 안내와 최신 동의 버전을 조회합니다. */
export declare function getIdealAIRequestSettings(options: IdealAIChatbotOptions): Promise<IdealAIRequestSettings>;
/** 위젯 없이 견적·상담 신청을 제출합니다. */
export declare function submitIdealAIRequest(options: IdealAIChatbotOptions, input: IdealAIRequestInput): Promise<{
    ok: true;
    receipt: string;
}>;
//# sourceMappingURL=index.d.ts.map