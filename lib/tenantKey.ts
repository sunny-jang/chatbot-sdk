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

export type TenantApiKeys = {
  openai: string | null;
  gemini: string | null;
};

export async function getTenantApiKeys(botId: string): Promise<TenantApiKeys> {
  const rows = await sql`
    SELECT t.openai_api_key, t.gemini_api_key FROM tenants t
    JOIN bots b ON b.tenant_id = t.id
    WHERE b.id = ${botId}
  `;
  const row = rows[0] as { openai_api_key?: string | null; gemini_api_key?: string | null } | undefined;
  const decode = (encrypted: string | null | undefined) => {
    if (!encrypted) return null;
    try { return decrypt(encrypted); } catch { return null; }
  };
  return { openai: decode(row?.openai_api_key), gemini: decode(row?.gemini_api_key) };
}

export async function getTenantApiKeysByTenantId(tenantId: string): Promise<TenantApiKeys> {
  const rows = await sql`SELECT openai_api_key, gemini_api_key FROM tenants WHERE id = ${tenantId}`;
  const row = rows[0] as { openai_api_key?: string | null; gemini_api_key?: string | null } | undefined;
  const decode = (encrypted: string | null | undefined) => {
    if (!encrypted) return null;
    try { return decrypt(encrypted); } catch { return null; }
  };
  return { openai: decode(row?.openai_api_key), gemini: decode(row?.gemini_api_key) };
}
