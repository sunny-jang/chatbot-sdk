import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "chatbot.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('qa', 'ai')),
      system_prompt TEXT,
      model TEXT DEFAULT 'gpt-4o-mini',
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS qa_pairs (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      embedding TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
}

export type Bot = {
  id: string;
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
