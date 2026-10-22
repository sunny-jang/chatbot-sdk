import Link from "next/link";
import { redirect } from "next/navigation";
import sql from "@/lib/neon";
import { portalUser } from "@/lib/customer-portal/auth";
import { listAccessibleCustomers } from "@/lib/access/queries";
import { PortalError } from "@/lib/customer-portal/input";
import LogoutButton from "@/app/LogoutButton";
export default async function CustomersSelect() {
  let user;
  try {
    user = await portalUser();
  } catch (e) {
    if (e instanceof PortalError && e.status === 401)
      redirect("/customer/login");
    return (
      <main className="cp-pick">
        <h1>상담함을 열 수 없어요</h1>
        <p>계정 상태와 고객사 접근 권한을 에이전시에 확인해주세요.</p>
        <LogoutButton destination="/customer/login" />
      </main>
    );
  }
  const customers = await listAccessibleCustomers(sql, user.id);
  if (customers.length === 1) redirect(`/customer/${customers[0].id}/support`);
  return (
    <main className="cp-pick">
      <div className="cp-row">
        <h1>어느 회사의 상담을 시작할까요?</h1>
        <LogoutButton destination="/customer/login" />
      </div>
      <p>{user.name}님이 담당하는 고객사만 표시됩니다.</p>
      <div className="cp-customer-list">
        {customers.map((c) => (
          <Link
            className="cp-customer"
            key={c.id}
            href={`/customer/${c.id}/support`}
          >
            <strong>{c.name}</strong>
            <small>
              {c.role === "owner"
                ? "에이전시 관리자"
                : c.role === "admin"
                  ? "고객사 관리자"
                  : "상담 담당자"}
            </small>
          </Link>
        ))}
      </div>
      {!customers.length && (
        <p className="cp-panel">
          연결된 고객사가 없습니다. 에이전시에 담당자 초대를 요청해주세요.
        </p>
      )}
    </main>
  );
}
