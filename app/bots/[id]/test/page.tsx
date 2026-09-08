import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, initSchema, QaFolder, QaPair } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import TestChat from "./TestChat";
import BotHeader from "../BotHeader";
import HelpButton from "@/app/HelpButton";

const HELP = {
  title: "테스트 사용방법",
  sections: [
    {
      heading: "테스트 목적",
      items: [
        "실제 위젯과 동일한 환경에서 챗봇 응답을 미리 확인합니다.",
        "Q&A 등록 또는 문서 수정 후 결과를 바로 검증하세요.",
      ],
    },
    {
      heading: "사용 방법",
      items: [
        "채팅창에 질문을 입력하고 Enter 또는 전송 버튼을 누릅니다.",
        "응답이 기대와 다르면 Q&A나 문서 내용을 보완하세요.",
      ],
    },
    {
      heading: "참고",
      items: [
        "테스트 대화는 대화 기록에 저장되지 않습니다.",
        "응답 속도는 선택한 AI 모델과 문서 양에 따라 달라집니다.",
      ],
    },
  ],
};

export const dynamic = "force-dynamic";

export default async function TestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await initSchema();
  const tenantId = await getTenantId();
  const botRows = await sql`SELECT * FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  const bot = botRows[0] as unknown as Bot | undefined;
  if (!bot) notFound();
  const folders = (await sql`SELECT id, bot_id, name, created_at FROM qa_folders WHERE bot_id = ${id} ORDER BY name ASC`) as unknown as QaFolder[];
  const qaPairs = bot.type === "qa"
    ? (await sql`SELECT id, bot_id, folder_id, question, answer, created_at FROM qa_pairs WHERE bot_id = ${id} ORDER BY created_at ASC`) as unknown as QaPair[]
    : [];

  return (
    <div className="max-w-2xl">
      <BotHeader bot={bot} current="테스트" />
      <div className="flex justify-end mb-4"><HelpButton content={HELP} /></div>
      <TestChat botId={id} folders={folders} qaPairs={qaPairs} logoUrl={bot.logo_url} themeColor={bot.widget_color ?? "#a855f7"} />
    </div>
  );
}
