/** Public widget presentation values are untrusted, including legacy database rows. */
export const DEFAULT_WIDGET_COLOR = "#2563eb";
export function widgetColor(value: unknown) {
  return typeof value === "string" &&
    /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
    ? value
    : null;
}
export function widgetTitle(value: unknown) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 100 &&
    !/[\x00-\x1f\x7f<>]/.test(value)
    ? value.trim()
    : null;
}
export function widgetLogo(value: unknown) {
  if (typeof value !== "string" || value.length > 2800000) return null;
  if (
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(
      value,
    )
  )
    return value;
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function logoMime(bytes: Uint8Array) {
  const prefix = [...bytes.slice(0, 12)];
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => prefix[i] === n))
    return "image/png";
  if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255)
    return "image/jpeg";
  const ascii = String.fromCharCode(...prefix);
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a"))
    return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP")
    return "image/webp";
  return null;
}
/**
 * Per-bot widget design. Only enumerated choices and bounded integers are
 * accepted so tenant input can never become free-form CSS or a font URL on a
 * customer site. Invalid fields are dropped; missing fields keep the widget's
 * built-in look.
 */
export const WIDGET_THEME_CHOICES = {
  position: ["right", "left"],
  corner: ["sharp", "rounded", "pill"],
  launcher: ["circle", "rounded-square", "text"],
  bubble: ["filled", "outline"],
  font: ["system", "pretendard"],
} as const;
export const WIDGET_THEME_RANGES = {
  offsetX: [0, 120],
  offsetY: [0, 120],
  launcherSize: [48, 64],
} as const;
export type WidgetTheme = {
  position?: (typeof WIDGET_THEME_CHOICES.position)[number];
  offsetX?: number;
  offsetY?: number;
  corner?: (typeof WIDGET_THEME_CHOICES.corner)[number];
  launcher?: (typeof WIDGET_THEME_CHOICES.launcher)[number];
  launcherText?: string;
  launcherSize?: number;
  bubble?: (typeof WIDGET_THEME_CHOICES.bubble)[number];
  font?: (typeof WIDGET_THEME_CHOICES.font)[number];
};
/** The look the widget had before themes existed. */
export const DEFAULT_WIDGET_THEME: Required<WidgetTheme> = {
  position: "right",
  offsetX: 24,
  offsetY: 24,
  corner: "rounded",
  launcher: "circle",
  launcherText: "",
  launcherSize: 52,
  bubble: "filled",
  font: "system",
};
export const WIDGET_LAUNCHER_TEXT_MAX = 20;
export function widgetLauncherText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 &&
    [...text].length <= WIDGET_LAUNCHER_TEXT_MAX &&
    !/[\x00-\x1f\x7f<>{};]/.test(text)
    ? text
    : null;
}
export function widgetTheme(value: unknown): WidgetTheme | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const theme: Record<string, unknown> = {};
  for (const [key, choices] of Object.entries(WIDGET_THEME_CHOICES))
    if ((choices as readonly unknown[]).includes(input[key]))
      theme[key] = input[key];
  for (const [key, [min, max]] of Object.entries(WIDGET_THEME_RANGES)) {
    const n = input[key];
    if (typeof n === "number" && Number.isInteger(n) && n >= min && n <= max)
      theme[key] = n;
  }
  const text = widgetLauncherText(input.launcherText);
  if (text) theme.launcherText = text;
  return Object.keys(theme).length ? (theme as WidgetTheme) : null;
}
/** Header/launcher text color that stays readable on the chosen brand color. */
export function widgetTextColor(color: unknown) {
  const hex = widgetColor(color) ?? DEFAULT_WIDGET_COLOR;
  const full =
    hex.length === 4
      ? hex.slice(1).replace(/./g, (c) => c + c)
      : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Pick whichever of white/#111827 (luminance ≈ 0.009) has the higher WCAG contrast ratio.
  return (1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.0591 ? "#ffffff" : "#111827");
}
