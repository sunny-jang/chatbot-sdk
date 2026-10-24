import sql from "@/lib/neon";
import { requireReady } from "@/lib/customer-portal/auth";
import { tokenHash } from "@/lib/customer-portal/input";
import Activate from "./Activate";
import { AuthHero } from "@/app/customer/components/AuthHero";
export default async function ActivatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let challenge;
  try {
    await requireReady();
    [challenge] =
      await sql`SELECT EXISTS(SELECT 1 FROM users u WHERE u.email=i.email) AS existing,c.name,i.email FROM customer_invite_challenges ch JOIN customer_invitations i ON i.id=ch.invitation_id JOIN customers c ON c.id=i.customer_id WHERE ch.token_hash=${tokenHash(token)} AND ch.used_at IS NULL AND ch.expires_at>EXTRACT(EPOCH FROM NOW()) AND i.status='pending' AND i.expires_at>EXTRACT(EPOCH FROM NOW()) AND c.status='active'`;
  } catch {}
  if (!challenge)
    return (
      <AuthHero
        chip="확인 링크 만료"
        chipIcon="warn"
        title="이 확인 링크는"
        accent="만료되었어요"
        art="key"
      >
        <p className="cp-hero-lead">
          확인 링크는 15분 동안 한 번만 쓸 수 있어요. 초대 링크를 다시 열어
          확인 메일을 새로 요청해주세요.
        </p>
      </AuthHero>
    );
  const address = String(challenge.email),
    masked = address[0] + "***@" + address.split("@")[1];
  return (
    <Activate
      token={token}
      existing={Boolean(challenge.existing)}
      customerName={String(challenge.name)}
      maskedEmail={masked}
    />
  );
}
