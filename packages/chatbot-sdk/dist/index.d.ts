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
/**
 * IDEAL AI 챗봇 위젯을 현재 페이지에 설치합니다.
 */
export declare function initIdealAIChatbot(options: IdealAIChatbotOptions): Promise<IdealAIChatbotInstance>;
export default initIdealAIChatbot;
//# sourceMappingURL=index.d.ts.map