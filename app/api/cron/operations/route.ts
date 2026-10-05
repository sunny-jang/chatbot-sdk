import { initSchema } from "@/lib/db";
import { cleanupOperations, processJobs } from "@/lib/operations/jobs";
export const maxDuration = 60;
export async function GET(req: Request) {
  if (
    !process.env.CRON_SECRET ||
    req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  await initSchema();
  await cleanupOperations();
  return Response.json({ ok: true, processed: await processJobs(20) });
}
