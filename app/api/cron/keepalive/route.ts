import { NextResponse } from "next/server";
import sql from "@/lib/neon";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await sql`SELECT 1`;
  return NextResponse.json({ ok: true, ts: Date.now() });
}
