import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, QaPair } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import QaManager from "./QaManager";
import BotHeader from "../BotHeader";

export const dynamic = "force-dynamic";

export default async function QaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantId = await getTenantId();
  const botRows = await sql`SELECT * FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  const bot = botRows[0] as unknown as Bot | undefined;
  if (!bot) notFound();

  const pairs = (await sql`
    SELECT id, bot_id, question, answer, created_at
    FROM qa_pairs WHERE bot_id = ${id} ORDER BY created_at DESC
  `) as unknown as QaPair[];

  return (
    <div className="max-w-3xl">
      <BotHeader bot={bot} current="Q&A 관리" />
      <QaManager botId={id} initialPairs={pairs} />
    </div>
  );
}
