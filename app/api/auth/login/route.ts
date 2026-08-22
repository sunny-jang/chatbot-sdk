import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { compare } from "bcryptjs";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { syncAdminRole, COOKIE_OPTS } from "@/lib/admin";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
  }

  await initSchema();

  const rows = await sql`SELECT id, name, email, password_hash FROM tenants WHERE email = ${email}`;
  const tenant = rows[0] as { id: string; name: string; email: string; password_hash: string | null } | undefined;

  if (!tenant || !tenant.password_hash) {
    return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const valid = await compare(password, tenant.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const isAdmin = await syncAdminRole(tenant.id, tenant.email);

  const jar = await cookies();
  jar.set("tenant_id", tenant.id, COOKIE_OPTS());
  if (isAdmin) {
    jar.set("is_admin", "1", COOKIE_OPTS());
  }

  return NextResponse.json({ ok: true, name: tenant.name });
}
