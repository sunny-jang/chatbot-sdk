import sql from "./neon";
import { decrypt } from "./crypto";

export async function getTenantApiKey(botId: string): Promise<string | null> {
  const rows = await sql`
    SELECT t.openai_api_key FROM tenants t
    JOIN bots b ON b.tenant_id = t.id
    WHERE b.id = ${botId}
  `;
  const encrypted = rows[0]?.openai_api_key as string | null | undefined;
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

export async function getTenantApiKeyByTenantId(tenantId: string): Promise<string | null> {
  const rows = await sql`SELECT openai_api_key FROM tenants WHERE id = ${tenantId}`;
  const encrypted = rows[0]?.openai_api_key as string | null | undefined;
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}
