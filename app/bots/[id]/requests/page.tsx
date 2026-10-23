import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { initSchema, type Bot } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import { isRestrictedBot, REQUESTS_NOTICE } from "@/lib/access/visibility";
import BotHeader from "../BotHeader";
import OperationsSettings from "@/app/components/OperationsSettings";
import RequestsManager from "@/app/components/RequestsManager";
export const dynamic = "force-dynamic";
export default async function RequestsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await initSchema();
  const tenant = await getTenantId();
  const rows =
    await sql`SELECT * FROM bots WHERE id=${id} AND tenant_id=${tenant}`;
  if (!rows[0]) notFound();
  if (tenant && (await isRestrictedBot(sql, tenant, id)))
    return (
      <div className="max-w-6xl">
        <BotHeader bot={rows[0] as unknown as Bot} current="견적·상담 신청" />
        <div className="workspace-panel" style={{ padding: 28, marginTop: 16 }}>
          <strong style={{ display: "block", fontSize: 15, marginBottom: 8 }}>
            고객사가 직접 처리하는 접수
          </strong>
          <p style={{ fontSize: 14, color: "var(--steel)", lineHeight: 1.7 }}>
            {REQUESTS_NOTICE} 접수 폼 설정은 고객사 관리자가 챗봇 관리에서 변경합니다.
          </p>
        </div>
      </div>
    );
  return (
    <div className="max-w-6xl">
      <BotHeader bot={rows[0] as unknown as Bot} current="견적·상담 신청" />
      <OperationsSettings botId={id} />
      <RequestsManager botId={id} />
    </div>
  );
}
