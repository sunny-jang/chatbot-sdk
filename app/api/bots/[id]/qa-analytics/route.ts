import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";

const round = (value: number) => Number(value.toFixed(1));
type QaAnalyticsRow = { id:string; session_id:string; user_message:string; created_at:number|string; qa_pair_id:string|null; qa_matched:boolean|null; qa_match_score:number|null; model:string|null; matched_question:string|null; folder_name:string };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = (await cookies()).get("tenant_id")?.value;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await initSchema();
  const botRows = await sql`SELECT id, name, type FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  const bot = botRows[0];
  if (!bot) return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  if (bot.type !== "qa") return NextResponse.json({ error: "Q&A bot only" }, { status: 400 });
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 365);
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = await sql`
    SELECT l.id, l.session_id, l.user_message, l.created_at, l.qa_pair_id,
           l.qa_matched, l.qa_match_score, l.model,
           q.question AS matched_question, COALESCE(f.name, '미분류') AS folder_name
    FROM chat_logs l
    LEFT JOIN qa_pairs q ON q.id = l.qa_pair_id AND q.bot_id = l.bot_id
    LEFT JOIN qa_folders f ON f.id = q.folder_id
    WHERE l.bot_id = ${id} AND l.created_at >= ${since}
    ORDER BY l.created_at DESC LIMIT 10000
  `;
  const logs = (rows as unknown as QaAnalyticsRow[]).map((row) => ({ ...row, created_at: Number(row.created_at) }));
  const measured = logs.filter((row) => row.qa_matched !== null);
  const matched = measured.filter((row) => row.qa_matched === true);
  const unmatched = measured.filter((row) => row.qa_matched === false);
  const sessions = new Set(logs.map((row) => row.session_id === "legacy" ? `legacy:${row.id}` : row.session_id));
  const choiceCount = measured.filter((row) => row.model === "qa-choice").length;
  const dailyMap = new Map<string, { questions: number; sessions: Set<string>; matched: number }>();
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
    dailyMap.set(date, { questions: 0, sessions: new Set(), matched: 0 });
  }
  const questionMap = new Map<string, { question: string; folder: string; count: number }>();
  const folderMap = new Map<string, number>();
  for (const row of logs) {
    const day = new Date(row.created_at * 1000).toISOString().slice(0, 10);
    const daily = dailyMap.get(day);
    if (daily) {
      daily.questions += 1;
      daily.sessions.add(row.session_id === "legacy" ? `legacy:${row.id}` : String(row.session_id));
      if (row.qa_matched === true) daily.matched += 1;
    }
    if (row.qa_pair_id && row.matched_question) {
      const current = questionMap.get(String(row.qa_pair_id)) ?? { question: String(row.matched_question), folder: String(row.folder_name), count: 0 };
      current.count += 1;
      questionMap.set(String(row.qa_pair_id), current);
      folderMap.set(current.folder, (folderMap.get(current.folder) ?? 0) + 1);
    }
  }
  return NextResponse.json({
    bot: { id: String(bot.id), name: String(bot.name) }, periodDays: days,
    summary: { questions: logs.length, sessions: sessions.size, measured: measured.length, matched: matched.length, unmatched: unmatched.length, matchRate: measured.length ? round((matched.length / measured.length) * 100) : null, choiceRate: measured.length ? round((choiceCount / measured.length) * 100) : null },
    daily: [...dailyMap.entries()].map(([date, value]) => ({ date, questions: value.questions, sessions: value.sessions.size, matched: value.matched })),
    topQuestions: [...questionMap.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    folders: [...folderMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    unmatched: unmatched.slice(0, 20).map((row) => ({ id: String(row.id), question: String(row.user_message), createdAt: row.created_at, sessionId: String(row.session_id) })),
  });
}
