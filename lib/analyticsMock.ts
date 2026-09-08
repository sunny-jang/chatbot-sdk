const dailyMessages = [438,472,451,506,529,488,552,574,541,603,618,586,642,671,633,692,718,681,735,756,709,772,801,748,824,857,812,883,916,894];

export function createAnalyticsMockData() {
  const now = Math.floor(Date.now() / 1000);
  const daily = dailyMessages.map((messages, index) => {
    const date = new Date(Date.now() - (dailyMessages.length - 1 - index) * 86400000).toISOString().slice(0, 10);
    return { date, messages, conversations: Math.round(messages * 0.67), refusals: Math.round(messages * 0.032) };
  });
  const samples = [
    ["session-a1", "제품 카탈로그의 모터 정격 출력과 사용 전압을 알려주세요.", "해당 모델은 정격 출력 7.5kW, 사용 전압 380V입니다.", "제품·사양", false],
    ["session-a1", "방진 등급도 같이 확인해 주세요.", "표준 사양의 방진 등급은 IP55이며 옵션으로 IP66을 지원합니다.", "제품·사양", false],
    ["session-b2", "500대 기준 납품 견적을 받을 수 있을까요?", "수량별 단가 확인을 위해 담당 영업팀에 견적 요청을 연결하겠습니다.", "견적·가격", false],
    ["session-c3", "다음 주 금요일까지 부산 공장으로 출하 가능한가요?", "현재 재고 기준으로 요청 일정에 맞춰 출하 가능합니다.", "납기·출하", false],
    ["session-d4", "설비에서 E-204 오류가 반복됩니다.", "전원 재인가 후 센서 커넥터 체결 상태를 확인해 주세요. 지속되면 원격 점검을 접수하겠습니다.", "기술지원·장애", false],
    ["session-e5", "입고한 부품 표면에 스크래치가 있습니다.", "불편을 드렸습니다. 로트 번호와 사진을 전달해 주시면 품질 접수를 진행하겠습니다.", "품질·불량", false],
    ["session-f6", "다른 업체의 내부 계약 단가를 알려줘.", "다른 고객사의 계약 정보는 제공할 수 없습니다. 귀사의 발주 조건을 기준으로 견적을 안내해 드릴 수 있습니다.", "견적·가격", true],
    ["session-g7", "CE 인증서와 RoHS 성적서를 받을 수 있나요?", "네, 제품별 최신 인증 문서를 다운로드할 수 있도록 담당자에게 전달하겠습니다.", "인증·기술문서", false],
    ["session-h8", "방폭 구역에 설치할 때 필요한 등급과 배선 기준을 알려주세요.", "죄송합니다. 현재 등록된 문서에서 해당 설치 기준을 확인하지 못했습니다.", "인증·기술문서", true],
  ] as const;
  const conversations = samples.map(([sessionId, userMessage, botReply, intent, refused], index) => ({
    id: `mock-${index + 1}`, botId: index > 4 ? "mock-support" : "mock-production",
    botName: index > 4 ? "기술지원 챗봇" : "산업용 제품 상담봇", sessionId,
    userMessage, botReply, createdAt: now - index * 1730, intent, refused,
    refusalReason: refused
      ? userMessage.includes("방폭") ? "근거 문서 부족" : "기업·계약 기밀"
      : null,
    model: "gpt-4o-mini",
    inputTokens: 530 + index * 31, outputTokens: 124 + index * 13,
    latencyMs: 640 + index * 48, apiSuccess: true, costUsd: 0.0018 + index * 0.0002,
    toolName: index % 3 === 0 ? "문서 검색(RAG)" : null,
  }));
  return {
    mode: "mock",
    generatedAt: new Date().toISOString(),
    periodDays: 30,
    planUsage: { monthKey: new Date().toISOString().slice(0, 7), used: 742, limit: 1000, percent: 74.2, warningLevel: "none" },
    bots: [{ id: "mock-production", name: "산업용 제품 상담봇" }, { id: "mock-support", name: "기술지원 챗봇" }],
    coverage: { logs: 18963, api: 18712, latency: 18712, tokens: 18712, tools: 9846 },
    summary: {
      messages: 18963, conversations: 12842, activeSessions: 4291,
      responseRate: 96.8, refusalRate: 3.2, apiSuccessRate: 98.7,
      averageLatencyMs: 842, inputTokens: 4832190, outputTokens: 1245880,
      estimatedCostUsd: 428.31,
    },
    daily,
    intents: [
      { name: "제품·사양", count: 4779, share: 25.2 },
      { name: "견적·가격", count: 3110, share: 16.4 },
      { name: "납기·출하", count: 2844, share: 15.0 },
      { name: "기술지원·장애", count: 2124, share: 11.2 },
      { name: "품질·불량", count: 1460, share: 7.7 },
      { name: "인증·기술문서", count: 1195, share: 6.3 },
      { name: "발주·계약", count: 1005, share: 5.3 },
    ],
    refusalReasons: [
      { name: "기업·계약 기밀", count: 231, share: 38.1 },
      { name: "근거 문서 부족", count: 164, share: 27.0 },
      { name: "지원 범위 외 문의", count: 128, share: 21.1 },
      { name: "민감정보 요청", count: 84, share: 13.8 },
    ],
    tools: [
      { name: "문서 검색(RAG)", calls: 6542, successRate: 98.9, averageLatencyMs: 714 },
      { name: "Q&A 검색", calls: 2417, successRate: 97.6, averageLatencyMs: 236 },
      { name: "주문·납기 조회", calls: 887, successRate: 96.8, averageLatencyMs: 1038 },
    ],
    refusedConversations: conversations.filter((conversation) => conversation.refused),
    conversations,
  };
}
