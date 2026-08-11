import Link from "next/link";
import { notFound } from "next/navigation";
import QaManager from "./QaManager";

async function getBot(id: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/bots/${id}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  return res.json();
}

async function getQaPairs(botId: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/bots/${botId}/qa`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  return res.json();
}

export default async function QaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bot, pairs] = await Promise.all([getBot(id), getQaPairs(id)]);
  if (!bot) notFound();

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-gray-900">챗봇 목록</Link>
        <span>/</span>
        <Link href={`/bots/${id}`} className="hover:text-gray-900">{bot.name}</Link>
        <span>/</span>
        <span className="text-gray-900">Q&A 관리</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Q&A 관리</h2>
          <p className="text-sm text-gray-500 mt-1">
            질문과 답변을 등록하면 AI가 시맨틱 매칭으로 응답합니다
          </p>
        </div>
      </div>

      <QaManager botId={id} initialPairs={pairs} />
    </div>
  );
}
