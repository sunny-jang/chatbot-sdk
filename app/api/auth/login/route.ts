import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";

export async function POST(req: Request) {
  const { api_key } = await req.json();
  if (!api_key) {
    return NextResponse.json({ error: "api_key required" }, { status: 400 });
  }

  await initSchema();
  const rows = await sql`SELECT id, name FROM tenants WHERE api_key = ${api_key}`;
  if (!rows[0]) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const tenant = rows[0] as { id: string; name: string };
  const jar = await cookies();
  jar.set("tenant_id", tenant.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  return NextResponse.json({ ok: true, name: tenant.name });
}
