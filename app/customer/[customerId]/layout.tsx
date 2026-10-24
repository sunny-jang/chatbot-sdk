import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import sql from "@/lib/neon";
import { customerAccess } from "@/lib/customer-portal/auth";
import { PortalError } from "@/lib/customer-portal/input";
import Image from "next/image";
import LogoutButton from "@/app/LogoutButton";
import NavIcon from "@/app/components/NavIcon";
import DeskNav, { type DeskNavItem } from "@/app/customer/components/DeskNav";
import { listAccessibleCustomers } from "@/lib/access/queries";
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
  // 여러 고객사를 맡은 담당자에게만 전환 메뉴를 보여줍니다.
  const accessible = await listAccessibleCustomers(sql, access.user.id);
  const base = `/customer/${customerId}`;
  const items: DeskNavItem[] = [
    { href: `${base}/support`, label: "상담함", icon: "inbox" },
    { href: `${base}/requests`, label: "문의·견적", icon: "requests" },
  ];
  if (access.grant.role !== "agent")
    items.push(
      { href: `${base}/bots`, label: "챗봇 관리", icon: "bots" },
      { href: `${base}/settings`, label: "고객사 설정", icon: "settings" },
      { href: `${base}/members`, label: "담당자 관리", icon: "members" },
    );
  const roleLabel =
    access.grant.role === "agent"
      ? "상담 담당자"
      : access.grant.role === "admin"
        ? "고객사 관리자"
        : "에이전시 관리자";
  const initial = (access.user.name || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="cp-shell" key={`${access.user.id}:${customerId}`}>
      <a className="workspace-skip" href="#main-content">
        본문으로 이동
      </a>
      <header className="cp-header">
        <div className="cp-brand">
          <Image
            src="/logo.png"
            alt="Ideal AI"
            width={88}
            height={26}
            unoptimized
            style={{ width: 88, height: "auto" }}
          />
          <span className="cp-brand-divider" aria-hidden="true" />
          <span className="cp-brand-customer">
            <small>고객사 상담함</small>
            {String(customer.name)}
          </span>
        </div>
        <DeskNav items={items} />
        <div className="cp-user">
          {accessible.length > 1 && (
            <Link href="/customer" className="cp-user-switch" title="다른 고객사 상담함으로">
              <NavIcon name="switch" />
              고객사 전환
            </Link>
          )}
          {access.grant.role === "owner" && (
            <a
              className="cp-user-switch"
              href={`${process.env.AUTH_URL || ""}/customers`}
            >
              에이전시 관리
            </a>
          )}
          <span className="cp-user-chip" title={roleLabel}>
            <span className="cp-user-avatar" aria-hidden="true">
              {initial}
            </span>
            <span>
              <strong>{access.user.name}</strong>
              <small>{roleLabel}</small>
            </span>
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
