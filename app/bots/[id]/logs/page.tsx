import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, ChatLog } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import BotHeader from "../BotHeader";
import LogsClient from "./LogsClient";
import HelpButton from "@/app/HelpButton";

const HELP = {
  title: "대화 기록 사용방법",
  sections: [
    {
      heading: "대화 기록이란?",
      items: [
        "실제 사용자가 챗봇과 나눈 대화를 세션별로 확인합니다.",
        "어떤 질문이 자주 들어오는지 파악해 Q&A와 문서를 보완하세요.",
      ],
    },
    {
      heading: "보는 방법",
      items: [
        "세션을 클릭하면 해당 대화의 전체 내용을 펼쳐볼 수 있습니다.",
        "날짜·세션 단위로 그룹화되어 표시됩니다.",
      ],
    },
  ],
};

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
    SELECT id, bot_id, session_id, user_message, bot_reply, created_at
    FROM chat_logs WHERE bot_id = ${id}
    ORDER BY created_at ASC
  `) as unknown as ChatLog[];

  return (
    <div className="max-w-3xl">
      <BotHeader bot={bot} current="대화 기록" />
      <div className="flex justify-end mb-4"><HelpButton content={HELP} /></div>
      <LogsClient logs={logs} />
    </div>
  );
}
