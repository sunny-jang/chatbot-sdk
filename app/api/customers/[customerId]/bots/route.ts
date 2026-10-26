import { randomUUID } from "node:crypto";
import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { agencyOwner, lockAccess } from "@/lib/customer-portal/auth";
import {
  body,
  failure,
  sameOrigin,
  text,
  PortalError,
} from "@/lib/customer-portal/input";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  try {
    sameOrigin(req);
    const { customerId } = await params,
      { user, tenantId } = await agencyOwner(),
      input = await body(req),
      botId = text(input.botId, "챗봇", 200);
    await sql.begin(async (tx) => {
      const db = tx as unknown as AccessDatabase;
      const [before] =
        await tx`SELECT customer_id FROM bots WHERE id=${botId} AND tenant_id=${tenantId}`;
      if (!before) throw new PortalError("챗봇을 찾을 수 없습니다.", 404);
      const scopes = [
        customerId,
        ...(before.customer_id ? [String(before.customer_id)] : []),
      ].sort();
      await tx`SELECT id FROM customers WHERE id=ANY(${scopes}) ORDER BY id FOR UPDATE`;
      const grant = await lockAccess(db, user.id, customerId, "bot.move");
      const [b] =
        await tx`SELECT id,customer_id FROM bots WHERE id=${botId} AND tenant_id=${grant.tenant_id} FOR UPDATE`;
      if (!b) throw new PortalError("챗봇을 찾을 수 없습니다.", 404);
      if (b.customer_id !== before.customer_id)
        throw new PortalError(
          "챗봇 소속이 변경되었습니다. 다시 시도해주세요.",
          409,
        );
      if (b.customer_id === customerId) return;
      const [used] =
        await tx`SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE bot_id=${botId}) OR EXISTS(SELECT 1 FROM chat_logs WHERE bot_id=${botId}) OR EXISTS(SELECT 1 FROM customer_requests WHERE bot_id=${botId}) AS used`;
      if (used.used)
        throw new PortalError(
          "대화·신청 기록이 있는 챗봇은 다른 고객사로 이동할 수 없습니다. 새 챗봇을 연결해주세요.",
          409,
        );
      await tx`UPDATE bots SET customer_id=${customerId} WHERE id=${botId}`;
      await tx`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${user.id},${grant.tenant_id},${customerId},'bot.move',${botId},'success')`;
    });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
