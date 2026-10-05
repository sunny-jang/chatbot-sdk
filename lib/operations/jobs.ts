import { randomUUID } from "node:crypto";
import sql from "../neon";
import {
  getSlackIntegration,
  getTelegramIntegration,
  slackCall,
  telegramCall,
  sendSlackMessage,
  sendTelegramMessage,
} from "../support";
import { summarizeSession } from "./summary";

export async function enqueueSummary(botId: string, handoffId: string) {
  await sql`INSERT INTO operation_jobs(id,bot_id,kind,target_id) VALUES(${randomUUID()},${botId},'handoff_summary',${handoffId}) ON CONFLICT(kind,target_id,channel) DO NOTHING`;
}
async function runJob(job: Record<string, unknown>) {
  const botId = String(job.bot_id),
    target = String(job.target_id);
  if (job.kind === "handoff_summary") {
    const rows =
      await sql`SELECT h.*,b.summary_enabled FROM support_handoffs h JOIN bots b ON b.id=h.bot_id WHERE h.id=${target}`;
    const h = rows[0];
    if (!h) return;
    if (!h.summary_enabled) {
      await sql`UPDATE support_handoffs SET summary_status='disabled' WHERE id=${target}`;
      return;
    }
    if (job.channel === "local") {
      const result = h.summary
        ? { text: String(h.summary), status: String(h.summary_status) }
        : await summarizeSession(botId, String(h.session_id));
      await sql.begin(async (tx) => {
        await tx`UPDATE support_handoffs SET summary=${result.text},summary_status=${result.status} WHERE id=${target}`;
        if (h.telegram_topic_id)
          await tx`INSERT INTO operation_jobs(id,bot_id,kind,target_id,channel) VALUES(${randomUUID()},${botId},'handoff_summary',${target},'telegram') ON CONFLICT(kind,target_id,channel) DO NOTHING`;
        if (h.slack_thread_ts)
          await tx`INSERT INTO operation_jobs(id,bot_id,kind,target_id,channel) VALUES(${randomUUID()},${botId},'handoff_summary',${target},'slack') ON CONFLICT(kind,target_id,channel) DO NOTHING`;
      });
    } else if (job.channel === "telegram") {
      if (
        !(await sendTelegramMessage(
          botId,
          `상담 인계 요약 (${h.summary_status === "generated" ? "AI 요약" : "최근 대화 발췌"})\n${h.summary}`,
          Number(h.telegram_topic_id),
        ))
      )
        throw Error("channel_unavailable");
    } else if (job.channel === "slack") {
      if (
        !(await sendSlackMessage(
          botId,
          `상담 인계 요약 (${h.summary_status === "generated" ? "AI 요약" : "최근 대화 발췌"})\n${h.summary}`,
          String(h.slack_thread_ts),
          String(job.id),
        ))
      )
        throw Error("channel_unavailable");
    }
  } else {
    const rows =
      await sql`SELECT r.*,b.summary_enabled FROM customer_requests r JOIN bots b ON b.id=r.bot_id WHERE r.id=${target}`;
    const r = rows[0];
    if (!r) return;
    if (job.channel === "local") {
      const summary = r.summary
        ? String(r.summary)
        : r.summary_enabled
          ? (
              await summarizeSession(
                botId,
                r.session_id ? String(r.session_id) : null,
              )
            ).text
          : "";
      const [telegram, slack] = await Promise.all([
        getTelegramIntegration(botId),
        getSlackIntegration(botId),
      ]);
      await sql.begin(async (tx) => {
        await tx`UPDATE customer_requests SET summary=${summary} WHERE id=${target}`;
        for (const channel of [
          telegram ? "telegram" : null,
          slack ? "slack" : null,
        ].filter(Boolean))
          await tx`INSERT INTO operation_jobs(id,bot_id,kind,target_id,channel) VALUES(${randomUUID()},${botId},'request_notification',${target},${channel!}) ON CONFLICT(kind,target_id,channel) DO NOTHING`;
      });
    } else {
      const text = `새 ${r.kind === "quote" ? "견적 요청" : "상담 신청"}\n접수번호: ${r.receipt}\n문의: ${String(r.message).slice(0, 1000)}\n${r.summary ? `\n대화 요약\n${r.summary}` : ""}\n\n관리자: ${process.env.AUTH_URL || process.env.NEXTAUTH_URL || ""}/bots/${botId}/requests?requestId=${target}`;
      if (job.channel === "telegram") {
        const integration = await getTelegramIntegration(botId);
        if (!integration) throw Error("channel_unavailable");
        await telegramCall(integration.token, "sendMessage", {
          chat_id: integration.chat_id,
          text: text.slice(0, 4000),
        });
      } else {
        const integration = await getSlackIntegration(botId);
        if (!integration) throw Error("channel_unavailable");
        await slackCall(integration.token, "chat.postMessage", {
          channel: integration.channel_id,
          text,
          client_msg_id: String(job.id),
        });
      }
    }
  }
}
export async function processJobs(limit = 12) {
  const started = Date.now();
  await sql`UPDATE operation_jobs SET status='failed',locked_at=NULL,last_error='작업 시간 초과' WHERE status='processing' AND locked_at<EXTRACT(EPOCH FROM NOW())-120`;
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    if (Date.now() - started > 35000) break;
    const rows =
      await sql`UPDATE operation_jobs SET status='processing',locked_at=EXTRACT(EPOCH FROM NOW())::BIGINT,attempts=attempts+1 WHERE id=(
      SELECT id FROM operation_jobs WHERE (status IN ('pending','failed') OR (status='processing' AND locked_at<EXTRACT(EPOCH FROM NOW())-120)) AND attempts<5 AND available_at<=EXTRACT(EPOCH FROM NOW()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
    const job = rows[0];
    if (!job) break;
    try {
      await runJob(job);
      await sql`UPDATE operation_jobs SET status='sent',locked_at=NULL,last_error=NULL WHERE id=${job.id}`;
    } catch {
      await sql`UPDATE operation_jobs SET status='failed',locked_at=NULL,last_error='처리 또는 외부 전송 실패',available_at=EXTRACT(EPOCH FROM NOW())::BIGINT+${Math.min(3600, 30 * 2 ** Number(job.attempts))} WHERE id=${job.id}`;
    }
    processed++;
  }
  return processed;
}
export async function cleanupOperations() {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM operation_jobs WHERE kind='request_notification' AND target_id IN (SELECT id FROM customer_requests WHERE created_at+retention_days*86400<EXTRACT(EPOCH FROM NOW()))`;
    await tx`DELETE FROM customer_requests WHERE created_at+retention_days*86400<EXTRACT(EPOCH FROM NOW())`;
    await tx`DELETE FROM web_previews WHERE created_at<EXTRACT(EPOCH FROM NOW())-86400`;
    await tx`DELETE FROM operation_jobs WHERE status='sent' AND available_at<EXTRACT(EPOCH FROM NOW())-2592000`;
  });
}
