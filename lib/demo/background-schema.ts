import type { AccessDatabase } from "../access/schema";
/** Homepage screenshots shown behind a demo when the real site cannot be framed (e.g. http:// only). */
export async function createDemoBackgroundSchema(db: AccessDatabase) {
  await db`CREATE TABLE IF NOT EXISTS demo_backgrounds(
 demo_id TEXT PRIMARY KEY REFERENCES customer_demos(id) ON DELETE CASCADE,
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp','image/gif')),
 bytes BYTEA NOT NULL,
 version TEXT NOT NULL,
 updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
 )`;
}
