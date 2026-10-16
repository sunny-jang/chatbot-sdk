import Link from "next/link";
import { redirect } from "next/navigation";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
export const dynamic = "force-dynamic";

type Work = {
  id: string;
  session_id: string;
  customer_name: string | null;
  bot_name: string;
  reason: string | null;
};
type RequestItem = {
  id: string;
  bot_id: string;
  name: string;
  kind: string;
  bot_name: string;
};
export default async function HomePage() {
  const tenantId = await getTenantId();
  if (!tenantId) redirect("/brochure.html");
  await initSchema();
  const [counts, waiting, requests, bots] = await Promise.all([
    sql`SELECT (SELECT COUNT(*)::int FROM support_handoffs h JOIN chat_sessions s ON s.id=h.session_id WHERE s.tenant_id=${tenantId} AND h.status='waiting') AS waiting,
      (SELECT COUNT(*)::int FROM support_handoffs h JOIN chat_sessions s ON s.id=h.session_id WHERE s.tenant_id=${tenantId} AND h.status='active') AS active,
      (SELECT COUNT(*)::int FROM customer_requests WHERE tenant_id=${tenantId} AND status='new') AS requests,
      (SELECT COUNT(*)::int FROM bots WHERE tenant_id=${tenantId}) AS bots`,
    sql`SELECT h.id,h.session_id,s.customer_name,b.name AS bot_name,h.reason FROM support_handoffs h JOIN chat_sessions s ON s.id=h.session_id JOIN bots b ON b.id=h.bot_id WHERE s.tenant_id=${tenantId} AND h.status='waiting' ORDER BY h.requested_at ASC LIMIT 5`,
    sql`SELECT r.id,r.bot_id,r.name,r.kind,b.name AS bot_name FROM customer_requests r JOIN bots b ON b.id=r.bot_id WHERE r.tenant_id=${tenantId} AND r.status='new' ORDER BY r.created_at ASC LIMIT 5`,
    sql`SELECT id,name,type FROM bots WHERE tenant_id=${tenantId} ORDER BY created_at DESC LIMIT 4`,
  ]);
  const stats = counts[0];
  return (
    <div className="workspace-page">
      <header className="workspace-page-heading">
        <div>
          <h1>오늘의 업무</h1>
          <p>기다리는 고객부터 확인하고, 필요한 업무를 이어가세요.</p>
        </div>
        <Link className="workspace-primary" href="/support">
          상담함 열기
        </Link>
      </header>
      <section className="workspace-metrics" aria-label="현재 업무 현황">
        {[
          ["대기 중인 상담", stats.waiting, "/support", "waiting"],
          ["진행 중인 상담", stats.active, "/support", "active"],
          ["새 문의·견적", stats.requests, "/requests", "requests"],
          ["운영 챗봇", stats.bots, "/bots", "bots"],
        ].map(([label, count, href, key]) => (
          <Link
            href={String(href)}
            key={key}
            className={`workspace-metric ${key}`}
          >
            <span>{label}</span>
            <strong>
              {count}
              <small>{key === "bots" ? "개" : "건"}</small>
            </strong>
            <span className="workspace-metric-action">확인하기</span>
          </Link>
        ))}
      </section>
      <div className="workspace-work-grid">
        <section className="workspace-panel">
          <header>
            <div>
              <h2>답변을 기다리고 있어요</h2>
              <p>오래 기다린 상담부터 표시합니다.</p>
            </div>
            <Link href="/support">전체 보기</Link>
          </header>
          {waiting.length ? (
            <div>
              {(waiting as unknown as Work[]).map((item) => (
                <Link
                  className="workspace-work-row"
                  key={item.id}
                  href={`/support?session=${encodeURIComponent(item.session_id)}`}
                >
                  <span className="workspace-customer-initial">
                    {(item.customer_name || "고객").slice(0, 1)}
                  </span>
                  <div>
                    <strong>{item.customer_name || "방문 고객"}</strong>
                    <p>
                      {item.bot_name} · {item.reason || "담당자 연결 요청"}
                    </p>
                  </div>
                  <span className="workspace-status waiting">상담 대기</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="workspace-empty">
              <strong>대기 중인 상담이 없어요</strong>
              <p>고객이 담당자 연결을 요청하면 여기에 표시됩니다.</p>
            </div>
          )}
        </section>
        <section className="workspace-panel">
          <header>
            <div>
              <h2>새로 접수된 문의</h2>
              <p>확인이 필요한 견적·상담 신청입니다.</p>
            </div>
            <Link href="/requests">전체 보기</Link>
          </header>
          {requests.length ? (
            <div>
              {(requests as unknown as RequestItem[]).map((item) => (
                <Link
                  className="workspace-work-row"
                  key={item.id}
                  href={`/bots/${item.bot_id}/requests`}
                >
                  <div>
                    <strong>{item.name}</strong>
                    <p>{item.bot_name}</p>
                  </div>
                  <span className="workspace-status">
                    {item.kind === "quote" ? "견적 요청" : "상담 신청"}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="workspace-empty">
              <strong>새로 접수된 문의가 없어요</strong>
              <p>챗봇에서 신청한 견적과 상담 문의를 모아 보여드려요.</p>
            </div>
          )}
        </section>
      </div>
      <section className="workspace-panel workspace-bots-overview">
        <header>
          <div>
            <h2>챗봇 바로가기</h2>
            <p>답변 지식을 보완하거나 실제 동작을 확인하세요.</p>
          </div>
          <Link href="/bots">챗봇 관리</Link>
        </header>
        {bots.length ? (
          <div className="workspace-bot-rows">
            {bots.map((bot) => (
              <div key={String(bot.id)}>
                <span className="workspace-bot-symbol" aria-hidden="true">
                  ◇
                </span>
                <div>
                  <strong>{String(bot.name)}</strong>
                  <p>{bot.type === "qa" ? "질문과 답변 중심" : "AI 상담"}</p>
                </div>
                <Link href={`/bots/${bot.id}/test`}>테스트</Link>
                <Link href={`/bots/${bot.id}`}>관리</Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="workspace-empty">
            <strong>첫 챗봇을 만들어 보세요</strong>
            <p>
              답변할 내용을 등록하고 홈페이지에 설치하면 고객을 응대할 수
              있어요.
            </p>
            <Link className="workspace-primary" href="/bots/new">
              챗봇 만들기
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
