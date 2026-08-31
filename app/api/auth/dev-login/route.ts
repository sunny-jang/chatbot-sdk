import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { COOKIE_OPTS } from "@/lib/admin";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "개발 환경에서만 사용할 수 있습니다." }, { status: 404 });
  }

  await initSchema();

  const rows = await sql`
    SELECT id, name, is_admin
    FROM tenants
    ORDER BY created_at ASC
    LIMIT 1
  `;

  let tenant: { id: string; name: string; is_admin: boolean };

  if (rows.length === 0) {
    const id = randomUUID();
    const apiKey = `iai-dev-${randomUUID().replace(/-/g, "")}`;
    await sql`
      INSERT INTO tenants (id, name, api_key, email, is_admin)
      VALUES (${id}, ${"테스트 워크스페이스"}, ${apiKey}, ${"dev@ideal-ai.local"}, ${false})
    `;
    tenant = { id, name: "테스트 워크스페이스", is_admin: false };
  } else {
    tenant = rows[0] as { id: string; name: string; is_admin: boolean };
  }

  const jar = await cookies();
  jar.set("tenant_id", tenant.id, COOKIE_OPTS(60 * 60 * 8));
  if (tenant.is_admin) {
    jar.set("is_admin", "1", COOKIE_OPTS(60 * 60 * 8));
  }

  return NextResponse.json({ ok: true, name: tenant.name });
}
