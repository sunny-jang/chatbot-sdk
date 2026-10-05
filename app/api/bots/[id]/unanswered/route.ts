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

type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    await adminBot(id);
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "pending";
    if (!["pending", "resolved", "excluded", "all"].includes(status))
      throw new OperationError("상태를 확인해주세요.");
    const days = Math.min(
      365,
      Math.max(1, Number(url.searchParams.get("days")) || 30),
    );
    const page = Math.max(
      1,
      Math.floor(Number(url.searchParams.get("page")) || 1),
    );
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const rows =
      await sql`SELECT l.id,l.user_message AS question,l.bot_reply,l.session_id,l.created_at,
      CASE WHEN r.status='resolved' AND r.qa_id IS NULL THEN 'pending' ELSE COALESCE(r.status,'pending') END AS status,
      r.qa_id,q.question AS linked_question, (r.status='resolved' AND r.qa_id IS NULL) AS deleted_answer,
      COUNT(*) OVER() AS total
      FROM chat_logs l LEFT JOIN unanswered_reviews r ON r.log_id=l.id LEFT JOIN qa_pairs q ON q.id=r.qa_id
      WHERE l.bot_id=${id} AND l.qa_matched=FALSE AND l.created_at>=${since}
      AND (${status}='all' OR CASE WHEN r.status='resolved' AND r.qa_id IS NULL THEN 'pending' ELSE COALESCE(r.status,'pending') END=${status})
      ORDER BY l.created_at DESC,l.id LIMIT 20 OFFSET ${(page - 1) * 20}`;
    const folders =
      await sql`SELECT id,name FROM qa_folders WHERE bot_id=${id} ORDER BY name`;
    return Response.json({
      items: rows,
      total: Number(rows[0]?.total || 0),
      page,
      folders,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { tenantId } = await adminBot(id);
    const body = await jsonBody(req);
    const logId = boundedText(body.logId, "질문 ID", 200);
    const logs =
      await sql`SELECT id FROM chat_logs WHERE id=${logId} AND bot_id=${id} AND qa_matched=FALSE`;
    if (!logs[0])
      throw new OperationError("미응답 질문을 찾을 수 없습니다.", 404);
    const existing =
      await sql`SELECT qa_id FROM unanswered_reviews WHERE log_id=${logId} AND status='resolved' AND qa_id IS NOT NULL`;
    if (existing[0]) return Response.json({ qaId: existing[0].qa_id });
    let qaId: string;
    let embedding: number[] | null = null;
    let question = "",
      answer = "";
    const folderId = body.folderId
      ? boundedText(body.folderId, "폴더", 200)
      : null;
    if (
      folderId &&
      !(
        await sql`SELECT id FROM qa_folders WHERE id=${folderId} AND bot_id=${id}`
      )[0]
    )
      throw new OperationError("폴더를 찾을 수 없습니다.", 404);
    if (body.qaId) {
      qaId = boundedText(body.qaId, "Q&A", 200);
      if (
        !(
          await sql`SELECT id FROM qa_pairs WHERE id=${qaId} AND bot_id=${id}`
        )[0]
      )
        throw new OperationError("Q&A를 찾을 수 없습니다.", 404);
    } else {
      question = boundedText(body.question, "질문", 2000);
      answer = boundedText(body.answer, "답변", 20000);
      const duplicates =
        await sql`SELECT id,question FROM qa_pairs WHERE bot_id=${id} AND lower(regexp_replace(trim(question),'[[:space:]]+',' ','g'))=lower(regexp_replace(trim(${question}),'[[:space:]]+',' ','g')) LIMIT 1`;
      if (duplicates[0])
        return Response.json(
          {
            error: "동일 질문이 있습니다. 기존 Q&A를 연결하세요.",
            duplicate: duplicates[0],
          },
          { status: 409 },
        );
      const key = await getTenantApiKeyByTenantId(tenantId);
      if (!key)
        throw new OperationError("설정에서 OpenAI API 키를 등록해주세요.");
      embedding = await getEmbedding(question, key);
      qaId = randomUUID();
    }
    const result = await sql.begin(async (tx) => {
      await tx`SELECT id FROM chat_logs WHERE id=${logId} FOR UPDATE`;
      const done =
        await tx`SELECT qa_id FROM unanswered_reviews WHERE log_id=${logId} AND status='resolved' AND qa_id IS NOT NULL`;
      if (done[0]) return String(done[0].qa_id);
      if (embedding)
        await tx`INSERT INTO qa_pairs(id,bot_id,folder_id,question,answer,embedding) VALUES(${qaId},${id},${folderId},${question},${answer},${JSON.stringify(embedding)})`;
      await tx`INSERT INTO unanswered_reviews(log_id,bot_id,status,qa_id) VALUES(${logId},${id},'resolved',${qaId}) ON CONFLICT(log_id) DO UPDATE SET status='resolved',qa_id=EXCLUDED.qa_id,updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT`;
      return qaId;
    });
    return Response.json({ qaId: result }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    await adminBot(id);
    const body = await jsonBody(req);
    const logId = boundedText(body.logId, "질문 ID", 200);
    if (body.status !== "pending" && body.status !== "excluded")
      throw new OperationError("상태를 확인해주세요.");
    if (
      !(
        await sql`SELECT id FROM chat_logs WHERE id=${logId} AND bot_id=${id} AND qa_matched=FALSE`
      )[0]
    )
      throw new OperationError("질문을 찾을 수 없습니다.", 404);
    await sql`INSERT INTO unanswered_reviews(log_id,bot_id,status) VALUES(${logId},${id},${body.status}) ON CONFLICT(log_id) DO UPDATE SET status=EXCLUDED.status,qa_id=NULL,updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT`;
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
