import sql from "./neon";
import type { SupportHours } from "./supportHours";

let _initialized = false;
let _initPromise: Promise<void> | null = null;

export async function initSchema() {
  if (_initialized) return;
  if (_initPromise) return _initPromise;
  _initPromise = _runInit().then(() => { _initialized = true; });
  return _initPromise;
}

async function _runInit() {
  await sql`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE NOT NULL,
      openai_api_key TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openai_api_key TEXT`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS password_hash TEXT`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS oauth_provider TEXT`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS oauth_sub TEXT`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter'`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS enterprise_bot_limit INTEGER`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS enterprise_monthly_session_limit INTEGER`;
  // 어드민 이메일 목록에서 is_admin 자동 갱신
  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e: string) => e.trim()).filter(Boolean);
  if (adminEmails.length > 0) {
    await sql`UPDATE tenants SET is_admin = TRUE WHERE email = ANY(${adminEmails})`;
  }
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS tenants_email_idx ON tenants (email) WHERE email IS NOT NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS tenants_oauth_idx ON tenants (oauth_provider, oauth_sub) WHERE oauth_provider IS NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      tenant_id TEXT REFERENCES tenants(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('qa', 'ai')),
      system_prompt TEXT,
      model TEXT DEFAULT 'gpt-4o-mini',
      widget_title TEXT,
      widget_color TEXT DEFAULT '#2563eb',
      greeting_message TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id)`;
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS widget_title TEXT`;
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS widget_color TEXT DEFAULT '#2563eb'`;
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS greeting_message TEXT`;
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS logo_url TEXT`;
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS support_mode TEXT NOT NULL DEFAULT 'unattended'`;
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS public_token TEXT`;
  // Q&A 마지막 단계(답변 표시)에서 항상 상담원 연결 버튼을 보여줄지 여부
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS qa_handoff_always BOOLEAN NOT NULL DEFAULT TRUE`;
  // 상담원 연결 채널: inbox(자체 상담함만) / telegram / slack 중 하나. 자체 상담함은 항상 함께 사용됩니다.
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS support_channel TEXT NOT NULL DEFAULT 'inbox'`;
  // 상담원 연결 가능 시간. NULL 또는 enabled=false면 항상 연결 가능합니다.
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS support_hours JSONB`;
  // 강제 무인 운영: 켜져 있으면 운영 시간과 관계없이 새 상담원 연결을 막습니다. (진행 중인 상담은 유지)
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS force_unattended BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`UPDATE bots SET public_token = 'ibt-' || md5(random()::text || id) WHERE public_token IS NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS bots_public_token_idx ON bots (public_token) WHERE public_token IS NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT 'legacy',
      user_message TEXT NOT NULL,
      bot_reply TEXT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`ALTER TABLE monthly_chat_sessions DROP CONSTRAINT IF EXISTS monthly_chat_sessions_bot_id_fkey`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT 'legacy'`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS intent TEXT`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS refused BOOLEAN`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS refusal_reason TEXT`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS model TEXT`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS input_tokens INTEGER`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS output_tokens INTEGER`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS latency_ms INTEGER`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS api_success BOOLEAN`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS estimated_cost_usd DOUBLE PRECISION`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS tool_name TEXT`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS tool_success BOOLEAN`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS qa_pair_id TEXT`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS qa_matched BOOLEAN`;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS qa_match_score DOUBLE PRECISION`;
  await sql`CREATE INDEX IF NOT EXISTS chat_logs_bot_created_idx ON chat_logs (bot_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS chat_logs_qa_pair_idx ON chat_logs (qa_pair_id) WHERE qa_pair_id IS NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS monthly_chat_sessions (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      month_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      PRIMARY KEY (tenant_id, month_key, session_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS monthly_chat_sessions_usage_idx ON monthly_chat_sessions (tenant_id, month_key)`;
  await sql`
    CREATE TABLE IF NOT EXISTS doc_folders (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES doc_folders(id) ON DELETE CASCADE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      folder_id TEXT REFERENCES doc_folders(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES doc_folders(id) ON DELETE SET NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS qa_folders (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS qa_pairs (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      folder_id TEXT REFERENCES qa_folders(id) ON DELETE SET NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      embedding TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`ALTER TABLE qa_pairs ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES qa_folders(id) ON DELETE SET NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'bot',
      customer_name TEXT,
      assigned_agent_name TEXT,
      started_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      closed_at BIGINT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS chat_sessions_bot_status_idx ON chat_sessions (bot_id, status, updated_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL,
      sender_name TEXT,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'widget',
      external_message_id TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at ASC)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_external_idx ON chat_messages (source, external_message_id) WHERE external_message_id IS NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS telegram_integrations (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      bot_token TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      webhook_secret TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS slack_integrations (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      bot_token TEXT NOT NULL,
      signing_secret TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      team_id TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS support_handoffs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES chat_sessions(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      telegram_chat_id TEXT,
      telegram_topic_id BIGINT,
      slack_channel_id TEXT,
      slack_thread_ts TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',
      reason TEXT,
      requested_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      accepted_at BIGINT,
      closed_at BIGINT
    )
  `;
  await sql`ALTER TABLE support_handoffs ADD COLUMN IF NOT EXISTS slack_channel_id TEXT`;
  await sql`ALTER TABLE support_handoffs ADD COLUMN IF NOT EXISTS slack_thread_ts TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS support_handoffs_slack_thread_idx ON support_handoffs (bot_id, slack_channel_id, slack_thread_ts)`;
  await sql`
    CREATE TABLE IF NOT EXISTS api_rate_limits (
      bucket_key TEXT PRIMARY KEY,
      request_count INTEGER NOT NULL DEFAULT 1,
      expires_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS phone_otps (
      phone TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )
  `;
}

export type Tenant = {
  id: string;
  name: string;
  api_key: string;
  openai_api_key: string | null;
  email: string | null;
  password_hash: string | null;
  phone: string | null;
  is_admin: boolean;
  plan: "starter" | "growth" | "pro" | "enterprise";
  subscription_status: "active" | "inactive";
  enterprise_bot_limit: number | null;
  enterprise_monthly_session_limit: number | null;
  created_at: number;
};

export type Bot = {
  id: string;
  tenant_id: string;
  name: string;
  type: "qa" | "ai";
  system_prompt: string | null;
  model: string;
  widget_title: string | null;
  widget_color: string | null;
  greeting_message: string | null;
  logo_url: string | null;
  support_mode: "unattended" | "hybrid";
  public_token: string | null;
  qa_handoff_always: boolean;
  support_channel: "inbox" | "telegram" | "slack";
  support_hours: SupportHours | null;
  force_unattended: boolean;
  created_at: number;
};

export type ChatLog = {
  id: string;
  bot_id: string;
  session_id: string;
  user_message: string;
  bot_reply: string;
  created_at: number;
  intent: string | null;
  refused: boolean | null;
  refusal_reason: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  api_success: boolean | null;
  estimated_cost_usd: number | null;
  tool_name: string | null;
  tool_success: boolean | null;
  qa_pair_id: string | null;
  qa_matched: boolean | null;
  qa_match_score: number | null;
};

export type DocFolder = {
  id: string;
  bot_id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
};

export type Document = {
  id: string;
  bot_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  embedding: string | null;
  created_at: number;
};

export type QaPair = {
  id: string;
  bot_id: string;
  folder_id: string | null;
  question: string;
  answer: string;
  embedding: string | null;
  created_at: number;
};

export type QaFolder = {
  id: string;
  bot_id: string;
  name: string;
  created_at: number;
};
