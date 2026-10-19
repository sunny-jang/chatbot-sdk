import Link from "next/link";
import { redirect } from "next/navigation";
import sql from "@/lib/neon";
import { getTenantId } from "@/lib/auth";
import { initSchema } from "@/lib/db";
import { queryValue } from "@/lib/workspace-inbox";
export const dynamic = "force-dynamic";
const labels: Record<string, string> = {
  new: "신규",
  in_progress: "처리 중",
  completed: "완료",
};
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; q?: string | string[] }>;
}) {
  const tenant = await getTenantId();
  if (!tenant) redirect("/login");
  await initSchema();
  const params = await searchParams;
  const requestedStatus = queryValue(params.status);
  const status = Object.hasOwn(labels, requestedStatus) ? requestedStatus : "";
  const q = queryValue(params.q).trim().slice(0, 100);
  const rows =
    await sql`SELECT r.id,r.bot_id,r.name,r.kind,r.status,r.message,r.created_at,b.name AS bot_name FROM customer_requests r JOIN bots b ON b.id=r.bot_id WHERE r.tenant_id=${tenant} AND (${status}='' OR r.status=${status}) AND (${q}='' OR r.name ILIKE ${"%" + q + "%"} OR r.message ILIKE ${"%" + q + "%"}) ORDER BY r.created_at DESC LIMIT 100`;
  return (
    <div className="workspace-page">
      <header className="workspace-page-heading">
        <div>
          <h1>문의·견적</h1>
          <p>여러 챗봇으로 접수된 신청을 한곳에서 확인하세요.</p>
        </div>
      </header>
      <section className="workspace-panel">
        <header className="workspace-request-toolbar">
          <nav className="workspace-filter-tabs" aria-label="신청 상태">
            {[["", "전체"], ...Object.entries(labels)].map(([value, label]) => (
              <Link
                key={value}
                className={status === value ? "selected" : ""}
                href={`/requests?status=${value}&q=${encodeURIComponent(q)}`}
                aria-current={status === value ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <form method="get" className="workspace-search">
            <input type="hidden" name="status" value={status} />
            <input
              aria-label="이름 또는 문의 내용 검색"
              name="q"
              defaultValue={q}
              placeholder="이름 또는 문의 내용"
            />
            <button type="submit">검색</button>
          </form>
        </header>
        <p className="workspace-list-note">
          {rows.length}건 표시 · 최근 100건까지 표시합니다. 신청을 선택하면 해당
          챗봇에서 상세 내용과 처리 상태를 관리할 수 있어요.
        </p>
        {rows.length ? (
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th scope="col">신청자·내용</th>
                  <th scope="col">챗봇</th>
                  <th scope="col">유형</th>
                  <th scope="col">상태</th>
                  <th scope="col">접수일</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)}>
                    <td>
                      <Link href={`/bots/${row.bot_id}/requests`}>
                        <strong>{String(row.name)}</strong>
                        <p>{String(row.message).slice(0, 100)}</p>
                      </Link>
                    </td>
                    <td>{String(row.bot_name)}</td>
                    <td>{row.kind === "quote" ? "견적 요청" : "상담 신청"}</td>
                    <td>
                      <span
                        className={`workspace-status ${row.status === "new" ? "waiting" : ""}`}
                      >
                        {labels[String(row.status)]}
                      </span>
                    </td>
                    <td>
                      {new Date(
                        Number(row.created_at) * 1000,
                      ).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="workspace-empty">
            <strong>
              {q ? "검색 결과가 없어요" : "이 상태의 신청이 없어요"}
            </strong>
            <p>고객이 견적이나 상담을 신청하면 여기에 모아 표시합니다.</p>
          </div>
        )}
      </section>
    </div>
  );
}
