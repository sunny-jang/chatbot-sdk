/** Request validation and the portal error type. No Node-only imports so Edge middleware can bundle it via auth.ts. */
export class PortalError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function text(value: unknown, label: string, max = 120) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new PortalError(`${label}을 확인해주세요.`);
  return value.trim();
}
export function email(value: unknown) {
  const v = text(value, "이메일", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    throw new PortalError("이메일을 확인해주세요.");
  return v;
}
export function website(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const v = text(value, "홈페이지 주소", 500);
  try {
    const u = new URL(v);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw Error();
    return u.href;
  } catch {
    throw new PortalError("http 또는 https 홈페이지 주소를 입력해주세요.");
  }
}
export function password(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    new TextEncoder().encode(value).length > 72
  )
    throw new PortalError(
      "비밀번호는 12자 이상, UTF-8 기준 72바이트 이하로 입력해주세요.",
    );
  return value;
}
