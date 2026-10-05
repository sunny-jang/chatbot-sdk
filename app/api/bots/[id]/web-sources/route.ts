import { randomUUID } from "crypto";
import sql from "@/lib/neon";
import { getEmbedding } from "@/lib/embeddings";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import {
  adminBot,
  boundedText,
  failure,
  jsonBody,
  OperationError,
} from "@/lib/operations/http";
import {
  contentHash,
  fetchPublicHtml,
  normalizeWebUrl,
} from "@/lib/operations/web-fetch";
import { extractPage } from "@/lib/operations/extract";
type Context = { params: Promise<{ id: string }> };
export const maxDuration = 60;
export async function GET(_: Request, { params }: Context) {
  try {
    const { id } = await params;
    await adminBot(id);
    const rows =
      await sql`SELECT w.*,d.title,d.content,d.folder_id FROM web_sources w JOIN documents d ON d.id=w.document_id WHERE w.bot_id=${id} ORDER BY w.applied_at DESC`;
    return Response.json(rows);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { tenantId } = await adminBot(id);
    const body = await jsonBody(req);
    if (body.action === "preview") {
      let source = null;
      let url = normalizeWebUrl(boundedText(body.url, "URL", 2000)).toString();
      if (body.sourceId) {
        const rows =
          await sql`SELECT w.*,d.content FROM web_sources w JOIN documents d ON d.id=w.document_id WHERE w.id=${String(body.sourceId)} AND w.bot_id=${id}`;
        source = rows[0];
        if (!source) throw new OperationError("원본을 찾을 수 없습니다.", 404);
        url = String(source.url);
      } else {
        const existing =
          await sql`SELECT id FROM web_sources WHERE bot_id=${id} AND url=${url}`;
        if (existing[0])
          throw new OperationError(
            "이미 등록된 URL입니다. 목록에서 다시 가져오기를 이용하세요.",
            409,
          );
      }
      try {
        const fetched = await fetchPublicHtml(url);
        const extracted = extractPage(fetched.html);
        const hash = contentHash(extracted.content);
        if (source) {
          await sql`UPDATE web_sources SET checked_at=EXTRACT(EPOCH FROM NOW())::BIGINT,last_error=NULL WHERE id=${source.id}`;
          if (source.source_hash === hash)
            return Response.json({ unchanged: true });
        }
        const previewId = randomUUID();
        await sql`INSERT INTO web_previews(id,bot_id,source_id,url,final_url,title,content,source_hash,base_hash,base_document_hash) VALUES(${previewId},${id},${source ? String(source.id) : null},${url},${fetched.finalUrl},${extracted.title},${extracted.content},${hash},${source ? String(source.source_hash) : null},${source ? contentHash(String(source.content)) : null})`;
        return Response.json({
          previewId,
          ...extracted,
          finalUrl: fetched.finalUrl,
          previousContent: source?.content || null,
        });
      } catch (e) {
        if (source)
          await sql`UPDATE web_sources SET last_error=${e instanceof OperationError ? e.message : "수집 실패"} WHERE id=${source.id}`;
        throw e;
      }
    }
    if (body.action !== "apply")
      throw new OperationError("작업을 확인해주세요.");
    const previewId = boundedText(body.previewId, "미리보기", 200);
    const previews =
      await sql`SELECT * FROM web_previews WHERE id=${previewId} AND bot_id=${id} AND created_at>EXTRACT(EPOCH FROM NOW())-86400`;
    const preview = previews[0];
    if (!preview)
      throw new OperationError(
        "미리보기가 만료되었습니다. 다시 가져와주세요.",
        404,
      );
    const title = boundedText(body.title, "제목", 300),
      content = boundedText(body.content, "본문", 50000);
    const folderId = body.folderId
      ? boundedText(body.folderId, "폴더", 200)
      : null;
    if (
      folderId &&
      !(
        await sql`SELECT id FROM doc_folders WHERE id=${folderId} AND bot_id=${id}`
      )[0]
    )
      throw new OperationError("폴더를 찾을 수 없습니다.", 404);
    const key = await getTenantApiKeyByTenantId(tenantId);
    if (!key) throw new OperationError("OpenAI API 키를 등록해주세요.");
    const embedding = await getEmbedding(content.slice(0, 8000), key);
    const result = await sql.begin(async (tx) => {
      const locked =
        await tx`SELECT id FROM web_previews WHERE id=${previewId} FOR UPDATE`;
      if (!locked[0])
        throw new OperationError("이미 반영한 미리보기입니다.", 409);
      let docId: string;
      if (preview.source_id) {
        const sourceRows =
          await tx`SELECT w.*,d.content FROM web_sources w JOIN documents d ON d.id=w.document_id WHERE w.id=${preview.source_id} AND w.bot_id=${id} FOR UPDATE OF w,d`;
        const source = sourceRows[0];
        if (
          !source ||
          source.source_hash !== preview.base_hash ||
          contentHash(String(source.content)) !== preview.base_document_hash
        )
          throw new OperationError(
            "문서가 변경되었습니다. 다시 가져와 비교해주세요.",
            409,
          );
        docId = String(source.document_id);
        await tx`UPDATE documents SET title=${title},content=${content},folder_id=${folderId},embedding=${JSON.stringify(embedding)} WHERE id=${docId}`;
        await tx`UPDATE web_sources SET final_url=${preview.final_url},source_hash=${preview.source_hash},applied_at=EXTRACT(EPOCH FROM NOW())::BIGINT,last_error=NULL WHERE id=${source.id}`;
      } else {
        await tx`SELECT id FROM bots WHERE id=${id} FOR UPDATE`;
        if (
          (
            await tx`SELECT id FROM web_sources WHERE bot_id=${id} AND url=${preview.url}`
          )[0]
        )
          throw new OperationError("이미 등록된 URL입니다.", 409);
        docId = randomUUID();
        await tx`INSERT INTO documents(id,bot_id,folder_id,title,content,embedding) VALUES(${docId},${id},${folderId},${title},${content},${JSON.stringify(embedding)})`;
        await tx`INSERT INTO web_sources(id,bot_id,document_id,url,final_url,source_hash) VALUES(${randomUUID()},${id},${docId},${preview.url},${preview.final_url},${preview.source_hash})`;
      }
      await tx`DELETE FROM web_previews WHERE id=${previewId}`;
      return docId;
    });
    return Response.json({ documentId: result });
  } catch (e) {
    return failure(e);
  }
}
