import sql from "@/lib/neon";
import { acceptVerifiedInvitation } from "@/lib/customer-portal/management";
import type { AccessDatabase } from "@/lib/access/schema";
import { portalUser, requireReady } from "@/lib/customer-portal/auth";
import {
  PortalError,
  failure,
  sameOrigin,
  tokenHash,
  newToken,
} from "@/lib/customer-portal/input";
import {
  sendActivationMail,
  customerPortalOrigin,
} from "@/lib/customer-portal/mail";
import { enforceRateLimit } from "@/lib/support";
type Context = { params: Promise<{ token: string }> };
export async function POST(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    await requireReady();
    const { token } = await params,
      digest = tokenHash(token);
    if (!(await enforceRateLimit("customer-verify:" + digest, req, 3)))
      return Response.json(
        { error: "확인 메일을 이미 요청했습니다. 잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    const [i] =
      await sql`SELECT i.id,i.email,c.name FROM customer_invitations i JOIN customers c ON c.id=i.customer_id WHERE i.token_hash=${digest} AND i.status='pending' AND i.expires_at>EXTRACT(EPOCH FROM NOW()) AND c.status='active'`;
    if (!i) throw new PortalError("만료되었거나 취소된 초대입니다.", 410);
    const challenge = newToken(),
      hash = tokenHash(challenge),
      origin = customerPortalOrigin(new URL(req.url).origin);
    await sql`INSERT INTO customer_invite_challenges(token_hash,invitation_id,expires_at) VALUES(${hash},${i.id},EXTRACT(EPOCH FROM NOW())::BIGINT+900)`;
    try {
      await sendActivationMail(
        String(i.email),
        `${origin}/customer/activate/${challenge}`,
        String(i.name),
      );
    } catch (e) {
      await sql`DELETE FROM customer_invite_challenges WHERE token_hash=${hash}`;
      throw e;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(req: Request, {params}: Context) {
  try {
    sameOrigin(req);
    const user = await portalUser(), {token} = await params;
    if (!(await enforceRateLimit("customer-accept:" + user.id,req,10))) throw new PortalError("잠시 후 다시 시도해주세요.",429);
    const result = await sql.begin(tx => acceptVerifiedInvitation(tx as unknown as AccessDatabase, token, user.id));
    return Response.json(result);
  } catch(e) { return failure(e); }
}
