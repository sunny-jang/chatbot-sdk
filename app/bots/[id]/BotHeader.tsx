import Link from "next/link";
import { Bot } from "@/lib/db";
import BotTabs from "./BotTabs";

/** 챗봇 화면 공통 머리말: 브레드크럼 → 봇 이름·유형 → 관리 탭. 위젯 색은 아바타에만 씁니다. */
export default function BotHeader({ bot, current }: { bot: Bot; current: string }) {
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
      </div>
      <BotTabs botId={bot.id} qa={bot.type === "qa"} />
    </header>
  );
}
