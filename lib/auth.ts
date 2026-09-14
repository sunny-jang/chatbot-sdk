import { NextResponse } from "next/server";
import { auth } from "@/auth";
import sql from "@/lib/neon";

/** 로그인한 계정 ID. 모든 로그인 방식이 Auth.js 세션을 사용합니다. */
export async function getTenantId(): Promise<string | null> {
  const session = await auth();
  return session?.tenant_id ?? null;
}

/** 라우트마다 있는 지역 함수 getTenantId와 이름이 겹치지 않도록 둔 별칭입니다. */
export const readTenantId = getTenantId;

/** 세션 값이 아니라 DB의 tenants.is_admin으로 관리자 여부를 판단합니다. */
export async function isAdminRequest() {
  const tenantId = await getTenantId();
  if (!tenantId) return false;
  const rows = await sql`SELECT is_admin FROM tenants WHERE id = ${tenantId}`;
  return (rows[0] as { is_admin: boolean | null } | undefined)?.is_admin === true;
}

/** 관리자 API 맨 앞에서 호출합니다. 관리자가 아니면 403 응답을, 관리자면 null을 돌려줍니다. */
export async function requireAdmin() {
  return (await isAdminRequest()) ? null : NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
