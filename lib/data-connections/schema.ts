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
}
