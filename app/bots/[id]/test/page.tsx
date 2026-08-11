import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import TestChat from "./TestChat";
import BotHeader from "../BotHeader";

export const dynamic = "force-dynamic";

export default async function TestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantId = await getTenantId();
  const botRows = await sql`SELECT * FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  const bot = botRows[0] as unknown as Bot | undefined;
  if (!bot) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  return (
    <div className="max-w-2xl">
      <BotHeader bot={bot} current="테스트" />
      <TestChat botId={id} endpoint={baseUrl} />
    </div>
  );
}
