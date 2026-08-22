import sql from "./neon";

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
  await sql`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL DEFAULT 'legacy',
      user_message TEXT NOT NULL,
      bot_reply TEXT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT 'legacy'`;
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
    CREATE TABLE IF NOT EXISTS qa_pairs (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      embedding TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
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
  created_at: number;
};

export type ChatLog = {
  id: string;
  bot_id: string;
  session_id: string;
  user_message: string;
  bot_reply: string;
  created_at: number;
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
  question: string;
  answer: string;
  embedding: string | null;
  created_at: number;
};
