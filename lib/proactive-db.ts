import sql from "./neon";
let schemaReady:Promise<void>|null=null;
export function initProactiveSchema(){
  if(!schemaReady)schemaReady=(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS proactive_evaluations (
      id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      visit_id TEXT NOT NULL, month_key TEXT NOT NULL, summary_hash TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'processing', result JSONB, input_tokens INTEGER, output_tokens INTEGER,
      session_id TEXT, test BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      shown_at BIGINT, clicked_at BIGINT, dismissed_at BIGINT,
      UNIQUE(bot_id,visit_id,summary_hash)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS proactive_eval_usage_idx ON proactive_evaluations(tenant_id,month_key)`;
    await sql`CREATE INDEX IF NOT EXISTS proactive_eval_visit_idx ON proactive_evaluations(bot_id,visit_id,created_at)`;
  })().catch(e=>{schemaReady=null;throw e});
  return schemaReady;
}
