export const PLAN_IDS = ["starter", "growth", "pro", "enterprise"] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export const PLAN_CONFIG: Record<PlanId, { name: string; botLimit: number | null }> = {
  starter: { name: "스타터", botLimit: 1 },
  growth: { name: "그로스", botLimit: 3 },
  pro: { name: "프로", botLimit: 5 },
  enterprise: { name: "엔터프라이즈", botLimit: null },
};

export function normalizePlan(value: unknown): PlanId {
  return PLAN_IDS.includes(value as PlanId) ? (value as PlanId) : "starter";
}

export function getBotLimit(plan: PlanId, enterpriseBotLimit: number | null | undefined) {
  if (plan !== "enterprise") return PLAN_CONFIG[plan].botLimit;
  return enterpriseBotLimit && enterpriseBotLimit > 0 ? enterpriseBotLimit : null;
}
