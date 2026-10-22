import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AccessDatabase } from "../access/schema";
import {
  PortalError,
  text,
  tokenHash,
  newToken,
} from "../customer-portal/input";
import { customerBot } from "../customer-portal/bots";
import { publicAddress } from "../operations/web-fetch";
export type PublicDemo = {
  id: string;
  tenant_id: string;
  customer_id: string;
  bot_id: string;
  site_url: string;
  expires_at: number;
  max_requests: number;
  request_count: number;
  customer_name: string;
  bot_name: string;
};
export function demoSiteUrl(value: unknown) {
  const raw = text(value, "홈페이지 주소", 2000);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new PortalError("공개 홈페이지 주소를 입력해주세요.");
  }
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new PortalError("공개 HTTP/HTTPS 홈페이지 주소를 입력해주세요.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    /[.](localhost|local|internal|test|invalid)$/.test(host) ||
    (isIP(host) && !publicAddress(host))
  )
    throw new PortalError("공개 홈페이지 주소만 사용할 수 있습니다.");
  u.hash = "";
  return u.href;
}
export async function checkDemoSite(value: unknown) {
  const url = demoSiteUrl(value),
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string }[];
  try {
    addresses = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true });
  } catch {
    throw new PortalError("홈페이지 도메인을 확인할 수 없습니다.");
  }
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new PortalError("내부 주소는 사용할 수 없습니다.");
  return url;
}
export async function requireDemoSchema(db: AccessDatabase) {
  const [s] =
    await db`SELECT to_regclass('customer_demos') AS demos,to_regclass('demo_turns') AS turns`;
  if (!s.demos || !s.turns)
    throw new PortalError("데모 데이터 준비가 필요합니다.", 503);
}
export async function readPublicDemo(
  db: AccessDatabase,
  token: string,
): Promise<PublicDemo> {
  await requireDemoSchema(db);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token))
    throw new PortalError("사용할 수 없는 데모 링크입니다.", 410);
  const [demo] =
    await db`SELECT d.id,d.tenant_id,d.customer_id,d.bot_id,d.site_url,d.expires_at,d.max_requests,d.request_count,c.name AS customer_name,b.name AS bot_name
 FROM customer_demos d JOIN bots b ON b.id=d.bot_id AND b.customer_id=d.customer_id AND b.tenant_id=d.tenant_id
 JOIN customers c ON c.id=d.customer_id AND c.status='active' JOIN tenants t ON t.id=d.tenant_id AND t.subscription_status='active'
 JOIN users u ON u.id=d.created_by AND u.status='active'
 JOIN partner_memberships p ON p.user_id=u.id AND p.tenant_id=d.tenant_id AND p.status='active'
 WHERE d.token_hash=${tokenHash(token)} AND d.revoked_at IS NULL AND d.expires_at>EXTRACT(EPOCH FROM NOW())`;
  if (!demo) throw new PortalError("만료되었거나 해제된 데모입니다.", 410);
  return demo as unknown as PublicDemo;
}
export async function createDemo(
  db: AccessDatabase,
  userId: string,
  tenantId: string,
  customerId: string,
  botId: string,
  siteUrl: string,
  hours: number,
) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 168)
    throw new PortalError("공유 기간은 1~168시간입니다.");
  await db`SELECT id FROM tenants WHERE id=${tenantId} FOR NO KEY UPDATE`;
  const { grant } = await customerBot(
    db,
    userId,
    customerId,
    botId,
    "bot.read",
    true,
  );
  if (grant.role !== "owner" || grant.tenant_id !== tenantId)
    throw new PortalError("에이전시 소유자만 데모를 만들 수 있습니다.", 403);
  const [active] =
    await db`SELECT count(*)::int AS n FROM customer_demos WHERE tenant_id=${tenantId} AND revoked_at IS NULL AND expires_at>EXTRACT(EPOCH FROM NOW())`;
  if (Number(active.n) >= 20)
    throw new PortalError(
      "활성 데모는 최대 20개입니다. 기존 링크를 해제해주세요.",
      409,
    );
  const id = randomUUID(),
    token = newToken();
  await db`INSERT INTO customer_demos(id,tenant_id,customer_id,bot_id,created_by,token_hash,site_url,expires_at) VALUES(${id},${tenantId},${customerId},${botId},${userId},${tokenHash(token)},${demoSiteUrl(siteUrl)},EXTRACT(EPOCH FROM NOW())::BIGINT+${hours * 3600})`;
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${userId},${tenantId},${customerId},'demo.create',${id},'success')`;
  return { id, token };
}
export async function revokeDemo(
  db: AccessDatabase,
  userId: string,
  tenantId: string,
  id: string,
) {
  const [demo] =
    await db`SELECT customer_id,bot_id FROM customer_demos WHERE id=${id} AND tenant_id=${tenantId}`;
  if (!demo) throw new PortalError("데모를 찾을 수 없습니다.", 404);
  const { grant } = await customerBot(
    db,
    userId,
    String(demo.customer_id),
    String(demo.bot_id),
    "bot.read",
    true,
  );
  if (grant.role !== "owner")
    throw new PortalError("해제 권한이 없습니다.", 403);
  const changed =
    await db`UPDATE customer_demos SET revoked_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${id} AND tenant_id=${tenantId} AND revoked_at IS NULL RETURNING id`;
  if (changed.length)
    await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${userId},${tenantId},${String(demo.customer_id)},'demo.revoke',${id},'success')`;
}
export async function reserveDemoTurn(
  db: AccessDatabase,
  token: string,
  sessionId: string,
  requestId: string,
  message: string,
  qaId: string | null,
) {
  const demo = await readPublicDemo(db, token);
  await db`SELECT id FROM tenants WHERE id=${demo.tenant_id} FOR NO KEY UPDATE`;
  await db`SELECT id FROM customer_demos WHERE id=${demo.id} FOR UPDATE`;
  await readPublicDemo(db, token);
  const digest = tokenHash(message + "\n" + (qaId || ""));
  const [prior] =
    await db`SELECT id,payload_hash,state,reply FROM demo_turns WHERE demo_id=${demo.id} AND session_id=${sessionId} AND request_id=${requestId}`;
  if (prior) {
    if (prior.payload_hash !== digest)
      throw new PortalError("같은 요청 키로 내용을 바꿀 수 없습니다.", 409);
    if (prior.state === "completed")
      return {
        demo,
        id: String(prior.id),
        reply: String(prior.reply),
        duplicate: true,
      };
    throw new PortalError(
      "이미 처리 중이거나 실패한 요청입니다. 잠시 후 다시 시도해주세요.",
      409,
    );
  }
  const [pending] =
    await db`SELECT id FROM demo_turns WHERE demo_id=${demo.id} AND session_id=${sessionId} AND state='pending'`;
  if (pending)
    throw new PortalError(
      "이전 답변을 준비하고 있습니다. 잠시 후 다시 시도해주세요.",
      409,
    );
  const [usage] =
    await db`SELECT request_count FROM customer_demos WHERE id=${demo.id}`;
  if (Number(usage.request_count) >= Number(demo.max_requests))
    throw new PortalError("데모 체험 한도에 도달했습니다.", 429);
  const [daily] =
    await db`SELECT count(*)::int AS n FROM demo_turns m JOIN customer_demos d ON d.id=m.demo_id WHERE d.tenant_id=${demo.tenant_id} AND m.created_at>EXTRACT(EPOCH FROM NOW())-86400`;
  if (Number(daily.n) >= 1000)
    throw new PortalError("에이전시의 일일 데모 한도에 도달했습니다.", 429);
  const id = randomUUID();
  await db`INSERT INTO demo_turns(id,demo_id,session_id,request_id,payload_hash,question) VALUES(${id},${demo.id},${sessionId},${requestId},${digest},${message})`;
  await db`UPDATE customer_demos SET request_count=request_count+1 WHERE id=${demo.id}`;
  return { demo, id, reply: null, duplicate: false };
}
