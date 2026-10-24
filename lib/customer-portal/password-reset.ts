import { hash } from "bcryptjs";
import type { AccessDatabase } from "../access/schema";
import { PortalError, password, tokenHash } from "./input";
export async function resetCustomerPassword(
  db: AccessDatabase,
  token: string,
  newPassword: unknown,
) {
  const [r] =
    await db`SELECT t.token_hash,t.user_id,t.expires_at,t.used_at,u.status FROM customer_password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=${tokenHash(token)} FOR UPDATE OF u,t`;
  if (
    !r ||
    r.used_at ||
    Number(r.expires_at) <= Date.now() / 1000 ||
    r.status !== "active"
  )
    throw new PortalError("만료되었거나 사용한 링크입니다.", 410);
  const secret = password(newPassword);
  await db`UPDATE users SET password_hash=${await hash(secret, 12)},auth_version=auth_version+1 WHERE id=${r.user_id}`;
  await db`UPDATE customer_password_reset_tokens SET used_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE token_hash=${r.token_hash}`;
}
