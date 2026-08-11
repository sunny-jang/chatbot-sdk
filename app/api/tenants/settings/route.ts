import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import sql from "@/lib/neon";
import { encrypt, decrypt } from "@/lib/crypto";

export async function GET() {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await sql`SELECT openai_api_key FROM tenants WHERE id = ${tenantId}`;
  const encrypted = rows[0]?.openai_api_key as string | null;
  let maskedKey: string | null = null;
  if (encrypted) {
    try {
      const plain = decrypt(encrypted);
      maskedKey = plain.slice(0, 8) + "••••••••••••••••••••";
    } catch {
      maskedKey = "••••••••••••••••••••";
    }
  }
  return NextResponse.json({ hasKey: !!encrypted, maskedKey });
}

export async function PATCH(req: Request) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { openai_api_key } = await req.json();

  if (openai_api_key === "" || openai_api_key === null) {
    await sql`UPDATE tenants SET openai_api_key = NULL WHERE id = ${tenantId}`;
    return NextResponse.json({ ok: true, hasKey: false });
  }

  if (typeof openai_api_key !== "string" || !openai_api_key.startsWith("sk-")) {
    return NextResponse.json({ error: "올바른 OpenAI API 키를 입력해주세요 (sk-로 시작)" }, { status: 400 });
  }

  const encrypted = encrypt(openai_api_key);
  await sql`UPDATE tenants SET openai_api_key = ${encrypted} WHERE id = ${tenantId}`;
  return NextResponse.json({ ok: true, hasKey: true });
}
