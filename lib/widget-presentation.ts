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
