import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hash } from "bcryptjs";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { randomUUID } from "crypto";
import { isAdminEmail, COOKIE_OPTS } from "@/lib/admin";

export async function POST(req: Request) {
  const { name, email, password, phone } = await req.json();
  if (!name || !email || !password || !phone) {
    return NextResponse.json({ error: "모든 항목을 입력해주세요." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
  }

  await initSchema();

  const existing = await sql`SELECT id FROM tenants WHERE email = ${email}`;
  if (existing.length > 0) {
    return NextResponse.json({ error: "이미 사용 중인 이메일입니다." }, { status: 409 });
  }

  const id = randomUUID();
  const apiKey = `iai-${randomUUID().replace(/-/g, "")}`;
  const passwordHash = await hash(password, 12);
  const normalizedPhone = phone.replace(/-/g, "");
  const admin = isAdminEmail(email);

  await sql`
    INSERT INTO tenants (id, name, api_key, email, password_hash, phone, is_admin)
    VALUES (${id}, ${name}, ${apiKey}, ${email}, ${passwordHash}, ${normalizedPhone}, ${admin})
  `;

  const jar = await cookies();
  jar.set("tenant_id", id, COOKIE_OPTS());
  if (admin) {
    jar.set("is_admin", "1", COOKIE_OPTS());
  }

  return NextResponse.json({ ok: true, name }, { status: 201 });
}
