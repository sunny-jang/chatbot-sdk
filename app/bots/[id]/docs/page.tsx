import { notFound } from "next/navigation";
import sql from "@/lib/neon";
import { Bot, Document, DocFolder } from "@/lib/db";
import { getTenantId } from "@/lib/auth";
import DocsManager from "./DocsManager";
import BotHeader from "../BotHeader";

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
      <DocsManager botId={id} initialDocs={docs} initialFolders={folders} />
    </div>
  );
}
