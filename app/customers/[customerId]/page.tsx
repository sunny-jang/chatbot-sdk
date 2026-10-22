import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import sql from "@/lib/neon";
import { agencyOwner } from "@/lib/customer-portal/auth";
import Members from "./Members";
import Bots from "./Bots";
import "@/app/customer/portal.css";
export default async function CustomerManagement({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  let owner;
  try {
    owner = await agencyOwner();
  } catch {
    redirect("/customers");
  }
  const [customer] =
    await sql`SELECT id,name,website FROM customers WHERE id=${customerId} AND tenant_id=${owner.tenantId}`;
  if (!customer) notFound();
  const bots = await sql<
    { id: string; name: string; customer_id: string | null }[]
  >`SELECT id,name,customer_id FROM bots WHERE tenant_id=${owner.tenantId} ORDER BY created_at`;
  return (
    <div className="workspace-page">
      <header className="workspace-page-heading">
        <div>
          <Link href="/customers" className="cp-link">
            고객사 관리
          </Link>
          <h1>{String(customer.name)}</h1>
          <p>
            챗봇은 에이전시에서 관리하고, 고객사는 전용 상담함을 사용합니다.
          </p>
        </div>
        <Link
          className="workspace-primary"
          href={`${process.env.CUSTOMER_PORTAL_ORIGIN || ""}/customer/${customerId}/support`}
        >
          고객사 상담함 열기
        </Link>
      </header>
      <Bots customerId={customerId} bots={bots} />
      <Members customerId={customerId} owner />
    </div>
  );
}
