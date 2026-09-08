import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { getEmbeddings } from "@/lib/embeddings";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";

async function getTenantId() { return (await cookies()).get("tenant_id")?.value ?? null; }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await initSchema();
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: botId } = await params;
  const owned = await sql`SELECT id FROM bots WHERE id = ${botId} AND tenant_id = ${tenantId}`;
  if (!owned[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "엑셀 파일을 선택해주세요." }, { status: 400 });

  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const folderIds = new Map<string, string>();
  const rows: { folder: string; question: string; answer: string }[] = [];

  for (const sheetName of workbook.SheetNames.slice(0, 7)) {
    const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "" });
    const headerIndex = values.findIndex((row) => row.some((cell) => String(cell).trim() === "질문"));
    if (headerIndex < 0) continue;
    const header = values[headerIndex].map((cell) => String(cell).trim());
    const questionIndex = header.indexOf("질문");
    const answerIndex = header.indexOf("질문상세") >= 0 ? header.indexOf("질문상세") : questionIndex + 1;
    let pending: { folder: string; question: string; answer: string } | null = null;
    for (const raw of values.slice(headerIndex + 1)) {
      const row = raw.map((cell) => String(cell ?? "").trim());
      const question = row[questionIndex] ?? "";
      const answerParts = row.slice(answerIndex).filter(Boolean);
      if (question) {
        if (pending) rows.push(pending);
        pending = answerParts.length ? { folder: sheetName, question, answer: answerParts.join("\n\n") } : null;
      } else if (pending && answerParts.length) {
        pending.answer += `\n\n${answerParts.join("\n\n")}`;
      }
    }
    if (pending) rows.push(pending);
  }

  const apiKey = await getTenantApiKeyByTenantId(tenantId);
  const embeddings = await getEmbeddings(rows.map((item) => item.question), apiKey);
  const prepared: { item: typeof rows[number]; folderId: string; embedding: string }[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const item = rows[index];
    let folderId = folderIds.get(item.folder);
    if (!folderId) {
      const existing = await sql`SELECT id FROM qa_folders WHERE bot_id = ${botId} AND name = ${item.folder}`;
      folderId = (existing[0]?.id as string | undefined) ?? randomUUID();
      if (!existing[0]) await sql`INSERT INTO qa_folders (id, bot_id, name) VALUES (${folderId}, ${botId}, ${item.folder})`;
      folderIds.set(item.folder, folderId);
    }
    prepared.push({ item, folderId, embedding: JSON.stringify(embeddings[index]) });
  }
  const imported: unknown[] = [];
  for (let index = 0; index < prepared.length; index += 8) {
    const batch = await Promise.all(prepared.slice(index, index + 8).map(async ({ item, folderId, embedding }) => {
      const existing = await sql`SELECT id FROM qa_pairs WHERE bot_id = ${botId} AND question = ${item.question}`;
      const result = existing[0]
        ? await sql`UPDATE qa_pairs SET folder_id = ${folderId}, answer = ${item.answer}, embedding = ${embedding} WHERE id = ${existing[0].id} RETURNING id, bot_id, folder_id, question, answer, created_at`
        : await sql`INSERT INTO qa_pairs (id, bot_id, folder_id, question, answer, embedding) VALUES (${randomUUID()}, ${botId}, ${folderId}, ${item.question}, ${item.answer}, ${embedding}) RETURNING id, bot_id, folder_id, question, answer, created_at`;
      return result[0];
    }));
    imported.push(...batch);
  }
  return NextResponse.json({ imported, folders: [...folderIds.keys()], count: imported.length });
}
