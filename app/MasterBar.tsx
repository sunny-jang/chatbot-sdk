import Image from "next/image";
import Link from "next/link";
import LogoutButton from "./LogoutButton";
/** Top bar for the platform master console host. No agency navigation here. */
export default function MasterBar({ tenantName }: { tenantName: string }) {
  return (
    <header className="master-bar">
      <Link href="/admin" className="master-brand">
        <Image src="/logo.png" alt="Ideal AI" width={96} height={30} unoptimized priority style={{ width: 96, height: "auto" }} />
        <span>플랫폼 관리</span>
      </Link>
      <div className="master-account">
        <span>{tenantName}</span>
        <LogoutButton destination="/login" />
      </div>
    </header>
  );
}
