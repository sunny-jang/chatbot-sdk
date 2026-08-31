import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema, Tenant } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { randomUUID } from "crypto";

export async function GET() {
  await initSchema();
  const rows = await sql`
    SELECT t.id, t.name, t.api_key, t.created_at, t.plan,
           t.subscription_status, t.enterprise_bot_limit,
           COUNT(b.id)::int AS bot_count
    FROM tenants t
    LEFT JOIN bots b ON b.tenant_id = t.id
    GROUP BY t.id, t.name, t.api_key, t.created_at, t.plan,
             t.subscription_status, t.enterprise_bot_limit
    ORDER BY t.created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const { name, openai_api_key } = await req.json();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  await initSchema();
  const id = randomUUID();
  const apiKey = `iai-${randomUUID().replace(/-/g, "")}`;
  const encryptedKey = openai_api_key ? encrypt(openai_api_key) : null;

  await sql`INSERT INTO tenants (id, name, api_key, openai_api_key) VALUES (${id}, ${name}, ${apiKey}, ${encryptedKey})`;
  return NextResponse.json({ id, name, api_key: apiKey } as Tenant & { api_key: string }, { status: 201 });
}
