import { NextResponse } from "next/server";
import { SolapiMessageService } from "solapi";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";

const solapi = new SolapiMessageService(
  process.env.SOLAPI_API_KEY!,
  process.env.SOLAPI_API_SECRET!
);

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/phone-verify — OTP 발송
export async function POST(req: Request) {
  const { phone } = await req.json();
  if (!phone || !/^01[0-9]{8,9}$/.test(phone.replace(/-/g, ""))) {
    return NextResponse.json({ error: "올바른 휴대폰 번호를 입력해주세요." }, { status: 400 });
  }

  const normalized = phone.replace(/-/g, "");
  const code = generateOtp();
  const expiresAt = Math.floor(Date.now() / 1000) + 180; // 3분

  await initSchema();
  await sql`
    INSERT INTO phone_otps (phone, code, expires_at)
    VALUES (${normalized}, ${code}, ${expiresAt})
    ON CONFLICT (phone) DO UPDATE SET code = ${code}, expires_at = ${expiresAt}
  `;

  await solapi.send({
    to: normalized,
    from: process.env.SOLAPI_SMS_FROM!,
    text: `[Ideal AI] 인증번호: ${code} (3분 내 입력)`,
  });

  return NextResponse.json({ ok: true });
}

// PUT /api/auth/phone-verify — OTP 검증
export async function PUT(req: Request) {
  const { phone, code } = await req.json();
  if (!phone || !code) {
    return NextResponse.json({ error: "정보가 누락됐습니다." }, { status: 400 });
  }

  const normalized = phone.replace(/-/g, "");
  const now = Math.floor(Date.now() / 1000);

  await initSchema();
  const rows = await sql`
    SELECT code, expires_at FROM phone_otps WHERE phone = ${normalized}
  `;

  const otp = rows[0] as { code: string; expires_at: number } | undefined;
  if (!otp) {
    return NextResponse.json({ error: "인증번호를 먼저 발송해주세요." }, { status: 400 });
  }
  if (otp.expires_at < now) {
    return NextResponse.json({ error: "인증번호가 만료됐습니다. 다시 발송해주세요." }, { status: 400 });
  }
  if (otp.code !== code) {
    return NextResponse.json({ error: "인증번호가 올바르지 않습니다." }, { status: 400 });
  }

  // 인증 성공 — OTP 삭제
  await sql`DELETE FROM phone_otps WHERE phone = ${normalized}`;
  return NextResponse.json({ ok: true });
}
