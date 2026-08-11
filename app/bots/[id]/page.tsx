import Link from "next/link";
import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import BotSettings from "./BotSettings";
import CopyButton from "./CopyButton";

export const dynamic = "force-dynamic";

export default async function BotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantId = await getTenantId();
  const rows = await sql`SELECT * FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  const bot = rows[0] as unknown as Bot | undefined;
  if (!bot) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const embedCode = `<script src="${baseUrl}/chatbot-widget.js" data-bot-id="${bot.id}" data-endpoint="${baseUrl}"></script>`;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-gray-900">챗봇 목록</Link>
        <span>/</span>
        <span className="text-gray-900">{bot.name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-gray-900">{bot.name}</h2>
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              bot.type === "qa"
                ? "bg-green-100 text-green-700"
                : "bg-purple-100 text-purple-700"
            }`}
          >
            {bot.type === "qa" ? "Q&A 봇" : "AI 봇"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {bot.type === "qa" && (
            <Link
              href={`/bots/${bot.id}/qa`}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Q&A 관리
            </Link>
          )}
          <Link
            href={`/bots/${bot.id}/docs`}
            className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors"
          >
            📄 문서
          </Link>
          <Link
            href={`/bots/${bot.id}/logs`}
            className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            💬 대화 기록
          </Link>
        </div>
      </div>

      <BotSettings bot={bot} />

      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-1">임베드 코드</h3>
        <p className="text-sm text-gray-500 mb-3">
          웹사이트 <code className="bg-gray-100 px-1 rounded text-xs">&lt;/body&gt;</code> 태그 바로 위에 붙여넣으세요
        </p>
        <div className="relative">
          <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
            {embedCode}
          </pre>
          <CopyButton text={embedCode} />
        </div>
      </div>
    </div>
  );
}
