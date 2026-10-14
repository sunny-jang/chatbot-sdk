export const defaultProactive = {
  enabled: false,
  message: "제가 좀 도와드릴까요?",
  delaySeconds: 30,
  mode: "basic" as "basic" | "ai",
  siteOrigin: "",
  excludedPaths: "",
  monthlyLimit: 200,
};

export function normalizeProactive(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    enabled: input.enabled === true,
    message: typeof input.message === "string" && input.message.trim()
      ? input.message.trim().slice(0, 120) : defaultProactive.message,
    delaySeconds: typeof input.delaySeconds === "number" && Number.isFinite(input.delaySeconds)
      ? Math.min(300, Math.max(5, Math.round(input.delaySeconds))) : 30,
    mode: input.mode === "ai" ? "ai" as const : "basic" as const,
    siteOrigin: normalizeOrigin(input.siteOrigin),
    excludedPaths: typeof input.excludedPaths === "string" ? input.excludedPaths.slice(0, 1000) : "",
    monthlyLimit: typeof input.monthlyLimit === "number" && Number.isFinite(input.monthlyLimit)
      ? Math.min(10000, Math.max(1, Math.round(input.monthlyLimit))) : 200,
  };
}

export function normalizeOrigin(value: unknown) {
  if (typeof value !== "string" || value.length > 300) return "";
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : ""; } catch { return ""; }
}

export function excludedProactivePath(path: string, extra = "") {
  if (/\b(login|signin|signup|account|checkout|payment|mypage|admin|cart)\b|로그인|결제|회원/.test(path.toLowerCase())) return true;
  return extra.split("\n").map(s => s.trim()).filter(Boolean).some(prefix => path.startsWith(prefix));
}
