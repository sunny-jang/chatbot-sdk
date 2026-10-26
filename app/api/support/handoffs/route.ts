import { agencyOwner } from "@/lib/customer-portal/auth";
import {
  body,
  failure,
  sameOrigin,
  text,
  PortalError,
} from "@/lib/customer-portal/input";
import { mutateCustomerSupport } from "@/lib/customer-portal/support";
import type { AccessDatabase } from "@/lib/access/schema";
import { after } from "next/server";
import { processJobs } from "@/lib/operations/jobs";
import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { fanOutToSupportChannels } from "@/lib/support";
import { readTenantId } from "@/lib/auth";
import { readSupportInbox } from "@/lib/support-inbox-query";

async function tenantId() {
  return (await readTenantId()) ?? null;
}

export const maxDuration = 60;

export async function GET(req: Request) {
  const tenant = await tenantId();
  if (!tenant)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await initSchema();
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (sessionId) {
    const sessions =
      await sql`SELECT id FROM chat_sessions WHERE id = ${sessionId} AND tenant_id = ${tenant}`;
    if (!sessions[0])
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(
      await sql`SELECT id, sender_type, sender_name, content, source, created_at FROM chat_messages WHERE session_id = ${sessionId} ORDER BY created_at ASC`,
    );
  }
  const params = new URL(req.url).searchParams;
  const requestedStatus = params.get("status") || "";
  const status = ["waiting", "active", "closed"].includes(requestedStatus)
    ? requestedStatus
    : "";
  const rows = await readSupportInbox(
    tenant,
    status,
    (params.get("q") || "").trim().slice(0, 100),
    (params.get("selectedSession") || "").slice(0, 200),
  );
  after(async () => {
    await processJobs(4).catch(() => undefined);
  });
  return NextResponse.json(rows);
}

/** Agency and customer portals use the same locked state machine and actor identity. */
async function mutate(req: Request, isMessage: boolean) {
  try {
    sameOrigin(req);
    const { user, tenantId } = await agencyOwner();
    const input = await body(req);
    const sessionId = text(input.sessionId, "상담", 200);
    const result = await sql.begin(async (tx) => {
      const [target] =
        await tx`SELECT b.customer_id FROM chat_sessions s JOIN bots b ON b.id=s.bot_id AND b.tenant_id=s.tenant_id WHERE s.id=${sessionId} AND s.tenant_id=${tenantId}`;
      if (!target) throw new PortalError("상담을 찾을 수 없습니다.", 404);
      if (!target.customer_id)
        throw new PortalError("고객사 이관 후 상담할 수 있습니다.", 503);
      return mutateCustomerSupport(
        tx as unknown as AccessDatabase,
        user,
        String(target.customer_id),
        { ...input, action: isMessage ? "message" : input.action },
      );
    });
    if (result.refs) {
      const refs = result.refs;
      after(async () => {
        await fanOutToSupportChannels(
          String(refs.bot_id),
          {
            telegram_topic_id: refs.telegram_topic_id as number | null,
            slack_thread_ts: refs.slack_thread_ts as string | null,
          },
          isMessage
            ? `담당자(${user.name}): ${String(input.message).trim()}`
            : "상담이 종료되었습니다.",
        ).catch(() => {});
      });
    }
    return NextResponse.json(
      "message" in result ? result.message : { ok: true },
    );
  } catch (e) {
    return failure(e);
  }
}
export const POST = (req: Request) => mutate(req, true);
export const PATCH = (req: Request) => mutate(req, false);
