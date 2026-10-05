import { randomUUID } from "crypto";
import { after } from "next/server";
import sql from "@/lib/neon";
import {
  adminBot,
  boundedText,
  failure,
  jsonBody,
  OperationError,
} from "@/lib/operations/http";
import { cleanupOperations, processJobs } from "@/lib/operations/jobs";
type Context = { params: Promise<{ id: string }> };
export const maxDuration = 60;

export async function GET(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { tenantId } = await adminBot(id);
    await cleanupOperations();
    const url = new URL(req.url),
      requestId = url.searchParams.get("requestId");
    if (requestId) {
      const rows =
        await sql`SELECT * FROM customer_requests WHERE id=${requestId} AND bot_id=${id} AND tenant_id=${tenantId}`;
      if (!rows[0]) throw new OperationError("접수를 찾을 수 없습니다.", 404);
      const notes =
        await sql`SELECT * FROM request_notes WHERE request_id=${requestId} ORDER BY created_at DESC`;
      const jobs =
        await sql`SELECT channel,status,attempts,last_error FROM operation_jobs WHERE target_id=${requestId} AND kind='request_notification'`;
      const messages = rows[0].session_id
        ? await sql`SELECT sender_type,content,created_at FROM chat_messages WHERE session_id=${rows[0].session_id} ORDER BY created_at,id LIMIT 200`
        : [];
      return Response.json({ ...rows[0], notes, jobs, messages });
    }
    const status = url.searchParams.get("status") || "all",
      kind = url.searchParams.get("kind") || "all",
      search = (url.searchParams.get("search") || "").slice(0, 200);
    if (
      !["all", "new", "in_progress", "completed"].includes(status) ||
      !["all", "quote", "consultation"].includes(kind)
    )
      throw new OperationError("필터를 확인해주세요.");
    const page = Math.max(
        1,
        Math.floor(Number(url.searchParams.get("page")) || 1),
      ),
      days = Math.min(
        365,
        Math.max(1, Number(url.searchParams.get("days")) || 90),
      ),
      since = Math.floor(Date.now() / 1000) - days * 86400;
    const rows =
      await sql`SELECT id,receipt,kind,name,company,message,status,created_at,COUNT(*) OVER() AS total FROM customer_requests
    WHERE bot_id=${id} AND tenant_id=${tenantId} AND created_at>=${since} AND (${status}='all' OR status=${status}) AND (${kind}='all' OR kind=${kind}) AND (${search}='' OR strpos(lower(name||' '||message||' '||receipt),lower(${search}))>0)
    ORDER BY created_at DESC,id LIMIT 20 OFFSET ${(page - 1) * 20}`;
    after(async () => {
      await processJobs(4).catch(() => undefined);
    });
    return Response.json({
      items: rows,
      total: Number(rows[0]?.total || 0),
      page,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { tenantId } = await adminBot(id);
    const body = await jsonBody(req),
      requestId = boundedText(body.requestId, "접수", 200);
    if (
      !(
        await sql`SELECT id FROM customer_requests WHERE id=${requestId} AND bot_id=${id} AND tenant_id=${tenantId}`
      )[0]
    )
      throw new OperationError("접수를 찾을 수 없습니다.", 404);
    if (body.action === "retry") {
      await sql`UPDATE operation_jobs SET status='pending',attempts=0,available_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE target_id=${requestId} AND kind='request_notification' AND status='failed'`;
      after(async () => {
        await processJobs().catch(() => undefined);
      });
    } else if (body.action === "note") {
      const note = boundedText(body.note, "메모", 3000);
      await sql`INSERT INTO request_notes(id,request_id,content) VALUES(${randomUUID()},${requestId},${note})`;
    } else {
      if (!["new", "in_progress", "completed"].includes(String(body.status)))
        throw new OperationError("상태를 확인해주세요.");
      await sql.begin(async (tx) => {
        const before =
          await tx`SELECT status FROM customer_requests WHERE id=${requestId} FOR UPDATE`;
        await tx`UPDATE customer_requests SET status=${String(body.status)},updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${requestId}`;
        if (before[0].status !== body.status)
          await tx`INSERT INTO request_notes(id,request_id,content) VALUES(${randomUUID()},${requestId},${`상태 변경: ${({ new: "신규", in_progress: "처리 중", completed: "완료" } as Record<string, string>)[String(before[0].status)]} → ${({ new: "신규", in_progress: "처리 중", completed: "완료" } as Record<string, string>)[String(body.status)]}`})`;
      });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
