import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Kakao from "next-auth/providers/kakao";
import type { OAuthConfig } from "next-auth/providers";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { randomUUID } from "crypto";

declare module "next-auth" {
  interface Session {
    tenant_id: string | null;
  }
}

const Naver: OAuthConfig<{ response: { id: string; email?: string; name: string } }> = {
  id: "naver",
  name: "Naver",
  type: "oauth",
  clientId: process.env.NAVER_CLIENT_ID,
  clientSecret: process.env.NAVER_CLIENT_SECRET,
  authorization: "https://nid.naver.com/oauth2.0/authorize",
  token: "https://nid.naver.com/oauth2.0/token",
  userinfo: "https://openapi.naver.com/v1/nid/me",
  profile(profile) {
    return {
      id: profile.response.id,
      name: profile.response.name,
      email: profile.response.email ?? null,
    };
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Kakao({
      clientId: process.env.KAKAO_CLIENT_ID!,
      clientSecret: process.env.KAKAO_CLIENT_SECRET!,
    }),
    Naver,
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account) return false;
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

      if (rows.length > 0) {
        await sql`
          UPDATE tenants SET oauth_provider = ${provider}, oauth_sub = ${sub}
          WHERE id = ${rows[0].id as string}
        `;
        user.id = rows[0].id as string;
      } else {
        const id = randomUUID();
        const apiKey = `iai-${randomUUID().replace(/-/g, "")}`;
        await sql`
          INSERT INTO tenants (id, name, api_key, email, oauth_provider, oauth_sub)
          VALUES (${id}, ${name}, ${apiKey}, ${email}, ${provider}, ${sub})
        `;
        user.id = id;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.tenant_id = user.id;
      return token;
    },
    async session({ session, token }) {
      session.tenant_id = (token.tenant_id as string) ?? null;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
