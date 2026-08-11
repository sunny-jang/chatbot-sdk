import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  const masterKey = process.env.MASTER_KEY;
  const auth = req.headers.get("authorization");

  if (!masterKey || auth !== `Bearer ${masterKey}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name } = await req.json();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  await initSchema();
  const id = randomUUID();
  const apiKey = `iai-${randomUUID().replace(/-/g, "")}`;

  await sql`
    INSERT INTO tenants (id, name, api_key)
    VALUES (${id}, ${name}, ${apiKey})
  `;

  return NextResponse.json({ id, name, api_key: apiKey }, { status: 201 });
}
