import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot } from "@/lib/db";
import BotSettings from "./BotSettings";
import CopyButton from "./CopyButton";

async function getBot(id: string): Promise<Bot | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/bots/${id}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function BotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bot = await getBot(id);
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
        <div>
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
        </div>
        {bot.type === "qa" && (
          <Link
            href={`/bots/${bot.id}/qa`}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
          >
            Q&A 관리 →
          </Link>
        )}
      </div>

      {/* 설정 편집 */}
      <BotSettings bot={bot} />

      {/* 임베드 코드 */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-1">임베드 코드</h3>
        <p className="text-sm text-gray-500 mb-3">
          웹사이트 <code className="bg-gray-100 px-1 rounded text-xs">&lt;/body&gt;</code> 태그 바로 위에 붙여넣으세요
        </p>
        <div className="relative">
          <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded-lg overflow-x-auto">
            {embedCode}
          </pre>
          <CopyButton text={embedCode} />
        </div>
      </div>
    </div>
  );
}

