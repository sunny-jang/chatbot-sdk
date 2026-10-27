import { NextResponse } from "next/server";
import { initSchema } from "@/lib/db";
import { runScheduledSync } from "@/lib/db-sources/sync";

export const maxDuration = 60;

/** 예정된 DB 소스 동기화. 소스별 주기(매시간·매일·매주)는 서버가 판단하므로 스케줄러는 자주 부를수록 정확하다. */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await initSchema();
  const { picked, results } = await runScheduledSync({ budgetMs: 45_000 });
  // 결과에는 소스 id·상태·건수만 담는다(접속 정보·본문 없음).
  return NextResponse.json({
    ok: true,
    picked,
    results: results.map((r) => ({ sourceId: r.sourceId, status: r.status, ...(r.state ? { processed: r.state.processed, total: r.state.total, created: r.state.created, updated: r.state.updated, archived: r.state.archived } : {}), ...(r.error ? { error: r.error } : {}) })),
  });
}
