import { cookies } from "next/headers";

export async function getTenantId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}
