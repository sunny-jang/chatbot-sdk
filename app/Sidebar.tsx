"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutButton";
import GuidePanel from "./GuidePanel";

type Bot = { id: string; name: string; type: string };

const GUIDE_SECTIONS = [
  { label: "— 관리자 가이드", id: null },
  { label: "서비스 개요", id: "overview" },
  { label: "봇 만들기", id: "create-bot" },
  { label: "Q&A 봇", id: "qa-bot" },
  { label: "AI 봇 & 문서", id: "ai-bot" },
  { label: "위젯 임베드", id: "embed" },
  { label: "그누보드", id: "gnuboard" },
  { label: "Cafe24", id: "cafe24" },
  { label: "웹뷰", id: "webview" },
  { label: "— 개발자 가이드", id: null },
  { label: "서버 설치", id: "quickstart" },
  { label: "환경변수", id: "env" },
  { label: "채팅 API", id: "api" },
  { label: "RAG 검색", id: "rag" },
  { label: "데이터베이스", id: "db" },
  { label: "폴더 구조", id: "structure" },
];

export default function Sidebar({ tenantName, bots, isAdmin }: { tenantName: string; bots: Bot[]; isAdmin?: boolean }) {
  const pathname = usePathname();
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideSection, setGuideSection] = useState<string | null>(null);

  const [masterOpen, setMasterOpen] = useState(false);

  const botMatch = pathname.match(/^\/bots\/([^/]+)/);
  const currentBotId = botMatch?.[1];
  const currentBot = currentBotId && currentBotId !== "new"
    ? bots.find((b) => b.id === currentBotId)
    : null;

  const navLink = (href: string, icon: string, label: string, redDot?: boolean) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors"
        style={active
          ? { backgroundColor: "#ede9ff", color: "#6d28d9", fontWeight: 500 }
          : { color: "#4b4075" }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "#edeaff"; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
      >
        <span>{icon}</span>
        {label}
        {redDot && <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#ef4444", flexShrink: 0 }} />}
      </Link>
    );
  };

  const subLink = (href: string, icon: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className="flex items-center gap-2 pl-4 pr-3 py-2 text-sm rounded-lg transition-colors"
        style={active
          ? { backgroundColor: "#ede9ff", color: "#6d28d9", fontWeight: 500 }
          : { color: "#5c5280" }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "#edeaff"; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
      >
        <span className="text-base">{icon}</span>
        {label}
      </Link>
    );
  };

  return (
    <>
      <aside className="w-56 flex flex-col border-r" style={{ backgroundColor: "#f8f7ff", borderColor: "#e8e6ff" }}>
        <div className="px-4 pt-5 pb-4 border-b" style={{ borderColor: "#e8e6ff" }}>
          <Link href="/">
            <Image src="/logo.png" alt="Ideal AI" width={120} height={36} priority style={{ height: 36, width: "auto" }} />
          </Link>
          <p className="text-xs mt-2.5 truncate" style={{ color: "#9b8fc0" }}>{tenantName}</p>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navLink("/", "🤖", "챗봇", true)}
          {navLink("/bots/new", "➕", "새 챗봇 만들기")}
          {navLink("/settings", "⚙️", "설정")}

          {isAdmin && (
            <>
              <button
                onClick={() => setMasterOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors"
                style={{ color: "#4b4075" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#edeaff"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
              >
                <span className="flex items-center gap-2"><span>🛠️</span> 마스터 도구</span>
                <span style={{ fontSize: "10px", color: "#9b8fc0" }}>{masterOpen ? "▲" : "▼"}</span>
              </button>
              {masterOpen && (
                <div className="space-y-0.5 ml-2">
                  {subLink("/admin", "👥", "계정 관리")}
                </div>
              )}
            </>
          )}

          {/* Guide accordion */}
          <button
            onClick={() => setGuideOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors"
            style={{ color: "#4b4075" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#edeaff"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
          >
            <span className="flex items-center gap-2"><span>📖</span> 가이드</span>
            <span style={{ fontSize: "10px", color: "#9b8fc0" }}>{guideOpen ? "▲" : "▼"}</span>
          </button>

          {guideOpen && (
            <div className="space-y-0.5 ml-2">
              {GUIDE_SECTIONS.map((s, i) =>
                s.id === null ? (
                  <p key={i} className="px-4 pt-3 pb-1 text-xs font-semibold" style={{ color: "#b8aee0" }}>
                    {s.label}
                  </p>
                ) : (
                  <button
                    key={s.id}
                    onClick={() => setGuideSection(s.id)}
                    className="w-full flex items-center gap-2 pl-4 pr-3 py-1.5 text-xs rounded-lg transition-colors text-left"
                    style={{
                      color: guideSection === s.id ? "#6d28d9" : "#5c5280",
                      backgroundColor: guideSection === s.id ? "#ede9ff" : "transparent",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#edeaff"; }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        guideSection === s.id ? "#ede9ff" : "";
                    }}
                  >
                    {s.label}
                  </button>
                )
              )}
            </div>
          )}

          {currentBot && (
            <>
              <div className="pt-4 pb-1 px-3">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#b8aee0" }}>선택된 챗봇</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className="shrink-0 px-1.5 py-0.5 text-xs font-medium rounded-full"
                    style={currentBot.type === "qa"
                      ? { backgroundColor: "#d1fae5", color: "#065f46" }
                      : { backgroundColor: "#ede9fe", color: "#6d28d9" }}
                  >
                    {currentBot.type === "qa" ? "Q&A" : "AI"}
                  </span>
                  <p className="text-sm font-semibold truncate" style={{ color: "#2d1b69" }}>{currentBot.name}</p>
                </div>
              </div>

              <div className="space-y-0.5">
                {subLink(`/bots/${currentBot.id}`, "⚙️", "설정")}
                {currentBot.type === "qa" && subLink(`/bots/${currentBot.id}/qa`, "💬", "Q&A 관리")}
                {subLink(`/bots/${currentBot.id}/docs`, "📄", "문서 관리")}
                {subLink(`/bots/${currentBot.id}/test`, "▶", "테스트")}
                {subLink(`/bots/${currentBot.id}/logs`, "📋", "대화 기록")}
              </div>
            </>
          )}
        </nav>

        <div className="p-4 border-t" style={{ borderColor: "#e8e6ff" }}>
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
