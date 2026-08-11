import Link from "next/link";
import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, QaPair } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import QaManager from "./QaManager";

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
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-gray-900">챗봇 목록</Link>
        <span>/</span>
        <Link href={`/bots/${id}`} className="hover:text-gray-900">{bot.name}</Link>
        <span>/</span>
        <span className="text-gray-900">Q&A 관리</span>
      </div>

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Q&A 관리</h2>
        <p className="text-sm text-gray-500 mt-1">
          질문과 답변을 등록하면 AI가 시맨틱 매칭으로 응답합니다
        </p>
      </div>

      <QaManager botId={id} initialPairs={pairs} />
    </div>
  );
}
