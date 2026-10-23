import type { AccessDatabase } from "../access/schema";
export async function createDemoSchema(db: AccessDatabase) {
  await db`CREATE TABLE IF NOT EXISTS customer_demos(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),customer_id TEXT NOT NULL REFERENCES customers(id),bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 created_by TEXT NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 site_url TEXT NOT NULL,expires_at BIGINT NOT NULL,revoked_at BIGINT,
 request_count INTEGER NOT NULL DEFAULT 0,max_requests INTEGER NOT NULL DEFAULT 100 CHECK(max_requests BETWEEN 1 AND 200),
 created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
 )`;
  await db`CREATE INDEX IF NOT EXISTS customer_demos_tenant_idx ON customer_demos(tenant_id,expires_at)`;
  await db`CREATE TABLE IF NOT EXISTS demo_turns(
 id TEXT PRIMARY KEY,sequence BIGSERIAL UNIQUE,demo_id TEXT NOT NULL REFERENCES customer_demos(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,
 question TEXT NOT NULL,reply TEXT,state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','failed')),
 created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
 UNIQUE(demo_id,session_id,request_id)
 )`;
  await db`ALTER TABLE demo_turns ADD COLUMN IF NOT EXISTS model_started_at BIGINT`;
  await db`CREATE TABLE IF NOT EXISTS demo_requests(
 id TEXT PRIMARY KEY,demo_id TEXT NOT NULL REFERENCES customer_demos(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL,payload_hash TEXT NOT NULL,kind TEXT NOT NULL,receipt TEXT NOT NULL,
 created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,UNIQUE(demo_id,request_key)
 )`;
  await db`CREATE INDEX IF NOT EXISTS demo_turns_session_idx ON demo_turns(demo_id,session_id,sequence)`;
}
