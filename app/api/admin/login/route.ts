import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const { master_key } = await req.json();
  if (!master_key || master_key !== process.env.MASTER_KEY) {
    return NextResponse.json({ error: "Invalid master key" }, { status: 401 });
  }

  const jar = await cookies();
  jar.set("master_session", "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
