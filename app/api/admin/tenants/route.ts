import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema, Tenant } from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET() {
  await initSchema();
  const rows = await sql`
    SELECT t.id, t.name, t.api_key, t.created_at,
           COUNT(b.id)::int AS bot_count
    FROM tenants t
    LEFT JOIN bots b ON b.tenant_id = t.id
    GROUP BY t.id, t.name, t.api_key, t.created_at
    ORDER BY t.created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const { name } = await req.json();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  await initSchema();
  const id = randomUUID();
  const apiKey = `iai-${randomUUID().replace(/-/g, "")}`;

  await sql`INSERT INTO tenants (id, name, api_key) VALUES (${id}, ${name}, ${apiKey})`;
  return NextResponse.json({ id, name, api_key: apiKey } as Tenant & { api_key: string }, { status: 201 });
}
