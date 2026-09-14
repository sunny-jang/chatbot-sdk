import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, initSchema } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import BotHeader from "../BotHeader";
import QaAnalyticsDashboard from "./QaAnalyticsDashboard";
import BotAnalyticsDashboard from "./BotAnalyticsDashboard";

export const dynamic = "force-dynamic";

export default async function BotAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await initSchema();
  const tenantId = await getTenantId();
  const rows = await sql`SELECT * FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  const bot = rows[0] as unknown as Bot | undefined;
  if (!bot) notFound();
  return <div><div className="max-w-6xl"><BotHeader bot={bot} current={bot.type === "qa" ? "Q&A 분석" : "분석"} /></div>{bot.type === "qa" ? <QaAnalyticsDashboard botId={bot.id} botName={bot.name} /> : <BotAnalyticsDashboard botId={bot.id} botName={bot.name} />}</div>;
}
