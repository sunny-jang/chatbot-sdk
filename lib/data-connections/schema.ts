import type { AccessDatabase } from "@/lib/access/schema";

/** customers·users가 있어야 만들 수 있다(FK). 접근 마이그레이션과 initSchema(customers 존재 시) 양쪽에서 호출한다. */
/**
 * 컬럼이 없을 때만 ALTER한다. ADD COLUMN IF NOT EXISTS도 표 전체에 AccessExclusive 잠금을 잡으므로
 * 이미 있으면 잠금 없이 넘어가 요청 경로(initSchema)와 다른 트랜잭션을 막지 않는다.
 */
async function addColumn(db: AccessDatabase, table: string, column: string, ddl: string) {
  const [has] = await db`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=${table} AND column_name=${column}`;
  if (!has) await db.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`);
}

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
  // 엔터프라이즈 계약별 DB 지식 행 한도(없으면 요금제 기본값).
  await addColumn(db, "tenants", "enterprise_db_row_limit", "INTEGER");
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
  await addColumn(db, "db_sources", "sync_started_at", "BIGINT");
  // 진행 중인 가져오기의 커서·건수. 클라이언트가 보낸 값은 믿지 않고 서버가 들고 있는다.
  await addColumn(db, "db_sources", "sync_state", "JSONB");
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
  // 이번 실행에서 본 행 표시. 같은 초 안에 실행이 이어져도 "못 본 행"을 정확히 고른다.
  await addColumn(db, "db_source_rows", "run_id", "TEXT");
  // 기존 문서는 NULL(수동). web_sources가 있는 문서는 web, DB에서 온 문서는 db.
  await addColumn(db, "documents", "source_kind", "TEXT CHECK (source_kind IS NULL OR source_kind IN ('web','file','db'))");
  await addColumn(db, "documents", "archived_at", "BIGINT");
  // 숫자 조건 질문용 필드(DB 행에서만 채운다). [{column,label,unit,value}]
  await addColumn(db, "documents", "numeric_fields", "JSONB");
  await db`CREATE INDEX IF NOT EXISTS documents_bot_active_idx ON documents(bot_id) WHERE archived_at IS NULL`;
  // 실시간 조회: 고객사가 등록한 조회만 대화 중에 실행한다(PRD-db-live-lookup).
  await db`CREATE TABLE IF NOT EXISTS db_lookups (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES data_connections(id),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
    description TEXT NOT NULL DEFAULT '',
    schema_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    params JSONB NOT NULL DEFAULT '[]',
    outputs JSONB NOT NULL DEFAULT '[]',
    filters JSONB NOT NULL DEFAULT '[]',
    max_rows INTEGER NOT NULL DEFAULT 5 CHECK (max_rows BETWEEN 1 AND 10),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT REFERENCES users(id),
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
  )`;
  await db`CREATE INDEX IF NOT EXISTS db_lookups_bot_idx ON db_lookups(bot_id)`;
  // 실행 기록. 방문자가 입력한 값은 저장하지 않는다(상태·행 수·시간만).
  await db`CREATE TABLE IF NOT EXISTS db_lookup_calls (
    id TEXT PRIMARY KEY,
    lookup_id TEXT REFERENCES db_lookups(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('ok','empty','need_input','too_broad','too_many_calls','rate_limited','timeout','error')),
    row_count INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    cached BOOLEAN NOT NULL DEFAULT FALSE,
    test BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
  )`;
  await db`CREATE INDEX IF NOT EXISTS db_lookup_calls_bot_idx ON db_lookup_calls(bot_id, created_at)`;
  await db`CREATE INDEX IF NOT EXISTS db_lookup_calls_session_idx ON db_lookup_calls(session_id, created_at) WHERE session_id IS NOT NULL`;
}
