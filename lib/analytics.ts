export type IntentKey =
  | "견적·가격"
  | "제품·사양"
  | "발주·계약"
  | "납기·출하"
  | "기술지원·장애"
  | "품질·불량"
  | "A/S·유지보수"
  | "인증·기술문서"
  | "결제·세금계산서"
  | "재고·샘플"
  | "대리점·파트너"
  | "기타 문의";

export function classifyIntent(message: string): IntentKey {
  const text = message.toLowerCase();
  if (/견적|단가|가격|비용|할인|quotation|quote|pricing|price|estimate/.test(text)) return "견적·가격";
  if (/a\/s|as 접수|수리|교체|보증|유지보수|정기점검|warranty|repair|maintenance|service request/.test(text)) return "A/S·유지보수";
  if (/불량|결함|파손|품질|클레임|하자|defect|quality|claim|damage/.test(text)) return "품질·불량";
  if (/인증서|성적서|시험성적|검사성적|msds|coa|rohs|reach|ce 인증|iso|매뉴얼|도면|기술문서|certificate|datasheet|drawing/.test(text)) return "인증·기술문서";
  if (/대리점|총판|파트너|협력사|제휴|공급사|벤더|distributor|reseller|partner|vendor/.test(text)) return "대리점·파트너";
  if (/발주|구매주문|계약|계약서|거래조건|최소주문|최소 주문|moq|purchase order|\bpo\b|contract/.test(text)) return "발주·계약";
  if (/납기|출하|선적|배송|도착|운송장|리드타임|lead time|shipment|shipping|delivery|tracking/.test(text)) return "납기·출하";
  if (/세금계산서|계산서|결제|입금|청구|미수금|거래명세서|invoice|payment|billing/.test(text)) return "결제·세금계산서";
  if (/재고|샘플|시제품|데모|테스트 제품|stock|sample|prototype|demo/.test(text)) return "재고·샘플";
  if (/오류|에러|고장|작동 안|동작 안|설치|설정|연동|통신|접속|기술지원|문제 해결|troubleshoot|error|failure|install|integration|technical support/.test(text)) return "기술지원·장애";
  if (/제품|상품|모델|사양|규격|스펙|호환|용량|소재|카탈로그|product|model|specification|spec|compatible|catalog/.test(text)) return "제품·사양";
  return "기타 문의";
}

export function detectRefusal(reply: string, explicitRefusal?: string | null) {
  if (explicitRefusal) return { refused: true, reason: "모델 안전 정책" };
  const text = reply.toLowerCase();
  if (/답변을 찾지 못했습니다|도와드릴 수 없|제공할 수 없|답변할 수 없|처리할 수 없/.test(text)) {
    return { refused: true, reason: "답변 불가 또는 정보 부족" };
  }
  if (/can't help|cannot help|can't provide|cannot provide|unable to assist/.test(text)) {
    return { refused: true, reason: "모델 안전 정책" };
  }
  return { refused: false, reason: null };
}

const MODEL_PRICING_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

export function estimateOpenAICost(model: string, inputTokens: number, outputTokens: number) {
  const family = Object.keys(MODEL_PRICING_USD_PER_MILLION).find((key) => model.startsWith(key));
  if (!family) return null;
  const pricing = MODEL_PRICING_USD_PER_MILLION[family];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
