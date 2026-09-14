import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { getSupportStatus } from "@/lib/supportHours";
import { readTenantId } from "@/lib/auth";

// 강제 무인 운영 스위치 전용 API.
// 챗봇 저장(PUT /api/bots/[id])은 보내지 않은 항목을 비우므로, 이 값만 즉시 바꾸도록 분리했습니다.

async function ownedBot(id: string) {
  const tenantId = (await readTenantId());
  if (!tenantId) return null;
  const rows = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  return rows[0] ? tenantId : null;
}

async function statusResponse(id: string) {
  const rows = await sql`SELECT support_mode, force_unattended, support_hours FROM bots WHERE id = ${id}`;
  const bot = rows[0] as { support_mode: string; force_unattended: boolean; support_hours: unknown };
  return NextResponse.json({ forceUnattended: Boolean(bot.force_unattended), status: getSupportStatus(bot) });
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await initSchema();
  if (!(await ownedBot(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return statusResponse(id);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await initSchema();
  if (!(await ownedBot(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { force_unattended } = await req.json();
  if (typeof force_unattended !== "boolean") {
    return NextResponse.json({ error: "force_unattended는 true 또는 false여야 합니다." }, { status: 400 });
  }
  await sql`UPDATE bots SET force_unattended = ${force_unattended} WHERE id = ${id}`;
  return statusResponse(id);
}
