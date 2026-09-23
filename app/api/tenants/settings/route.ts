import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import sql from "@/lib/neon";
import { encrypt, decrypt } from "@/lib/crypto";
import { initSchema } from "@/lib/db";

export async function GET() {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await initSchema();

  const rows = await sql`SELECT openai_api_key, gemini_api_key FROM tenants WHERE id = ${tenantId}`;
  const row = rows[0] as { openai_api_key?: string | null; gemini_api_key?: string | null } | undefined;
  const mask = (encrypted: string | null | undefined) => {
    if (!encrypted) return null;
    try { return decrypt(encrypted).slice(0, 8) + "••••••••••••••••••••"; }
    catch { return "••••••••••••••••••••"; }
  };
  return NextResponse.json({
    openai: { hasKey: !!row?.openai_api_key, maskedKey: mask(row?.openai_api_key) },
    gemini: { hasKey: !!row?.gemini_api_key, maskedKey: mask(row?.gemini_api_key) },
  });
}

export async function PATCH(req: Request) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await initSchema();

  const body = await req.json();
  const provider = body.provider === "gemini" ? "gemini" : "openai";
  const key = body[`${provider}_api_key`];
  const column = provider === "gemini" ? "gemini_api_key" : "openai_api_key";

  if (key === "" || key === null) {
    if (provider === "gemini") await sql`UPDATE tenants SET gemini_api_key = NULL WHERE id = ${tenantId}`;
    else await sql`UPDATE tenants SET openai_api_key = NULL WHERE id = ${tenantId}`;
    return NextResponse.json({ ok: true, hasKey: false });
  }

  if (typeof key !== "string" || (provider === "openai" && !key.startsWith("sk-")) || (provider === "gemini" && key.length < 20)) {
    return NextResponse.json({ error: provider === "gemini" ? "올바른 Google Gemini API 키를 입력해주세요." : "올바른 OpenAI API 키를 입력해주세요 (sk-로 시작)" }, { status: 400 });
  }

  const encrypted = encrypt(key);
  if (column === "gemini_api_key") await sql`UPDATE tenants SET gemini_api_key = ${encrypted} WHERE id = ${tenantId}`;
  else await sql`UPDATE tenants SET openai_api_key = ${encrypted} WHERE id = ${tenantId}`;
  return NextResponse.json({ ok: true, hasKey: true });
}
