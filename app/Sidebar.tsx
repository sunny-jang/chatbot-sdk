"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutButton";
import GuidePanel from "./GuidePanel";

type Bot = { id: string; name: string; type: string };
export default function Sidebar({
  tenantName,
  bots,
  isAdmin,
}: {
  tenantName: string;
  bots: Bot[];
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [guideSection, setGuideSection] = useState<string | null>(null);
  const currentBot = bots.find(
    (b) => b.id === pathname.match(/^\/bots\/([^/]+)/)?.[1],
  );
  const link = (href: string, label: string, mark: string) => (
    <Link
      key={href}
      href={href}
      onClick={() => setExpanded(false)}
      aria-current={pathname === href ? "page" : undefined}
      className={`workspace-nav-link ${pathname === href ? "active" : ""}`}
    >
      <span aria-hidden="true">{mark}</span>
      {label}
    </Link>
  );
  return (
    <>
      <div className="workspace-mobile-bar">
        <Link href="/">Ideal AI</Link>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="workspace-navigation"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "메뉴 닫기" : "메뉴 열기"}
        </button>
      </div>
      <aside
        id="workspace-navigation"
        className={`workspace-sidebar ${expanded ? "expanded" : ""}`}
      >
        <Link href="/" className="workspace-brand">
          <Image
            src="/logo.png"
            alt="Ideal AI"
            width={115}
            height={36}
            unoptimized
            priority
          />
          <span>고객 상담 워크스페이스</span>
        </Link>
        <div className="workspace-account">
          <span className="workspace-avatar" aria-hidden="true">
            {tenantName.slice(0, 1)}
          </span>
          <div>
            <strong>{tenantName}</strong>
            <small>에이전시 관리</small>
          </div>
        </div>
        <nav aria-label="주 메뉴" className="workspace-navigation">
          <p className="workspace-nav-label">업무</p>
          {link("/", "업무 홈", "⌂")}
          {link("/support", "상담함", "☏")}
          {link("/requests", "문의·견적", "▤")}
          <p className="workspace-nav-label">관리</p>
          {link("/customers", "고객사 관리", "▣")}
          {link("/demos", "고객사 데모", "◈")}
          {link("/bots", "챗봇 관리", "◇")}
          {link("/analytics", "이용 현황", "▥")}
          {link("/settings", "공간 설정", "⚙")}
          {link("/plan", "요금제", "▧")}
          {currentBot && (
            <div className="workspace-bot-nav">
              <p className="workspace-nav-label">선택한 챗봇</p>
              <strong className="workspace-bot-name">{currentBot.name}</strong>
              {link(`/bots/${currentBot.id}`, "설정·설치", "⚙")}
              {link(`/bots/${currentBot.id}/docs`, "지식 문서", "▤")}
              {currentBot.type === "qa" &&
                link(`/bots/${currentBot.id}/qa`, "질문과 답변", "≡")}
              {link(`/bots/${currentBot.id}/test`, "테스트", "▷")}
              {link(`/bots/${currentBot.id}/logs`, "대화 기록", "◷")}
              {link(`/bots/${currentBot.id}/requests`, "문의·견적 관리", "▤")}
              {link(`/bots/${currentBot.id}/analytics`, "챗봇 분석", "▥")}
            </div>
          )}
          <p className="workspace-nav-label">도움말</p>
          {link("/guide", "이용 가이드", "?")}
          {link("/sdk-guide", "설치 가이드", "⌘")}
          {isAdmin && (
            <>
              <p className="workspace-nav-label">마스터 전용</p>
              {link("/admin", "플랫폼 관리", "⊞")}
            </>
          )}
        </nav>
        <div className="workspace-sidebar-footer">
          <Link href="/bots/new">새 챗봇 만들기</Link>
          <button
            type="button"
            className="text-left"
            onClick={() => setGuideSection("overview")}
          >
            상세 운영·개발 가이드
          </button>
          <LogoutButton />
        </div>
      </aside>
      <GuidePanel
        section={guideSection}
        onClose={() => setGuideSection(null)}
      />
    </>
  );
}
