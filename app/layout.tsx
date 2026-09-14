import type { Metadata } from "next";
import { Geist } from "next/font/google";
import sql from "@/lib/neon";
import Sidebar from "./Sidebar";
import { auth } from "@/auth";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ideal AI Chatbot SDK",
  description: "Ideal AI Chatbot SDK Admin Panel",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 모든 로그인 방식(Google·이메일·개발 로그인)이 Auth.js 세션 하나를 사용합니다.
  const session = await auth();
  const tenantId = session?.tenant_id ?? null;
  const isAdmin = session?.is_admin === true;

  let tenantName: string | null = null;
  let bots: { id: string; name: string; type: string }[] = [];
  if (tenantId) {
    try {
      const rows = await sql`SELECT name FROM tenants WHERE id = ${tenantId}`;
      tenantName = (rows[0] as { name: string } | undefined)?.name ?? null;
      if (tenantName) {
        bots = (await sql`SELECT id, name, type FROM bots WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`) as unknown as { id: string; name: string; type: string }[];
      }
    } catch {
      // DB might not be ready yet (first load)
    }
  }

  return (
    <html lang="ko" className={geist.className}>
      <body className="min-h-screen" style={{ backgroundColor: "#f8f7ff" }}>
        {tenantName ? (
          <div className="flex min-h-screen">
            <Sidebar tenantName={tenantName} bots={bots} isAdmin={isAdmin} />
            <main className="flex-1 p-8">{children}</main>
          </div>
        ) : (
          <>{children}</>
        )}
      </body>
    </html>
  );
}
