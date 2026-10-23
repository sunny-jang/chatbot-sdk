import type { Metadata } from "next";
import sql from "@/lib/neon";
import Sidebar from "./Sidebar";
import WorkspaceFrame from "./WorkspaceFrame";
import MasterBar from "./MasterBar";
import { headers } from "next/headers";
import { isCustomerPortalHost } from "@/lib/customer-portal/host";
import { isMasterHost, masterOrigin } from "@/lib/master-host";
import { auth } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ideal AI Chatbot SDK",
  description: "Ideal AI Chatbot SDK Admin Panel",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 모든 로그인 방식(Google·이메일·개발 로그인)이 Auth.js 세션 하나를 사용합니다.
  const host = (await headers()).get("host");
  const customerHost = isCustomerPortalHost(host);
  const masterHost = isMasterHost(host);
  const session = await auth();
  const tenantId = session?.tenant_id ?? null;
  const platformUserId = session?.platform_user_id ?? null;
  const isAdmin = session?.is_admin === true;

  let tenantName: string | null = null;
  if (!tenantId && platformUserId) {
    try {
      const [u] = await sql`SELECT name FROM users WHERE id=${platformUserId}`;
      tenantName = u ? String(u.name) : null;
    } catch {}
  }
  let bots: { id: string; name: string; type: string }[] = [];
  if (tenantId) {
    try {
      const rows = await sql`SELECT name FROM tenants WHERE id = ${tenantId}`;
      tenantName = (rows[0] as { name: string } | undefined)?.name ?? null;
      if (tenantName) {
        bots =
          (await sql`SELECT id, name, type FROM bots WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`) as unknown as {
            id: string;
            name: string;
            type: string;
          }[];
      }
    } catch {
      // DB might not be ready yet (first load)
    }
  }

  return (
    <html lang="ko">
      <head>
        {/* Pretendard: Korean-first UI type shared by the agency app, the desk portal and the demo. */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-screen">
        {tenantName ? (
          <WorkspaceFrame
            customerHost={customerHost}
            masterHost={masterHost}
            masterNavigation={<MasterBar tenantName={tenantName} />}
            navigation={
              <Sidebar
                tenantName={tenantName}
                bots={bots}
                isAdmin={isAdmin}
                masterOrigin={masterOrigin()}
              />
            }
          >
            {children}
          </WorkspaceFrame>
        ) : (
          <>{children}</>
        )}
      </body>
    </html>
  );
}
