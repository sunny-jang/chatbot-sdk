import sql from "../neon";

export async function initOperationsSchema() {
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS summary_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS request_settings JSONB`;
  await sql`ALTER TABLE support_handoffs ADD COLUMN IF NOT EXISTS summary TEXT`;
  await sql`ALTER TABLE support_handoffs ADD COLUMN IF NOT EXISTS summary_status TEXT NOT NULL DEFAULT 'disabled'`;
  await sql`CREATE TABLE IF NOT EXISTS unanswered_reviews (
    log_id TEXT PRIMARY KEY REFERENCES chat_logs(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending','resolved','excluded')),
    qa_id TEXT REFERENCES qa_pairs(id) ON DELETE SET NULL,
    updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS web_sources (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    url TEXT NOT NULL, final_url TEXT NOT NULL, source_hash TEXT NOT NULL,
    checked_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    applied_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    last_error TEXT, UNIQUE(bot_id,url)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS web_previews (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    source_id TEXT REFERENCES web_sources(id) ON DELETE CASCADE,
    url TEXT NOT NULL, final_url TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
    source_hash TEXT NOT NULL, base_hash TEXT, base_document_hash TEXT,
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS customer_requests (
    id TEXT PRIMARY KEY, receipt TEXT NOT NULL UNIQUE,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK(kind IN ('quote','consultation')),
    name TEXT NOT NULL, company TEXT, email TEXT, phone TEXT, message TEXT NOT NULL,
    consent_text TEXT NOT NULL, consent_version TEXT NOT NULL,
    retention_days INTEGER NOT NULL, idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','completed')),
    summary TEXT, created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    UNIQUE(bot_id,idempotency_key)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS customer_requests_tenant_idx ON customer_requests(tenant_id,created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS request_notes (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES customer_requests(id) ON DELETE CASCADE,
    content TEXT NOT NULL, created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS operation_jobs (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('handoff_summary','request_notification')),
    target_id TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'local',
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    available_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    locked_at BIGINT, last_error TEXT, UNIQUE(kind,target_id,channel)
  )`;
}
