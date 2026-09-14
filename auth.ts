import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { isAdminEmail, syncAdminRole } from "@/lib/admin";

declare module "next-auth" {
  interface Session {
    tenant_id: string | null;
    is_admin: boolean;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // 모든 로그인 방식(Google·이메일·개발 로그인)이 Auth.js 세션 하나를 사용합니다.
  // 세션 쿠키는 Auth.js가 AUTH_SECRET으로 암호화한 표준 JWT로 발급하므로 직접 서명하지 않습니다.
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Credentials({
      id: "credentials",
      name: "이메일",
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials.email === "string" ? credentials.email.trim() : "";
        const password = typeof credentials.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        await initSchema();
        const rows = await sql`SELECT id, name, email, password_hash FROM tenants WHERE email = ${email}`;
        const tenant = rows[0] as { id: string; name: string; email: string; password_hash: string | null } | undefined;
        if (!tenant?.password_hash || !(await compare(password, tenant.password_hash))) return null;
        await syncAdminRole(tenant.id, tenant.email);
        return { id: tenant.id, name: tenant.name, email: tenant.email };
      },
    }),
    // 로컬 개발 전용 테스트 로그인. 운영 빌드에는 공급자 자체가 등록되지 않습니다.
    ...(process.env.NODE_ENV === "development"
      ? [Credentials({
          id: "dev-login",
          name: "테스트 로그인",
          credentials: {},
          async authorize() {
            await initSchema();
            const rows = await sql`SELECT id, name, email FROM tenants ORDER BY created_at ASC LIMIT 1`;
            if (rows[0]) {
              const tenant = rows[0] as { id: string; name: string; email: string | null };
              return { id: tenant.id, name: tenant.name, email: tenant.email };
            }
            const id = crypto.randomUUID();
            const apiKey = `iai-dev-${crypto.randomUUID().replace(/-/g, "")}`;
            await sql`
              INSERT INTO tenants (id, name, api_key, email, is_admin)
              VALUES (${id}, ${"테스트 워크스페이스"}, ${apiKey}, ${"dev@ideal-ai.local"}, ${false})
            `;
            return { id, name: "테스트 워크스페이스", email: "dev@ideal-ai.local" };
          },
        })]
      : []),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account) return false;
      // 아래 계정 연결 로직은 Google 전용입니다. 이메일·개발 로그인은 authorize에서 이미 계정을 확인했습니다.
      if (account.provider !== "google") return true;
      await initSchema();

      const provider = account.provider;
      const sub = account.providerAccountId;
      const email = user.email ?? null;
      const name = user.name || email || sub;

      // 기존 테넌트 찾기: oauth_sub 우선, 없으면 email로
      let rows = await sql`
        SELECT id FROM tenants WHERE oauth_provider = ${provider} AND oauth_sub = ${sub}
      `;
      if (rows.length === 0 && email) {
        rows = await sql`SELECT id FROM tenants WHERE email = ${email}`;
      }

      const admin = isAdminEmail(email ?? "");
      if (rows.length > 0) {
        await sql`
          UPDATE tenants SET oauth_provider = ${provider}, oauth_sub = ${sub}, is_admin = ${admin}
          WHERE id = ${rows[0].id as string}
        `;
        user.id = rows[0].id as string;
      } else {
        const id = crypto.randomUUID();
        const apiKey = `iai-${crypto.randomUUID().replace(/-/g, "")}`;
        await sql`
          INSERT INTO tenants (id, name, api_key, email, oauth_provider, oauth_sub, is_admin)
          VALUES (${id}, ${name}, ${apiKey}, ${email}, ${provider}, ${sub}, ${admin})
        `;
        user.id = id;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.tenant_id = user.id;
        // 관리자 여부는 로그인 방식과 관계없이 DB 기준으로 저장합니다. (Google 로그인은 signIn 콜백에서 ADMIN_EMAILS로 먼저 동기화)
        const rows = await sql`SELECT is_admin FROM tenants WHERE id = ${user.id}`;
        token.is_admin = (rows[0] as { is_admin: boolean | null } | undefined)?.is_admin === true;
      }
      return token;
    },
    async session({ session, token }) {
      session.tenant_id = (token.tenant_id as string) ?? null;
      session.is_admin = (token.is_admin as boolean) ?? false;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
