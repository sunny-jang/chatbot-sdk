import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { randomUUID } from "crypto";
import { isAdminEmail } from "@/lib/admin";

declare module "next-auth" {
  interface Session {
    tenant_id: string | null;
    is_admin: boolean;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
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

      const admin = isAdminEmail(email ?? "");
      if (rows.length > 0) {
        await sql`
          UPDATE tenants SET oauth_provider = ${provider}, oauth_sub = ${sub}, is_admin = ${admin}
          WHERE id = ${rows[0].id as string}
        `;
        user.id = rows[0].id as string;
      } else {
        const id = randomUUID();
        const apiKey = `iai-${randomUUID().replace(/-/g, "")}`;
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
        token.is_admin = isAdminEmail(user.email ?? "");
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
