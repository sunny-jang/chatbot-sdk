import { cache } from "react";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import sql from "@/lib/neon";
import { agencySessionValid } from "@/lib/access/credentials";

/** 로그인한 작업 공간 ID. 세션 JWT만 믿지 않고 소유자 신원의 활성 상태·auth_version을 요청당 한 번 확인합니다. */
export const getTenantId = cache(async (): Promise<string | null> => {
  const session = await auth();
  if (!session?.tenant_id || session.customer_user_id) return null;
  return (await agencySessionValid(
    sql,
    session.tenant_id,
    session.agency_auth_version ?? null,
  ))
    ? session.tenant_id
    : null;
});

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
