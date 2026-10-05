import { createHash } from "node:crypto";
import { OperationError, boundedText } from "./input";
import type { RequestSettings } from "./settings";
export function validateRequest(
  body: Record<string, unknown>,
  settings: RequestSettings,
) {
  const kind = body.kind;
  if ((kind !== "quote" && kind !== "consultation") || !settings[kind])
    throw new OperationError("현재 이 신청 폼을 사용할 수 없습니다.", 409);
  const name = boundedText(body.name, "이름", 100),
    message = boundedText(body.message, "문의 내용", 5000);
  const company = settings.company
    ? boundedText(body.company, "회사명", 200, false)
    : "";
  const email = boundedText(body.email, "이메일", 254, false),
    phone = boundedText(body.phone, "전화번호", 40, false);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new OperationError("이메일 형식을 확인해주세요.");
  if (
    phone &&
    (!/^[+\d()\s-]+$/.test(phone) ||
      phone.replace(/\D/g, "").length < 7 ||
      phone.replace(/\D/g, "").length > 15)
  )
    throw new OperationError("전화번호 형식을 확인해주세요.");
  if (
    (!email && !phone) ||
    (settings.contact === "email" && !email) ||
    (settings.contact === "phone" && !phone)
  )
    throw new OperationError("필수 연락처를 입력해주세요.");
  if (
    body.consent !== true ||
    !settings.consentText ||
    body.consentVersion !== settings.consentVersion
  )
    throw new OperationError(
      "개인정보 안내를 확인하고 동의해주세요. 안내가 변경됐다면 폼을 다시 열어주세요.",
    );
  const key = boundedText(body.idempotencyKey, "제출 키", 200);
  const sessionId = body.sessionId
    ? boundedText(body.sessionId, "세션", 200)
    : null;
  const data = { kind, name, company, email, phone, message, sessionId };
  const hash = createHash("sha256")
    .update(
      JSON.stringify({ ...data, consentVersion: settings.consentVersion }),
    )
    .digest("hex");
  return { ...data, key, hash };
}
