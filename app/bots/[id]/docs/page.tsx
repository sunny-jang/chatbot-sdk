import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, Document, DocFolder } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import DocsManager from "./DocsManager";
import BotHeader from "../BotHeader";
import HelpButton from "@/app/HelpButton";

const HELP = {
  title: "문서 관리 사용방법",
  sections: [
    {
      heading: "문서란?",
      items: [
        "AI 봇이 답변할 때 참고하는 지식 베이스입니다.",
        "제품 설명서, FAQ, 정책 문서 등 텍스트 자료를 등록하세요.",
      ],
    },
    {
      heading: "등록 방법",
      items: [
        "제목과 내용을 입력해 문서를 추가합니다.",
        "폴더를 만들어 문서를 카테고리별로 분류할 수 있습니다.",
      ],
    },
    {
      heading: "검색(RAG) 동작 방식",
      items: [
        "사용자가 질문하면 문서 중 관련성 높은 내용을 자동으로 찾아 AI에 제공합니다.",
        "문서 내용이 상세하고 명확할수록 답변 품질이 높아집니다.",
      ],
    },
  ],
};

export const dynamic = "force-dynamic";

export default async function DocsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantId = await getTenantId();
  const botRows = await sql`SELECT * FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  const bot = botRows[0] as unknown as Bot | undefined;
  if (!bot) notFound();

  const folders = (await sql`
    SELECT id, bot_id, name, parent_id, created_at
    FROM doc_folders WHERE bot_id = ${id} ORDER BY name ASC
  `) as unknown as DocFolder[];

  const docs = (await sql`
    SELECT id, bot_id, folder_id, title, content, created_at
    FROM documents WHERE bot_id = ${id} ORDER BY created_at DESC
  `) as unknown as Document[];

  return (
    <div className="max-w-5xl">
      <BotHeader bot={bot} current="문서 관리" />
      <div className="flex justify-end mb-4"><HelpButton content={HELP} /></div>
      <DocsManager botId={id} initialDocs={docs} initialFolders={folders} />
    </div>
  );
}
