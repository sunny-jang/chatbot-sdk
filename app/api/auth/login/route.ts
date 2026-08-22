import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { compare } from "bcryptjs";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
  }

  await initSchema();

  const rows = await sql`SELECT id, name, password_hash FROM tenants WHERE email = ${email}`;
  const tenant = rows[0] as { id: string; name: string; password_hash: string | null } | undefined;

  if (!tenant || !tenant.password_hash) {
    return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const valid = await compare(password, tenant.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

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
