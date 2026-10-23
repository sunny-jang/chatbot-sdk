import { cache } from "react";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import sql from "@/lib/neon";
import { agencySessionValid } from "@/lib/access/credentials";
import {
  isPlatformAdminUser,
  tenantOwnerIsPlatformAdmin,
} from "@/lib/access/platform";

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

/** 마스터 여부는 세션 값이 아니라 DB에서 매번 확인합니다: 공통 신원의 is_platform_admin 또는 (이관 전 호환) tenants.is_admin. */
export const isAdminRequest = cache(async () => {
  const session = await auth();
  if (!session || session.customer_user_id) return false;
  if (session.platform_user_id) {
    if (!(await isPlatformAdminUser(sql, session.platform_user_id))) return false;
    if (session.agency_auth_version === null) return true;
    const [u] = await sql`SELECT auth_version FROM users WHERE id=${session.platform_user_id}`;
    return Number(u?.auth_version) === session.agency_auth_version;
  }
  const tenantId = await getTenantId();
  if (!tenantId) return false;
  if (await tenantOwnerIsPlatformAdmin(sql, tenantId)) return true;
  const rows = await sql`SELECT is_admin FROM tenants WHERE id = ${tenantId}`;
  return (rows[0] as { is_admin: boolean | null } | undefined)?.is_admin === true;
});

/** 플랫폼 감사 기록용 행위자 id: 공통 신원이 있으면 그 id, 없으면 null. */
export async function platformActorId(): Promise<string | null> {
  const session = await auth();
  if (session?.platform_user_id) return session.platform_user_id;
  if (!session?.tenant_id) return null;
  const [u] = await sql`SELECT id FROM users WHERE legacy_tenant_id=${session.tenant_id} AND status='active'`;
  return u ? String(u.id) : null;
}

/** 관리자 API 맨 앞에서 호출합니다. 관리자가 아니면 403 응답을, 관리자면 null을 돌려줍니다. */
export async function requireAdmin() {
  return (await isAdminRequest()) ? null : NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
