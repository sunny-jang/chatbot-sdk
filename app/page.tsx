import Link from "next/link";
import sql from "@/lib/neon";
import { initSchema, Bot } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import HelpButton from "./HelpButton";

const HELP = {
  title: "챗봇 목록 사용방법",
  sections: [
    {
      heading: "챗봇 종류",
      items: [
        "📚 Q&A 봇 — 질문·답변을 직접 등록해 정확히 일치하는 답변을 제공합니다.",
        "✨ AI 봇 — 업로드한 문서를 기반으로 AI가 자유롭게 답변을 생성합니다.",
      ],
    },
    {
      heading: "시작하기",
      items: [
        "'새 챗봇 만들기' 버튼으로 챗봇을 생성합니다.",
        "카드를 클릭하면 설정, 문서, 테스트 등 세부 관리 화면으로 이동합니다.",
      ],
    },
    {
      heading: "빠른 이동",
      items: [
        "카드 하단의 단축 버튼(설정·문서·Q&A·테스트·기록)으로 바로 이동할 수 있습니다.",
      ],
    },
  ],
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await initSchema();
  const tenantId = await getTenantId();
  const bots = (await sql`
    SELECT * FROM bots WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
  `) as unknown as Bot[];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">내 챗봇</h2>
          <p className="text-sm text-gray-500 mt-1">챗봇을 선택해 관리하세요</p>
        </div>
        <div className="flex items-center gap-3">
          <HelpButton content={HELP} />
          <Link
            href="/bots/new"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + 새 챗봇 만들기
          </Link>
        </div>
      </div>

      {bots.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <div className="text-6xl mb-4">🤖</div>
          <p className="text-lg font-medium text-gray-600">아직 챗봇이 없어요</p>
          <p className="text-sm mt-1 mb-6">첫 번째 챗봇을 만들어보세요</p>
          <Link
            href="/bots/new"
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            챗봇 만들기
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {bots.map((bot) => (
            <div
              key={bot.id}
              className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md hover:border-gray-300 transition-all"
            >
              {/* Card header — clickable */}
              <Link href={`/bots/${bot.id}`} className="block p-5 pb-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{bot.type === "qa" ? "📚" : "✨"}</span>
                    <div>
                      <h3 className="font-semibold text-gray-900 leading-tight">{bot.name}</h3>
                      <span
                        className={`inline-block mt-0.5 px-2 py-0.5 text-xs font-medium rounded-full ${
                          bot.type === "qa"
                            ? "bg-green-100 text-green-700"
                            : "bg-purple-100 text-purple-700"
                        }`}
                      >
                        {bot.type === "qa" ? "Q&A 봇" : "AI 봇"}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-300">→</span>
                </div>
                {bot.system_prompt ? (
                  <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
                    {bot.system_prompt}
                  </p>
                ) : (
                  <p className="text-xs text-gray-300 italic">시스템 프롬프트 없음</p>
                )}
              </Link>

              {/* Quick actions */}
              <div className="border-t border-gray-100 px-4 py-3 flex items-center gap-1.5 flex-wrap">
                <Link
                  href={`/bots/${bot.id}`}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  ⚙️ 설정
                </Link>
                {bot.type === "ai" && (
                  <Link
                    href={`/bots/${bot.id}/docs`}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    📄 문서
                  </Link>
                )}
                {bot.type === "qa" && (
                  <Link
                    href={`/bots/${bot.id}/qa`}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    💬 Q&A
                  </Link>
                )}
                <Link
                  href={`/bots/${bot.id}/analytics`}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
                >
                  📊 분석
                </Link>
                <Link
                  href={`/bots/${bot.id}/test`}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  ▶ 테스트
                </Link>
                <Link
                  href={`/bots/${bot.id}/logs`}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  📋 기록
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
