import sql from "./neon";

export type MonthlySessionUsage = {
  monthKey: string;
  used: number;
  limit: number;
  percent: number;
  warningLevel: "none" | "notice" | "warning" | "blocked";
};

function billingMonth(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const monthIndex = kst.getUTCMonth();
  return {
    key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    startEpoch: Math.floor((Date.UTC(year, monthIndex, 1) - 9 * 60 * 60 * 1000) / 1000),
  };
}

export function monthlyUsageSummary(used: number, limit: number, monthKey = billingMonth().key): MonthlySessionUsage {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 100;
  const warningLevel = used >= limit ? "blocked" : percent >= 90 ? "warning" : percent >= 80 ? "notice" : "none";
  return { monthKey, used, limit, percent, warningLevel };
}

export async function getMonthlySessionUsage(tenantId: string, limit: number) {
  const month = billingMonth();
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT session_id FROM monthly_chat_sessions
      WHERE tenant_id = ${tenantId} AND month_key = ${month.key}
      UNION
      SELECT cl.session_id
      FROM chat_logs cl
      JOIN bots b ON b.id = cl.bot_id
      WHERE b.tenant_id = ${tenantId}
        AND cl.created_at >= ${month.startEpoch}
        AND cl.session_id <> 'legacy'
    ) sessions
  `;
  return monthlyUsageSummary(Number(rows[0]?.count ?? 0), limit, month.key);
}

export async function reserveMonthlySession(tenantId: string, botId: string, sessionId: string, limit: number) {
  const month = billingMonth();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${month.key}`}))`;

    const existing = await tx`
      SELECT EXISTS (
        SELECT 1 FROM monthly_chat_sessions
        WHERE tenant_id = ${tenantId} AND month_key = ${month.key} AND session_id = ${sessionId}
        UNION ALL
        SELECT 1 FROM chat_logs cl
        JOIN bots b ON b.id = cl.bot_id
        WHERE b.tenant_id = ${tenantId}
          AND cl.created_at >= ${month.startEpoch}
          AND cl.session_id = ${sessionId}
        LIMIT 1
      ) AS exists
    `;

    const countRows = await tx`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT session_id FROM monthly_chat_sessions
        WHERE tenant_id = ${tenantId} AND month_key = ${month.key}
        UNION
        SELECT cl.session_id FROM chat_logs cl
        JOIN bots b ON b.id = cl.bot_id
        WHERE b.tenant_id = ${tenantId}
          AND cl.created_at >= ${month.startEpoch}
          AND cl.session_id <> 'legacy'
      ) sessions
    `;
    const used = Number(countRows[0]?.count ?? 0);
    if (Boolean(existing[0]?.exists)) return { allowed: true as const, isNew: false, usage: monthlyUsageSummary(used, limit, month.key) };
    if (used >= limit) return { allowed: false as const, isNew: false, usage: monthlyUsageSummary(used, limit, month.key) };

    await tx`
      INSERT INTO monthly_chat_sessions (tenant_id, month_key, session_id, bot_id)
      VALUES (${tenantId}, ${month.key}, ${sessionId}, ${botId})
      ON CONFLICT DO NOTHING
    `;
    return { allowed: true as const, isNew: true, usage: monthlyUsageSummary(used + 1, limit, month.key) };
  });
}
