import Link from "next/link";
import type { ReactNode } from "react";
import { Bot } from "@/lib/db";
import BotTabs from "./BotTabs";

/** 챗봇 화면 공통 머리말: 브레드크럼 → 봇 이름·유형 → 관리 탭. 위젯 색은 아바타에만 씁니다. */
export default function BotHeader({
  bot,
  current,
  actions,
}: {
  bot: Bot;
  current: string;
  /** 머리말 오른쪽(봇 이름 옆)에 놓을 버튼. 예: 이 화면 사용방법 보기 */
  actions?: ReactNode;
}) {
  const color = bot.widget_color ?? "var(--brand)";
  const initial = (bot.name || "?").trim().charAt(0).toUpperCase();
  return (
    <header className="bot-header">
      <p className="bot-crumbs">
        <Link href="/bots">챗봇 관리</Link>
        <span aria-hidden="true">/</span>
        <span>{bot.name}</span>
        <span aria-hidden="true">/</span>
        <strong>{current}</strong>
      </p>
      <div className="bot-identity">
        <span className="bot-avatar" style={{ background: color }} aria-hidden="true">
          {initial}
        </span>
        <div>
          <h1>{bot.name}</h1>
          <p>
            <span className="bot-type">{bot.type === "qa" ? "Q&A 챗봇" : "AI 챗봇"}</span>
            {bot.system_prompt && <span className="bot-prompt">{bot.system_prompt}</span>}
          </p>
        </div>
        {actions && <div className="bot-actions">{actions}</div>}
      </div>
      <BotTabs botId={bot.id} qa={bot.type === "qa"} />
    </header>
  );
}
