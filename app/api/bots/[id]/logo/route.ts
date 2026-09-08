import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await initSchema();
  const tenantId = (await cookies()).get("tenant_id")?.value;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const owned = await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!owned[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return NextResponse.json({ error: "이미지 파일을 선택해주세요." }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "로고는 2MB 이하만 가능합니다." }, { status: 400 });
  const logoUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  await sql`UPDATE bots SET logo_url = ${logoUrl} WHERE id = ${id}`;
  return NextResponse.json({ logo_url: logoUrl });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = (await cookies()).get("tenant_id")?.value;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await sql`UPDATE bots SET logo_url = NULL WHERE id = ${id} AND tenant_id = ${tenantId}`;
  return NextResponse.json({ ok: true });
}
