import Link from "next/link";
import sql from "@/lib/neon";
import { customerPageAccess } from "@/lib/customer-portal/page";
export default async function CustomerBots({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params,
    { grant } = await customerPageAccess(customerId, "bot.read");
  const bots =
    await sql`SELECT id,name,type FROM bots WHERE customer_id=${customerId} AND tenant_id=${grant.tenant_id} ORDER BY name,id`;
  return (
    <div>
      <h1 className="cp-page-title">챗봇 관리</h1>
      <p className="cp-note">
        우리 회사의 지식과 응대 설정을 관리하세요. 챗봇 추가·이동은 에이전시에
        요청해주세요.
      </p>
      <div className="cp-customer-list">
        {bots.map((b) => (
          <Link
            className="cp-customer"
            key={String(b.id)}
            href={`/customer/${customerId}/bots/${b.id}`}
          >
            <strong>{String(b.name)}</strong>
            <small>
              {b.type === "qa" ? "Q&A 챗봇" : "AI 챗봇"} · 설정·지식·설치·통계
            </small>
          </Link>
        ))}
      </div>
      {!bots.length && (
        <p className="cp-panel">
          연결된 챗봇이 없습니다. 에이전시에 연결을 요청해주세요.
        </p>
      )}
    </div>
  );
}
