import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import BotSettings from "./BotSettings";
import CopyButton from "./CopyButton";
import BotHeader from "./BotHeader";
import HelpButton from "@/app/HelpButton";

const HELP = {
  title: "봇 설정 사용방법",
  sections: [
    {
      heading: "기본 설정",
      items: [
        "봇 이름과 유형(Q&A·AI)을 설정합니다. 유형은 생성 후 변경할 수 없습니다.",
        "AI 봇은 시스템 프롬프트로 봇의 역할과 말투를 정의합니다.",
        "모델을 선택하면 응답 품질과 비용이 달라집니다. gpt-4o-mini가 기본값입니다.",
      ],
    },
    {
      heading: "위젯 커스터마이징",
      items: [
        "위젯 제목과 색상을 변경해 사이트 디자인에 맞출 수 있습니다.",
        "첫 인사말은 채팅창이 열릴 때 봇이 먼저 보내는 메시지입니다.",
      ],
    },
    {
      heading: "임베드 코드",
      items: [
        "코드를 복사해 웹사이트 </body> 태그 위에 붙여넣으면 채팅 위젯이 활성화됩니다.",
      ],
    },
  ],
};

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
      <div className="flex justify-end mb-4"><HelpButton content={HELP} /></div>

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
