import Link from "next/link";
import sql from "@/lib/neon";
import { portalUser, requireReady } from "@/lib/customer-portal/auth";
import { tokenHash } from "@/lib/customer-portal/input";
import { googleLoginAvailable } from "@/lib/access/google";
import Invite from "./Invite";
export default async function CustomerInvite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let invite;
  try {
    await requireReady();
    [invite] =
      await sql`SELECT i.customer_id,c.name,t.name AS partner,i.role,i.email,i.accepted_by,(i.status='pending' AND i.expires_at>EXTRACT(EPOCH FROM NOW()) AND c.status='active') AS usable FROM customer_invitations i JOIN customers c ON c.id=i.customer_id JOIN tenants t ON t.id=c.tenant_id WHERE i.token_hash=${tokenHash(token)}`;
  } catch {}
  // A signed-in identity is shown only its own name/email; the invited address stays masked until it matches.
  let viewer: { id: string; name: string; email: string | null } | null = null;
  try {
    viewer = await portalUser();
  } catch {}
  // The member who already accepted this link keeps a way into the inbox instead of an "expired" dead end.
  if (invite && viewer && invite.accepted_by === viewer.id)
    return (
      <main className="cp-pick cp-panel">
        <h1>이미 수락한 초대입니다</h1>
        <p>{String(invite.name)} 상담함을 바로 열 수 있습니다.</p>
        <Link className="cp-link" href={`/customer/${invite.customer_id}/support`}>
          {String(invite.name)} 상담함 열기
        </Link>
      </main>
    );
  if (!invite?.usable)
    return (
      <main className="cp-pick">
        <h1>사용할 수 없는 초대입니다</h1>
        <p>
          만료되었거나 취소된 링크입니다. 에이전시에 새 초대를 요청해주세요.
        </p>
      </main>
    );
  const address = String(invite.email),
    masked = address[0] + "***@" + address.split("@")[1];
  return (
    <main className="cp-pick cp-panel">
      <h1>{String(invite.name)} 상담함에 초대되었습니다</h1>
      <p>
        초대한 곳: {String(invite.partner)} · 역할:{" "}
        {invite.role === "admin" ? "고객사 관리자" : "상담 담당자"}
      </p>
      <p>초대받은 이메일: {masked}</p>
      <Invite
        token={token}
        viewer={viewer && { name: viewer.name, email: viewer.email }}
        matches={viewer?.email === address}
        googleAvailable={googleLoginAvailable()}
      />
    </main>
  );
}
