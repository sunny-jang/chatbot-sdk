"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "@/app/components/NavIcon";

/** 챗봇 안에서 쓰는 상단 탭. 고객사 데스크의 챗봇 워크스페이스처럼 관리 메뉴를 한 줄로 보여줍니다. */
export default function BotTabs({ botId, qa }: { botId: string; qa: boolean }) {
  const path = usePathname();
  const base = `/bots/${botId}`;
  const items: { href: string; label: string; icon: string }[] = [
    { href: base, label: "설정·설치", icon: "settings" },
    { href: `${base}/docs`, label: "지식 문서", icon: "docs" },
    ...(qa ? [{ href: `${base}/qa`, label: "질문과 답변", icon: "qa" }] : []),
    { href: `${base}/test`, label: "테스트", icon: "test" },
    { href: `${base}/logs`, label: "대화 기록", icon: "logs" },
    { href: `${base}/requests`, label: "문의·견적 관리", icon: "requests" },
    { href: `${base}/analytics`, label: "챗봇 분석", icon: "analytics" },
  ];
  return (
    <nav className="bot-tabs" aria-label="챗봇 관리 메뉴">
      {items.map((item) => {
        const active =
          item.href === base
            ? path === base
            : path === item.href || path.startsWith(item.href + "/");
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
