import Link from "next/link";
import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, Document, DocFolder } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import DocsManager from "./DocsManager";

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
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-gray-900">챗봇 목록</Link>
        <span>/</span>
        <Link href={`/bots/${id}`} className="hover:text-gray-900">{bot.name}</Link>
        <span>/</span>
        <span className="text-gray-900">문서 관리</span>
      </div>

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">문서 관리</h2>
        <p className="text-sm text-gray-500 mt-1">
          폴더로 문서를 분류하고, AI가 대화 시 관련 내용을 참고합니다
        </p>
      </div>

      <DocsManager botId={id} initialDocs={docs} initialFolders={folders} />
    </div>
  );
}
