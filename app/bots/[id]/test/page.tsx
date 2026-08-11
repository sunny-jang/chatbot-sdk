import Link from "next/link";
import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import TestChat from "./TestChat";

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
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-gray-900">챗봇 목록</Link>
        <span>/</span>
        <Link href={`/bots/${id}`} className="hover:text-gray-900">{bot.name}</Link>
        <span>/</span>
        <span className="text-gray-900">테스트</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">챗봇 테스트</h2>
          <p className="text-sm text-gray-500 mt-1">{bot.name} · {bot.type === "qa" ? "Q&A 봇" : "AI 봇"}</p>
        </div>
      </div>

      <TestChat botId={id} endpoint={baseUrl} />
    </div>
  );
}
