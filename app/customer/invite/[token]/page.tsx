import Link from "next/link";
import sql from "@/lib/neon";
import { portalUser, requireReady } from "@/lib/customer-portal/auth";
import { tokenHash } from "@/lib/customer-portal/input";
import { googleLoginAvailable } from "@/lib/access/google";
import Invite from "./Invite";
import { AuthHero } from "@/app/customer/components/AuthHero";
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
      <AuthHero
        chip="이미 수락한 초대"
        chipIcon="check"
        title={`${String(invite.name)} 상담함을`}
        accent="바로 열 수 있어요"
      >
        <div className="cp-hero-actions">
          <Link className="cp-button" href={`/customer/${invite.customer_id}/support`}>
            {String(invite.name)} 상담함 열기
          </Link>
        </div>
      </AuthHero>
    );
  if (!invite?.usable)
    return (
      <AuthHero
        chip="사용할 수 없는 초대"
        chipIcon="warn"
        title="이 초대 링크는"
        accent="더 이상 쓸 수 없어요"
        art="key"
      >
        <p className="cp-hero-lead">
          만료되었거나 취소된 링크입니다. 에이전시 또는 고객사 관리자에게 새
          초대를 요청해주세요.
        </p>
        <div className="cp-hero-actions">
          <Link className="cp-button cp-button-secondary" href="/customer/login">
            상담함 로그인으로
          </Link>
        </div>
      </AuthHero>
    );
  const address = String(invite.email),
    masked = address[0] + "***@" + address.split("@")[1];
  return (
    <Invite
      token={token}
      customerName={String(invite.name)}
      partnerName={String(invite.partner)}
      role={String(invite.role)}
      maskedEmail={masked}
      viewer={viewer && { name: viewer.name, email: viewer.email }}
      matches={viewer?.email === address}
      googleAvailable={googleLoginAvailable()}
    />
  );
}
