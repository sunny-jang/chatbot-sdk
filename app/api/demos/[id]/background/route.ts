import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { agencyOwner } from "@/lib/customer-portal/auth";
import { failure, PortalError, sameOrigin } from "@/lib/customer-portal/input";
import { requireDemoSchema } from "@/lib/demo/store";
import {
  DEMO_BACKGROUND_MAX_BYTES,
  demoBackgroundImage,
  ensureDemoBackgroundSchema,
  setDemoBackground,
} from "@/lib/demo/backgrounds";
import { enforceRateLimit } from "@/lib/support";
type C = { params: Promise<{ id: string }> };
async function prepare(req: Request) {
  sameOrigin(req);
  const owner = await agencyOwner();
  await requireDemoSchema(sql);
  await ensureDemoBackgroundSchema(sql);
  if (!(await enforceRateLimit("manage-demo:" + owner.user.id, req, 30)))
    throw new PortalError("잠시 후 다시 시도해주세요.", 429);
  return owner;
}
/** 홈페이지 캡처 이미지를 데모 배경으로 저장합니다. */
export async function POST(req: Request, { params }: C) {
  try {
    const { user, tenantId } = await prepare(req);
    // 본문을 읽기 전에 크기를 확인합니다. 길이를 밝히지 않은(chunked) 요청은 받지 않습니다.
    const length = Number(req.headers.get("content-length"));
    if (!Number.isFinite(length) || length <= 0)
      throw new PortalError("파일 크기를 확인할 수 없습니다.", 411);
    if (length > DEMO_BACKGROUND_MAX_BYTES + 64 * 1024)
      throw new PortalError("배경 이미지는 3MB 이하만 올릴 수 있습니다.", 413);
    const file = (await req.formData()).get("file");
    if (!(file instanceof File))
      throw new PortalError("이미지 파일을 선택해주세요.");
    const bytes = new Uint8Array(await file.arrayBuffer()),
      mime = demoBackgroundImage(bytes, file.type),
      { id } = await params;
    await sql.begin((tx) =>
      setDemoBackground(tx as unknown as AccessDatabase, user.id, tenantId, id, {
        mime,
        bytes,
      }),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request, { params }: C) {
  try {
    const { user, tenantId } = await prepare(req),
      { id } = await params;
    await sql.begin((tx) =>
      setDemoBackground(tx as unknown as AccessDatabase, user.id, tenantId, id, null),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
