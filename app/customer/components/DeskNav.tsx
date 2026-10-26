"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "@/app/components/NavIcon";

export type DeskNavItem = { href: string; label: string; icon: string };

/** 데스크 상단 내비게이션. 현재 화면을 pill로 표시합니다. */
export default function DeskNav({ items }: { items: DeskNavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="고객사 업무" className="cp-nav">
      {items.map((item) => {
        const active =
          path === item.href || path.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
          >
            <NavIcon name={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
