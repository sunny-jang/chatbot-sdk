"use client";
import { usePathname } from "next/navigation";
export default function WorkspaceFrame({
  navigation,
  masterNavigation,
  children,
  customerHost = false,
  masterHost = false,
}: {
  navigation: React.ReactNode;
  masterNavigation?: React.ReactNode;
  children: React.ReactNode;
  customerHost?: boolean;
  masterHost?: boolean;
}) {
  const path = usePathname();
  if (masterHost)
    return (
      <div className="master-shell">
        {masterNavigation}
        <main id="main-content" className="master-main">
          {children}
        </main>
      </div>
    );
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
