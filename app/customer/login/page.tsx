import LoginClient from "./LoginClient";
import { customerReturnPath } from "@/lib/customer-portal/return-path";
import {
  GOOGLE_IDENTITY_MESSAGES,
  googleLoginAvailable,
  isGoogleIdentityReason,
} from "@/lib/access/google";
export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const query = await searchParams;
  // Only the known reasons are shown; Auth.js error codes collapse to one generic line.
  const oauthError = query.error
    ? isGoogleIdentityReason(query.error)
      ? GOOGLE_IDENTITY_MESSAGES[query.error]
      : "Google 로그인을 완료하지 못했습니다. 초대 정보와 계정을 확인한 뒤 다시 시도해주세요."
    : "";
  return (
    <LoginClient
      agencyOrigin={process.env.AUTH_URL || ""}
      next={customerReturnPath(query.next)}
      googleAvailable={googleLoginAvailable()}
      oauthError={oauthError}
    />
  );
}
