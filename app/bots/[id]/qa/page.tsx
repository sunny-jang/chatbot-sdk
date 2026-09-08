import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, initSchema, QaFolder, QaPair } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import QaManager from "./QaManager";
import BotHeader from "../BotHeader";
import HelpButton from "@/app/HelpButton";

const HELP = {
  title: "Q&A 관리 사용방법",
  sections: [
    {
      heading: "Q&A란?",
      items: [
        "사용자가 질문하면 등록된 답변 중 가장 유사한 것을 찾아 응답합니다.",
        "질문은 다양한 표현으로 등록할수록 매칭 정확도가 높아집니다.",
      ],
    },
    {
      heading: "등록 방법",
      items: [
        "대화형 모드: 채팅하듯 질문과 답변을 하나씩 입력합니다.",
        "묶음 모드: 표 형태로 여러 Q&A를 한번에 입력하고 저장합니다.",
      ],
    },
    {
      heading: "관리 팁",
      items: [
        "항목을 클릭하면 수정할 수 있습니다.",
        "테스트 화면에서 실제로 질문해보고 매칭 결과를 확인하세요.",
      ],
    },
  ],
};

export const dynamic = "force-dynamic";

export default async function QaPage({
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

  const pairs = (await sql`
    SELECT id, bot_id, folder_id, question, answer, created_at
    FROM qa_pairs WHERE bot_id = ${id} ORDER BY created_at DESC
  `) as unknown as QaPair[];
  const folders = (await sql`
    SELECT id, bot_id, name, created_at
    FROM qa_folders WHERE bot_id = ${id} ORDER BY name ASC
  `) as unknown as QaFolder[];

  return (
    <div className="max-w-3xl">
      <BotHeader bot={bot} current="Q&A 관리" />
      <div className="flex justify-end mb-4"><HelpButton content={HELP} /></div>
      <QaManager botId={id} initialPairs={pairs} initialFolders={folders} />
    </div>
  );
}
