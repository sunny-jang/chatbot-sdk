import Link from "next/link";
import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, ChatLog } from "@/lib/db";
import { getTenantId } from "@/lib/auth";

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
    SELECT id, bot_id, user_message, bot_reply, created_at
    FROM chat_logs WHERE bot_id = ${id}
    ORDER BY created_at DESC LIMIT 100
  `) as unknown as ChatLog[];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-gray-900">챗봇 목록</Link>
        <span>/</span>
        <Link href={`/bots/${id}`} className="hover:text-gray-900">{bot.name}</Link>
        <span>/</span>
        <span className="text-gray-900">대화 기록</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">대화 기록</h2>
          <p className="text-sm text-gray-500 mt-1">최근 100건 표시</p>
        </div>
        <span className="text-sm text-gray-500">총 {logs.length}건</span>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white border border-gray-200 rounded-xl">
          <div className="text-3xl mb-2">💬</div>
          <p className="text-sm">아직 대화 기록이 없어요</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-xs text-gray-400 mb-3">
                {new Date(Number(log.created_at) * 1000).toLocaleString("ko-KR")}
              </p>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="text-xs font-medium text-blue-600 w-10 shrink-0 pt-0.5">사용자</span>
                  <p className="text-sm text-gray-800 leading-relaxed">{log.user_message}</p>
                </div>
                <div className="flex gap-2">
                  <span className="text-xs font-medium text-green-600 w-10 shrink-0 pt-0.5">봇</span>
                  <p className="text-sm text-gray-600 leading-relaxed">{log.bot_reply}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
