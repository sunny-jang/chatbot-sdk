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
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;
  await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id)`;
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
