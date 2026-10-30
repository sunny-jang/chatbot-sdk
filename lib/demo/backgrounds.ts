import { randomUUID } from "node:crypto";
import type { AccessDatabase } from "../access/schema";
import { PortalError } from "../customer-portal/input";
import { customerBot } from "../customer-portal/bots";
import { logoMime } from "../widget-presentation";
import { createDemoBackgroundSchema } from "./background-schema";
import { DEMO_BACKGROUND_MAX_BYTES } from "./background-rules";
export { DEMO_BACKGROUND_MAX_BYTES };

let schemaReady: Promise<void> | null = null;
/**
 * Also part of createDemoSchema; created on first use so existing deployments
 * get the table without re-running the access migration.
 */
export function ensureDemoBackgroundSchema(db: AccessDatabase) {
  schemaReady ??= createDemoBackgroundSchema(db).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

/** Whether the background table is usable; the demo list hides background info when it is not. */
export async function demoBackgroundsAvailable(db: AccessDatabase) {
  try {
    await ensureDemoBackgroundSchema(db);
    const [row] =
      await db`SELECT to_regclass('demo_backgrounds') IS NOT NULL AS ready`;
    return Boolean(row?.ready);
  } catch (error) {
    console.error("[demo] background table unavailable", error);
    return false;
  }
}

/** Same signature check as widget logos: the declared type must match the file bytes. */
export function demoBackgroundImage(bytes: Uint8Array, declaredType: string) {
  if (!bytes.length) throw new PortalError("이미지 파일을 선택해주세요.");
  if (bytes.length > DEMO_BACKGROUND_MAX_BYTES)
    throw new PortalError("배경 이미지는 3MB 이하만 올릴 수 있습니다.");
  const mime = logoMime(bytes);
  if (!mime || mime !== declaredType)
    throw new PortalError(
      "PNG·JPG·WebP·GIF 이미지 파일만 사용할 수 있습니다.",
    );
  return mime;
}

/** Owner-only, like creating or revoking the demo. `image` null removes the background. */
export async function setDemoBackground(
  db: AccessDatabase,
  userId: string,
  tenantId: string,
  demoId: string,
  image: { mime: string; bytes: Uint8Array } | null,
) {
  const [demo] =
    await db`SELECT customer_id,bot_id,revoked_at FROM customer_demos WHERE id=${demoId} AND tenant_id=${tenantId}`;
  if (!demo) throw new PortalError("데모를 찾을 수 없습니다.", 404);
  const { grant } = await customerBot(
    db,
    userId,
    String(demo.customer_id),
    String(demo.bot_id),
    "bot.read",
    true,
  );
  if (grant.role !== "owner")
    throw new PortalError("배경을 바꿀 권한이 없습니다.", 403);
  if (demo.revoked_at)
    throw new PortalError("해제된 데모는 바꿀 수 없습니다.", 409);
  if (image)
    // version은 이미지 주소의 ?v= 값. 같은 초에 바꿔도 캐시가 새 이미지를 받도록 매번 새로 만듭니다.
    await db`INSERT INTO demo_backgrounds(demo_id,mime,bytes,version) VALUES(${demoId},${image.mime},${Buffer.from(image.bytes)},${randomUUID()})
 ON CONFLICT(demo_id) DO UPDATE SET mime=EXCLUDED.mime,bytes=EXCLUDED.bytes,version=EXCLUDED.version,updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT`;
  else await db`DELETE FROM demo_backgrounds WHERE demo_id=${demoId}`;
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${userId},${tenantId},${String(demo.customer_id)},${image ? "demo.background.set" : "demo.background.remove"},${demoId},'success')`;
}

/**
 * Optional decoration on the public demo page: any failure (table not created
 * yet, no CREATE privilege, a cold-start DDL race) means "no background" rather
 * than breaking the shared link.
 */
export async function demoBackgroundVersion(db: AccessDatabase, demoId: string) {
  try {
    await ensureDemoBackgroundSchema(db);
    const [row] =
      await db`SELECT version FROM demo_backgrounds WHERE demo_id=${demoId}`;
    return row ? String(row.version) : null;
  } catch (error) {
    console.error("[demo] background lookup failed", error);
    return null;
  }
}

export async function readDemoBackground(db: AccessDatabase, demoId: string) {
  await ensureDemoBackgroundSchema(db);
  const [row] =
    await db`SELECT mime,bytes FROM demo_backgrounds WHERE demo_id=${demoId}`;
  return row
    ? { mime: String(row.mime), bytes: row.bytes as Uint8Array }
    : null;
}
