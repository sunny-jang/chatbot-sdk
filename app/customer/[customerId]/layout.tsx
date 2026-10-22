import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import sql from "@/lib/neon";
import { customerAccess } from "@/lib/customer-portal/auth";
import { PortalError } from "@/lib/customer-portal/input";
import LogoutButton from "@/app/LogoutButton";
export default async function CustomerWorkspace({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  let access;
  try {
    access = await customerAccess(customerId);
  } catch (e) {
    if (e instanceof PortalError && e.status === 401)
      redirect("/customer/login");
    notFound();
  }
  const [customer] =
    await sql`SELECT name FROM customers WHERE id=${customerId}`;
  return (
    <div className="cp-shell" key={`${access.user.id}:${customerId}`}>
      <a className="workspace-skip" href="#main-content">
        본문으로 이동
      </a>
      <header className="cp-header">
        <div className="cp-brand">
          <small>고객사 전용 상담함</small>
          {String(customer.name)}
        </div>
        <nav aria-label="고객사 업무">
          <Link href={`/customer/${customerId}/support`}>상담함</Link>
          <Link href={`/customer/${customerId}/requests`}>문의·견적</Link>
          <Link href="/customer">고객사 선택</Link>
          {access.grant.role !== "agent" && (
            <Link href={`/customer/${customerId}/members`}>담당자 관리</Link>
          )}
          {access.grant.role === "owner" && (
            <a href={`${process.env.AUTH_URL || ""}/customers`}>
              에이전시 관리로
            </a>
          )}
        </nav>
        <div className="cp-user">
          <span>
            {access.user.name} ·{" "}
            {access.grant.role === "agent"
              ? "상담 담당자"
              : access.grant.role === "admin"
                ? "고객사 관리자"
                : "에이전시 관리자"}
          </span>
          <LogoutButton destination="/customer/login" />
        </div>
      </header>
      <main id="main-content" className="cp-content">
        {children}
      </main>
    </div>
  );
}
