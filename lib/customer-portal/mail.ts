import { PortalError } from "./input";
export function customerPortalOrigin(fallback?: string) {
  const value =
    process.env.CUSTOMER_PORTAL_ORIGIN || process.env.AUTH_URL || fallback;
  if (!value)
    throw new PortalError("고객사 상담함 주소 설정이 필요합니다.", 503);
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new PortalError("상담함 주소 설정을 확인해주세요.", 503);
  return url.origin;
}
export async function sendActivationMail(
  to: string,
  link: string,
  customerName: string,
  reset = false,
) {
  if (!process.env.RESEND_API_KEY || !process.env.AUTH_FROM_EMAIL)
    throw new PortalError(
      "이메일 확인 발송 설정이 필요합니다. 에이전시에 문의해주세요.",
      503,
    );
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.AUTH_FROM_EMAIL,
      to: [to],
      subject: reset
        ? "고객사 상담함 비밀번호 재설정"
        : "고객사 상담함 계정 확인",
      text: `${customerName} 상담함 ${reset ? "비밀번호 재설정" : "초대 확인"}\n\n본인이 상담함 이용을 요청했다면 아래 링크에서 ${reset ? "비밀번호를 다시 설정해주세요" : "계정을 활성화해주세요"}. 링크는 15분 동안 한 번만 사용할 수 있습니다.\n${link}\n\n요청한 적이 없다면 이 메일을 무시해주세요.`,
    }),
  });
  if (!response.ok)
    throw new PortalError(
      "확인 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.",
      503,
    );
}
