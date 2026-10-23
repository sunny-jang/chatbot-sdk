import type sql from "../neon";
import { createCustomerPortalSchema } from "../customer-portal/schema";
import { createPlatformSchema } from "./platform";
export type AccessDatabase = Pick<typeof sql, "unsafe"> & typeof sql;

/** 호출자의 트랜잭션 안에서만 실행. initSchema나 공개 요청에서 자동 실행하지 않는다. */
export async function createAccessSchema(db: AccessDatabase) {
  await db`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    legacy_tenant_id TEXT UNIQUE REFERENCES tenants(id),
    name TEXT NOT NULL,
    email TEXT UNIQUE CHECK (email IS NULL OR (email = lower(btrim(email)) AND email <> '')),
    password_hash TEXT,
    auth_version INTEGER NOT NULL DEFAULT 1,
    email_verified_at BIGINT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
  )`;
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1`;
  await db`CREATE TABLE IF NOT EXISTS user_accounts (
    provider TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY(provider, provider_subject),
    UNIQUE(user_id, provider)
  )`;
  await db`CREATE TABLE IF NOT EXISTS partner_memberships (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role = 'owner'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    PRIMARY KEY(tenant_id,user_id)
  )`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS partner_one_active_owner_idx
    ON partner_memberships(tenant_id) WHERE status = 'active'`;
  await db`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    website TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    UNIQUE(id,tenant_id)
  )`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS customers_one_default_idx
    ON customers(tenant_id) WHERE is_default = TRUE`;
  await db`CREATE TABLE IF NOT EXISTS customer_memberships (
    customer_id TEXT NOT NULL REFERENCES customers(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('admin','agent')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    PRIMARY KEY(customer_id,user_id)
  )`;
  await db`CREATE INDEX IF NOT EXISTS customer_memberships_user_idx ON customer_memberships(user_id, status)`;
  await db`CREATE TABLE IF NOT EXISTS customer_invitations (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
    role TEXT NOT NULL CHECK (role IN ('admin','agent')),
    invited_by TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
    expires_at BIGINT NOT NULL,
    accepted_by TEXT REFERENCES users(id),
    accepted_at BIGINT,
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    CHECK (expires_at > created_at),
    CHECK ((status = 'accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
      OR (status <> 'accepted' AND accepted_by IS NULL AND accepted_at IS NULL))
  )`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS customer_one_pending_invitation_idx
    ON customer_invitations(customer_id,email) WHERE status = 'pending'`;
  await db`CREATE TABLE IF NOT EXISTS access_audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT REFERENCES users(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    customer_id TEXT,
    action TEXT NOT NULL,
    target_id TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success','denied')),
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    FOREIGN KEY(customer_id,tenant_id) REFERENCES customers(id,tenant_id)
  )`;
  await db`ALTER TABLE bots ADD COLUMN IF NOT EXISTS customer_id TEXT`;
  // Additive: nullable until all legacy writers have been converted; no old bot-create flow breaks.
  await db`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bots_customer_tenant_fkey'
      AND conrelid = 'bots'::regclass) THEN
      ALTER TABLE bots ADD CONSTRAINT bots_customer_tenant_fkey
        FOREIGN KEY(customer_id,tenant_id) REFERENCES customers(id,tenant_id);
    END IF;
  END $$`;
  await db`CREATE INDEX IF NOT EXISTS bots_customer_idx ON bots(customer_id)`;
  await db`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS assigned_agent_user_id TEXT REFERENCES users(id)`;
  await db`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_user_id TEXT REFERENCES users(id)`;
  await createCustomerPortalSchema(db);
  await createPlatformSchema(db);
}
