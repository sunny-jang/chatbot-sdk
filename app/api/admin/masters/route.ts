import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { isAdminRequest, platformActorId } from "@/lib/auth";
import { body, failure, sameOrigin, text, PortalError } from "@/lib/customer-portal/input";
import {
  addPlatformAdmin,
  listPlatformAdmins,
  platformReady,
  removePlatformAdmin,
} from "@/lib/access/platform";

async function actor() {
  if (!(await isAdminRequest())) throw new PortalError("마스터 권한이 필요합니다.", 403);
  const id = await platformActorId();
  if (!id || !(await platformReady(sql)))
    throw new PortalError("마스터 관리를 쓰려면 계정 이관(공통 신원)이 먼저 필요합니다.", 503);
  return id;
}

export async function GET() {
  try {
    await actor();
    return NextResponse.json(await listPlatformAdmins(sql));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const id = await actor(),
      input = await body(req);
    const result = await sql.begin((tx) =>
      addPlatformAdmin(tx as unknown as AccessDatabase, id, input),
    );
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: Request) {
  try {
    sameOrigin(req);
    const id = await actor(),
      input = await body(req);
    await sql.begin((tx) =>
      removePlatformAdmin(tx as unknown as AccessDatabase, id, text(input.userId, "마스터", 200)),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
