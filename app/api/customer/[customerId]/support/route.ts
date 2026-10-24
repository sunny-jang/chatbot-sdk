import { after } from "next/server";
import sql from "@/lib/neon";
import { customerAccess, portalUser } from "@/lib/customer-portal/auth";
import { body, failure, sameOrigin } from "@/lib/customer-portal/input";
import {
  readCustomerInbox,
  readCustomerMessages,
  mutateCustomerSupport,
} from "@/lib/customer-portal/support";
import type { AccessDatabase } from "@/lib/access/schema";
import { fanOutToSupportChannels } from "@/lib/support";
type Context = { params: Promise<{ customerId: string }> };
export async function GET(req: Request, { params }: Context) {
  try {
    const { customerId } = await params;
    const { user } = await customerAccess(customerId);
    const p = new URL(req.url).searchParams;
    const session = p.get("sessionId");
    if (session)
      return Response.json(
        await readCustomerMessages(user.id, customerId, session.slice(0, 200)),
      );
    const status = p.get("status") || "";
    return Response.json(
      await readCustomerInbox(
        user.id,
        customerId,
        ["waiting", "active", "closed"].includes(status) ? status : "",
        (p.get("q") || "").trim().slice(0, 100),
        (p.get("selectedSession") || "").slice(0, 200),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
async function mutate(req: Request, { params }: Context, isMessage: boolean) {
  try {
    sameOrigin(req);
    const { customerId } = await params,
      user = await portalUser(),
      input = await body(req);
    const result = await sql.begin((tx) =>
      mutateCustomerSupport(tx as unknown as AccessDatabase, user, customerId, {
        ...input,
        action: isMessage ? "message" : input.action,
      }),
    );
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
    return Response.json("message" in result ? result.message : { ok: true });
  } catch (e) {
    return failure(e);
  }
}
export const POST = (req: Request, c: Context) => mutate(req, c, true);
export const PATCH = (req: Request, c: Context) => mutate(req, c, false);
