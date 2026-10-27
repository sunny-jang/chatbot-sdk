import type { AccessDatabase } from "@/lib/access/schema";

/** customers·users가 있어야 만들 수 있다(FK). 접근 마이그레이션과 initSchema(customers 존재 시) 양쪽에서 호출한다. */
export async function createDataKnowledgeSchema(db: AccessDatabase) {
  await db`CREATE TABLE IF NOT EXISTS data_connections (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    customer_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    kind TEXT NOT NULL CHECK (kind IN ('postgres','mysql')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1024 AND 65535),
    database TEXT NOT NULL,
    username TEXT NOT NULL,
    secret_enc TEXT,
    ssl BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'untested' CHECK (status IN ('untested','ok','error','deleted')),
    last_tested_at BIGINT,
    last_error TEXT,
    table_count INTEGER,
    created_by TEXT REFERENCES users(id),
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    deleted_at BIGINT,
    FOREIGN KEY(customer_id,tenant_id) REFERENCES customers(id,tenant_id),
    CHECK ((status = 'deleted') = (secret_enc IS NULL))
  )`;
  await db`CREATE INDEX IF NOT EXISTS data_connections_customer_idx ON data_connections(customer_id) WHERE status <> 'deleted'`;
  await db`CREATE TABLE IF NOT EXISTS db_sources (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES data_connections(id),
    schema_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    title_column TEXT NOT NULL,
    key_column TEXT NOT NULL,
    body_columns JSONB NOT NULL DEFAULT '[]',
    excluded_columns JSONB NOT NULL DEFAULT '[]',
    filters JSONB NOT NULL DEFAULT '[]',
    folder_id TEXT REFERENCES doc_folders(id) ON DELETE SET NULL,
    schedule TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('manual','hourly','daily','weekly')),
    row_limit INTEGER NOT NULL DEFAULT 5000 CHECK (row_limit BETWEEN 1 AND 100000),
    missing_rows TEXT NOT NULL DEFAULT 'archive' CHECK (missing_rows IN ('archive','delete')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_synced_at BIGINT,
    next_sync_at BIGINT,
    last_result JSONB,
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    sync_locked_at BIGINT,
    created_by TEXT REFERENCES users(id),
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    UNIQUE(bot_id, connection_id, schema_name, table_name)
  )`;
  await db`CREATE INDEX IF NOT EXISTS db_sources_due_idx ON db_sources(next_sync_at) WHERE enabled`;
  // 실행 시작 시각. sync_locked_at은 단계마다 갱신되는 하트비트라 "이번 실행에서 못 본 행"의 기준으로 쓸 수 없다.
  await db`ALTER TABLE db_sources ADD COLUMN IF NOT EXISTS sync_started_at BIGINT`;
  await db`CREATE TABLE IF NOT EXISTS db_source_rows (
    source_id TEXT NOT NULL REFERENCES db_sources(id) ON DELETE CASCADE,
    row_key TEXT NOT NULL,
    row_hash TEXT NOT NULL,
    document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    synced_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    PRIMARY KEY(source_id, row_key)
  )`;
  await db`CREATE INDEX IF NOT EXISTS db_source_rows_document_idx ON db_source_rows(document_id)`;
  // 기존 문서는 NULL(수동). web_sources가 있는 문서는 web, DB에서 온 문서는 db.
  await db`ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('web','file','db'))`;
  await db`ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_at BIGINT`;
  await db`CREATE INDEX IF NOT EXISTS documents_bot_active_idx ON documents(bot_id) WHERE archived_at IS NULL`;
}
