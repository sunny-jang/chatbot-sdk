import Link from "next/link";
import sql from "@/lib/neon";
import { initSchema, Bot } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await initSchema();
  const bots = (await sql`SELECT * FROM bots ORDER BY created_at DESC`) as unknown as Bot[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">챗봇 목록</h2>
          <p className="text-sm text-gray-500 mt-1">생성된 챗봇을 관리하세요</p>
        </div>
        <Link
          href="/bots/new"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 새 챗봇
        </Link>
      </div>

      {bots.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">🤖</div>
          <p className="text-lg font-medium">아직 챗봇이 없어요</p>
          <p className="text-sm mt-1">새 챗봇을 만들어보세요</p>
          <Link
            href="/bots/new"
            className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            첫 챗봇 만들기
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bots.map((bot) => (
            <Link
              key={bot.id}
              href={`/bots/${bot.id}`}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{bot.name}</h3>
                  <span
                    className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                      bot.type === "qa"
                        ? "bg-green-100 text-green-700"
                        : "bg-purple-100 text-purple-700"
                    }`}
                  >
                    {bot.type === "qa" ? "Q&A 봇" : "AI 봇"}
                  </span>
                </div>
                <span className="text-2xl">{bot.type === "qa" ? "📚" : "✨"}</span>
              </div>
              {bot.system_prompt && (
                <p className="mt-3 text-xs text-gray-500 line-clamp-2">{bot.system_prompt}</p>
              )}
              <p className="mt-3 text-xs text-gray-400">
                {new Date(Number(bot.created_at) * 1000).toLocaleDateString("ko-KR")} 생성
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
