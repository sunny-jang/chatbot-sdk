import type { AccessDatabase } from "./schema";

/**
 * Conversation text belongs to the customer. An agency sees aggregates for every bot it
 * operates, but message bodies, session detail and per-conversation drill-down only for bots
 * that are unassigned or belong to its own default customer (우리 회사). Before the customer
 * schema exists nothing is restricted.
 */
export async function restrictedBotIds(
  db: AccessDatabase,
  tenantId: string,
): Promise<Set<string>> {
  const [ready] = await db`SELECT to_regclass('customers') AS customers`;
  if (!ready?.customers) return new Set();
  const rows =
    await db`SELECT b.id FROM bots b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id WHERE b.tenant_id=${tenantId} AND c.is_default=FALSE`;
  return new Set(rows.map((r) => String(r.id)));
}

export async function isRestrictedBot(
  db: AccessDatabase,
  tenantId: string,
  botId: string,
) {
  return (await restrictedBotIds(db, tenantId)).has(botId);
}

export const RESTRICTED_NOTICE =
  "고객사에 배정된 챗봇의 대화 원문은 해당 고객사 상담함에서만 열람할 수 있습니다. 여기에는 집계 수치만 포함됩니다.";
