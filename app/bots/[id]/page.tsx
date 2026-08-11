import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import BotSettings from "./BotSettings";
import CopyButton from "./CopyButton";
import BotHeader from "./BotHeader";

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
      <BotHeader bot={bot} current="설정" />

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
