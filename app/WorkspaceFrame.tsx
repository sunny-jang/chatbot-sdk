"use client";
import { usePathname } from "next/navigation";
export default function WorkspaceFrame({
  navigation,
  children,
  customerHost = false,
}: {
  navigation: React.ReactNode;
  children: React.ReactNode;
  customerHost?: boolean;
}) {
  const path = usePathname();
  if (
    customerHost ||
    path === "/customer" ||
    path.startsWith("/customer/") ||
    path.startsWith("/demo/")
  )
    return <>{children}</>;
  return (
    <div className="workspace-shell">
      <a className="workspace-skip" href="#main-content">
        본문으로 이동
      </a>
      {navigation}
      <main id="main-content" className="workspace-main">
        {children}
      </main>
    </div>
  );
}
