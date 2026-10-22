import sql from "@/lib/neon";
import { requireReady } from "@/lib/customer-portal/auth";
import {
  body,
  failure,
  sameOrigin,
  email,
  newToken,
  tokenHash,
  PortalError,
} from "@/lib/customer-portal/input";
import {
  sendActivationMail,
  customerPortalOrigin,
} from "@/lib/customer-portal/mail";
import { enforceRateLimit } from "@/lib/support";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await requireReady();
    const input = await body(req),
      address = email(input.email);
    if (!process.env.RESEND_API_KEY || !process.env.AUTH_FROM_EMAIL)
      throw new PortalError(
        "비밀번호 확인 메일 발송 설정이 필요합니다. 에이전시에 문의해주세요.",
        503,
      );
    if (
      !(await enforceRateLimit("customer-reset:" + tokenHash(address), req, 3))
    )
      return Response.json({ ok: true });
    const [user] =
      await sql`SELECT id FROM users WHERE email=${address} AND status='active'`;
    if (user) {
      const token = newToken(),
        digest = tokenHash(token),
        origin = customerPortalOrigin(new URL(req.url).origin);
      await sql`INSERT INTO customer_password_reset_tokens(token_hash,user_id,expires_at) VALUES(${digest},${user.id},EXTRACT(EPOCH FROM NOW())::BIGINT+900)`;
      try {
        await sendActivationMail(
          address,
          `${origin}/customer/reset-password/${token}`,
          "담당자",
          true,
        );
      } catch {
        await sql`DELETE FROM customer_password_reset_tokens WHERE token_hash=${digest}`; /* Keep response indistinguishable from a missing account. */
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
