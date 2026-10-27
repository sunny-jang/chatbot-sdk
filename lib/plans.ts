export const PLAN_IDS = ["starter", "growth", "pro", "enterprise"] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export const PLAN_CONFIG: Record<PlanId, { name: string; botLimit: number | null; monthlySessionLimit: number | null }> = {
  starter: { name: "무료", botLimit: 1, monthlySessionLimit: 1_000 },
  growth: { name: "그로스", botLimit: 3, monthlySessionLimit: 5_000 },
  pro: { name: "프로", botLimit: 5, monthlySessionLimit: 10_000 },
  enterprise: { name: "엔터프라이즈", botLimit: null, monthlySessionLimit: null },
};

export function normalizePlan(value: unknown): PlanId {
  return PLAN_IDS.includes(value as PlanId) ? (value as PlanId) : "starter";
}

export function getBotLimit(plan: PlanId, enterpriseBotLimit: number | null | undefined) {
  if (plan !== "enterprise") return PLAN_CONFIG[plan].botLimit;
  return enterpriseBotLimit && enterpriseBotLimit > 0 ? enterpriseBotLimit : null;
}

export function getMonthlySessionLimit(plan: PlanId, enterpriseLimit: number | null | undefined) {
  if (plan !== "enterprise") return PLAN_CONFIG[plan].monthlySessionLimit;
  return enterpriseLimit && enterpriseLimit > 0 ? enterpriseLimit : null;
}

/** DB 지식(고객사 DB에서 가져온 행) 한도 — 에이전시 전체 합계. 무료는 쓸 수 없다(0). */
export const DB_ROW_LIMITS: Record<PlanId, number> = { starter: 0, growth: 10_000, pro: 50_000, enterprise: 100_000 };
export function getDbRowLimit(plan: PlanId, enterpriseDbRowLimit?: number | null) {
  if (plan === "enterprise" && enterpriseDbRowLimit && enterpriseDbRowLimit > 0) return enterpriseDbRowLimit;
  return DB_ROW_LIMITS[plan];
}
export const DB_KNOWLEDGE_DISABLED = "무료 요금제에서는 DB 연동을 쓸 수 없어요. 그로스 이상으로 요금제를 올리면 바로 쓸 수 있어요.";
