import sql from "@/lib/neon";
import { requireReady } from "@/lib/customer-portal/auth";
import { tokenHash } from "@/lib/customer-portal/input";
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
      await sql`SELECT c.name,i.role,i.email FROM customer_invitations i JOIN customers c ON c.id=i.customer_id WHERE i.token_hash=${tokenHash(token)} AND i.status='pending' AND i.expires_at>EXTRACT(EPOCH FROM NOW()) AND c.status='active'`;
  } catch {}
  if (!invite)
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
      <p>역할: {invite.role === "admin" ? "고객사 관리자" : "상담 담당자"}</p>
      <p>
        {masked} 메일함에서 본인 확인을 마친 뒤 계정을 활성화할 수 있습니다.
      </p>
      <Invite token={token} />
    </main>
  );
}
