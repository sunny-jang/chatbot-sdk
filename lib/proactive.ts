export const defaultProactive = {
  enabled: false,
  message: "제가 좀 도와드릴까요?",
  delaySeconds: 30,
};

export function normalizeProactive(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    enabled: input.enabled === true,
    message: typeof input.message === "string" && input.message.trim()
      ? input.message.trim().slice(0, 120) : defaultProactive.message,
    delaySeconds: typeof input.delaySeconds === "number" && Number.isFinite(input.delaySeconds)
      ? Math.min(300, Math.max(5, Math.round(input.delaySeconds))) : 30,
  };
}
