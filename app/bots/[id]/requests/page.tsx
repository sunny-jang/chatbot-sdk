import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { initSchema, type Bot } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
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
  return (
    <div className="max-w-6xl">
      <BotHeader bot={rows[0] as unknown as Bot} current="견적·상담 신청" />
      <OperationsSettings botId={id} />
      <RequestsManager botId={id} />
    </div>
  );
}
