import sql from "@/lib/neon";
import { requireReady } from "@/lib/customer-portal/auth";
import { tokenHash } from "@/lib/customer-portal/input";
import Activate from "./Activate";
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
      await sql`SELECT EXISTS(SELECT 1 FROM users u WHERE u.email=i.email) AS existing FROM customer_invite_challenges ch JOIN customer_invitations i ON i.id=ch.invitation_id JOIN customers c ON c.id=i.customer_id WHERE ch.token_hash=${tokenHash(token)} AND ch.used_at IS NULL AND ch.expires_at>EXTRACT(EPOCH FROM NOW()) AND i.status='pending' AND i.expires_at>EXTRACT(EPOCH FROM NOW()) AND c.status='active'`;
  } catch {}
  return (
    <main className="cp-pick cp-panel">
      {challenge ? (
        <Activate token={token} existing={Boolean(challenge.existing)} />
      ) : (
        <>
          <h1>확인 링크가 만료되었습니다</h1>
          <p>초대 링크에서 확인 메일을 다시 요청해주세요.</p>
        </>
      )}
    </main>
  );
}
