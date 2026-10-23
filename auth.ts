import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { syncAdminRole } from "@/lib/admin";
import { provisionAgencyOwner } from "@/lib/access/provision";
import { GoogleIdentityError, googleIdentity } from "@/lib/access/google";
import {
  agencySessionValid,
  verifyAgencyCredentials,
} from "@/lib/access/credentials";
import type { AccessDatabase } from "@/lib/access/schema";

declare module "next-auth" {
  interface Session {
    tenant_id: string | null;
    is_admin: boolean;
    customer_user_id: string | null;
    customer_auth_version: number | null;
    agency_auth_version: number | null;
  }
  interface User {
    customerPortal?: boolean;
    customerAuthVersion?: number;
    agencyAuthVersion?: number | null;
  }
}

export const authConfig: NextAuthConfig = {
  // 모든 로그인 방식(Google·이메일·개발 로그인)이 Auth.js 세션 하나를 사용합니다.
  // 세션 쿠키는 Auth.js가 AUTH_SECRET으로 암호화한 표준 JWT로 발급하므로 직접 서명하지 않습니다.
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Google({
      id: "customer-google",
      name: "Google 고객사 로그인",
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: { params: { prompt: "select_account" } },
    }),
    Credentials({
      id: "customer-credentials",
      name: "고객사 상담함",
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const email =
          typeof credentials.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials.password === "string" ? credentials.password : "";
        if (!email || !password || password.length > 200) return null;
        const [ready] =
          await sql`SELECT to_regclass('customer_memberships') AS memberships`;
        if (!ready.memberships) return null;
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(email),
            ),
          ),
        )
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request.headers.get("x-real-ip") ||
          "unknown";
        const bucket = `customer-login:${digest}:${ip}:${Math.floor(Date.now() / 60000)}`;
        const [rate] =
          await sql`INSERT INTO api_rate_limits(bucket_key,request_count,expires_at) VALUES(${bucket},1,EXTRACT(EPOCH FROM NOW())::BIGINT+120) ON CONFLICT(bucket_key) DO UPDATE SET request_count=api_rate_limits.request_count+1 RETURNING request_count`;
        if (Number(rate.request_count) > 10) return null;
        const [user] =
          await sql`SELECT u.id,u.name,u.email,u.password_hash,u.auth_version FROM users u
          WHERE u.email=${email} AND u.status='active' AND (
            EXISTS(SELECT 1 FROM customer_memberships m JOIN customers c ON c.id=m.customer_id WHERE m.user_id=u.id AND m.status='active' AND c.status='active')
            OR EXISTS(SELECT 1 FROM partner_memberships p WHERE p.user_id=u.id AND p.status='active'))`;
        if (
          !user?.password_hash ||
          !(await compare(password, String(user.password_hash)))
        )
          return null;
        return {
          id: String(user.id),
          name: String(user.name),
          email: String(user.email),
          customerPortal: true,
          customerAuthVersion: Number(user.auth_version),
        };
      },
    }),
    Credentials({
      id: "credentials",
      name: "이메일",
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email =
          typeof credentials.email === "string" ? credentials.email.trim() : "";
        const password =
          typeof credentials.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        await initSchema();
        // The common identity's password wins once the owner's users row exists.
        const found = await verifyAgencyCredentials(sql, email, password);
        if (!found) return null;
        if (found.email) await syncAdminRole(found.tenantId, found.email);
        await sql.begin((tx) =>
          provisionAgencyOwner(tx as unknown as AccessDatabase, found.tenantId),
        );
        return {
          id: found.tenantId,
          name: found.name,
          email: found.email,
          agencyAuthVersion: found.authVersion,
        };
      },
    }),
    // 로컬 개발 전용 테스트 로그인. 운영 빌드에는 공급자 자체가 등록되지 않습니다.
    ...(process.env.NODE_ENV === "development"
      ? [
          Credentials({
            id: "dev-login",
            name: "테스트 로그인",
            credentials: {},
            async authorize() {
              await initSchema();
              const rows =
                await sql`SELECT id, name, email FROM tenants ORDER BY created_at ASC LIMIT 1`;
              if (rows[0]) {
                const tenant = rows[0] as {
                  id: string;
                  name: string;
                  email: string | null;
                };
                return {
                  id: tenant.id,
                  name: tenant.name,
                  email: tenant.email,
                };
              }
              const id = crypto.randomUUID();
              const apiKey = `iai-dev-${crypto.randomUUID().replace(/-/g, "")}`;
              await sql`
              INSERT INTO tenants (id, name, api_key, email, is_admin)
              VALUES (${id}, ${"테스트 워크스페이스"}, ${apiKey}, ${"dev@ideal-ai.local"}, ${false})
            `;
              return {
                id,
                name: "테스트 워크스페이스",
                email: "dev@ideal-ai.local",
              };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account) return false;
      // 아래 계정 연결 로직은 Google 전용입니다. 이메일·개발 로그인은 authorize에서 이미 계정을 확인했습니다.
      if (!["google", "customer-google"].includes(account.provider)) return true;
      const customerOnly = account.provider === "customer-google";
      // Customer-portal failures redirect with a short reason; the agency login keeps Auth.js's generic denial.
      const denied = (reason: string) =>
        customerOnly ? `/customer/login?error=${reason}` : false;
      if (profile?.email_verified !== true || !user.email)
        return denied("unverified");
      await initSchema();
      try {
        // A signed-in password session may link Google to its own unverified address.
        const sessionUserId = await signedInUserId();
        const identity = await sql.begin((tx) =>
          googleIdentity(
            tx as unknown as AccessDatabase,
            {
              subject: account.providerAccountId,
              email: user.email!,
              name: user.name || user.email!,
              verified: profile.email_verified === true,
            },
            customerOnly,
            { sessionUserId },
          ),
        );
        const portal = customerOnly || !identity.tenantId;
        user.id = portal ? identity.id : identity.tenantId!;
        user.name = identity.name;
        user.email = identity.email;
        user.customerPortal = portal;
        user.customerAuthVersion = identity.authVersion;
        user.agencyAuthVersion = identity.authVersion;
        if (!portal) await syncAdminRole(identity.tenantId!, identity.email);
      } catch (e) {
        if (e instanceof GoogleIdentityError) return denied(e.reason);
        // Never print the raw error: postgres detail can carry row values.
        console.error(
          "google sign-in failed:",
          e instanceof Error ? e.name : typeof e,
        );
        return denied("failed");
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id && user.customerPortal) {
        token.customer_user_id = user.id;
        token.customer_auth_version = user.customerAuthVersion;
        token.tenant_id = null;
        token.is_admin = false;
        return token;
      }
      if (user?.id) {
        token.customer_user_id = null;
        token.customer_auth_version = null;
        token.agency_auth_version =
          typeof user.agencyAuthVersion === "number"
            ? user.agencyAuthVersion
            : null;
        token.tenant_id = user.id;
        // 관리자 여부는 로그인 방식과 관계없이 DB 기준으로 저장합니다. (Google 로그인은 signIn 콜백에서 ADMIN_EMAILS로 먼저 동기화)
        const rows =
          await sql`SELECT is_admin FROM tenants WHERE id = ${user.id}`;
        token.is_admin =
          (rows[0] as { is_admin: boolean | null } | undefined)?.is_admin ===
          true;
      }
      return token;
    },
    async session({ session, token }) {
      session.customer_auth_version =
        typeof token.customer_auth_version === "number"
          ? token.customer_auth_version
          : null;
      session.customer_user_id =
        typeof token.customer_user_id === "string"
          ? token.customer_user_id
          : null;
      session.tenant_id = (token.tenant_id as string) ?? null;
      session.agency_auth_version =
        typeof token.agency_auth_version === "number"
          ? token.agency_auth_version
          : null;
      session.is_admin = (token.is_admin as boolean) ?? false;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);

/** Common user id of the session that started this OAuth callback, if any. */
async function signedInUserId(): Promise<string | null> {
  try {
    const session = await auth();
    if (session?.customer_user_id) return session.customer_user_id;
    if (!session?.tenant_id) return null;
    // A session that getTenantId would reject (reset, revoked, disabled) must not authorize linking either.
    if (
      !(await agencySessionValid(
        sql,
        session.tenant_id,
        session.agency_auth_version ?? null,
      ))
    )
      return null;
    const [user] =
      await sql`SELECT id FROM users WHERE legacy_tenant_id=${session.tenant_id} AND status='active'`;
    return user ? String(user.id) : null;
  } catch {
    return null;
  }
}
