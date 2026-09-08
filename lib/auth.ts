import { cookies } from "next/headers";
import { auth } from "@/auth";

export async function getTenantId(): Promise<string | null> {
  const jar = await cookies();
  const cookieTenantId = jar.get("tenant_id")?.value;
  if (cookieTenantId) return cookieTenantId;
  const session = await auth();
  return session?.tenant_id ?? null;
}
