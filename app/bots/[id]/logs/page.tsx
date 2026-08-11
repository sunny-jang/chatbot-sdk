import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, ChatLog } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import BotHeader from "../BotHeader";
import LogsClient from "./LogsClient";

export const dynamic = "force-dynamic";

export default async function LogsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantId = await getTenantId();
  const botRows = await sql`SELECT * FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  const bot = botRows[0] as unknown as Bot | undefined;
  if (!bot) notFound();

  const logs = (await sql`
    SELECT id, bot_id, session_id, user_message, bot_reply, created_at
    FROM chat_logs WHERE bot_id = ${id}
    ORDER BY created_at ASC
  `) as unknown as ChatLog[];

  return (
    <div className="max-w-3xl">
      <BotHeader bot={bot} current="대화 기록" />
      <LogsClient logs={logs} />
    </div>
  );
}
