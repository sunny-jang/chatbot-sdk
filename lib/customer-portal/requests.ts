import { randomUUID } from "node:crypto";
import type { AccessDatabase } from "../access/schema";
import { lockAccess } from "./auth";
import { PortalError, text } from "./input";
export async function mutateCustomerRequest(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  input: Record<string, unknown>,
) {
  const grant = await lockAccess(db, userId, customerId, "requests.update"),
    id = text(input.requestId, "접수", 200);
  const [request] =
    await db`SELECT r.id,r.status FROM customer_requests r JOIN bots b ON b.id=r.bot_id AND b.tenant_id=r.tenant_id WHERE r.id=${id} AND r.tenant_id=${grant.tenant_id} AND b.customer_id=${customerId} FOR UPDATE OF r`;
  if (!request) throw new PortalError("접수를 찾을 수 없습니다.", 404);
  if (input.action === "note") {
    const note = text(input.note, "메모", 3000);
    await db`INSERT INTO request_notes(id,request_id,content) VALUES(${randomUUID()},${id},${note})`;
  } else {
    const status = String(input.status);
    if (!["new", "in_progress", "completed"].includes(status))
      throw new PortalError("상태를 확인해주세요.");
    await db`UPDATE customer_requests SET status=${status},updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${id}`;
    if (status !== request.status)
      await db`INSERT INTO request_notes(id,request_id,content) VALUES(${randomUUID()},${id},${"상태 변경: " + request.status + " → " + status})`;
  }
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${userId},${grant.tenant_id},${customerId},${input.action === "note" ? "request.note" : "request.status"},${id},'success')`;
}
