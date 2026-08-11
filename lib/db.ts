import sql from "./neon";

export async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
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
      user_message TEXT NOT NULL,
      bot_reply TEXT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
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
}

export type Tenant = {
  id: string;
  name: string;
  api_key: string;
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
