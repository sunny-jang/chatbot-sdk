import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { ChatLog } from "@/lib/db";

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const check = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!check[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const rows = await sql`
    SELECT id, bot_id, session_id, user_message, bot_reply, created_at,
           intent, refused, refusal_reason, model, input_tokens, output_tokens,
           latency_ms, api_success, estimated_cost_usd, tool_name, tool_success
    FROM chat_logs WHERE bot_id = ${id}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return NextResponse.json(rows as unknown as ChatLog[]);
}
