import { createDemoSchema } from "../demo/schema";
import type { AccessDatabase } from "../access/schema";
import { createDataKnowledgeSchema } from "../data-connections/schema";
/** Called only by the explicit access migration, inside its transaction. */
export async function createCustomerPortalSchema(db: AccessDatabase) {
  await createDemoSchema(db);
  await db`CREATE TABLE IF NOT EXISTS customer_invite_challenges(
   token_hash TEXT PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
   invitation_id TEXT NOT NULL REFERENCES customer_invitations(id) ON DELETE CASCADE,
   expires_at BIGINT NOT NULL, used_at BIGINT,
   created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
 )`;
  await db`CREATE TABLE IF NOT EXISTS customer_password_reset_tokens(
   token_hash TEXT PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
   user_id TEXT NOT NULL REFERENCES users(id),expires_at BIGINT NOT NULL,used_at BIGINT,
   created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
 )`;
  await db`CREATE TABLE IF NOT EXISTS customer_message_requests(
   session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
   request_key TEXT NOT NULL,
   payload_hash TEXT NOT NULL,
   message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
   PRIMARY KEY(session_id,request_key)
 )`;
  await db`CREATE INDEX IF NOT EXISTS customer_challenge_invitation_idx ON customer_invite_challenges(invitation_id)`;
  await createDataKnowledgeSchema(db);
}
