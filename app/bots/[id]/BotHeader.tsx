import Link from "next/link";
import { Bot } from "@/lib/db";

export default function BotHeader({ bot, current }: { bot: Bot; current: string }) {
  const color = bot.widget_color ?? "#2563eb";

  return (
    <div className="mb-6 -mx-8 -mt-8">
      {/* Colored banner */}
      <div
        className="px-8 pt-7 pb-6"
        style={{ backgroundColor: color }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs mb-4" style={{ color: `${color}99` === color ? "#fff8" : "rgba(255,255,255,0.65)" }}>
          <Link href="/" className="hover:opacity-100 opacity-70 text-white transition-opacity">챗봇</Link>
          <span className="text-white opacity-40">/</span>
          <span className="text-white opacity-70">{bot.name}</span>
          <span className="text-white opacity-40">/</span>
          <span className="text-white">{current}</span>
        </div>

        {/* Bot identity */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl">
            {bot.type === "qa" ? "📚" : "✨"}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{bot.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-white/20 text-white">
                {bot.type === "qa" ? "Q&A 봇" : "AI 봇"}
              </span>
              {bot.system_prompt && (
                <span className="text-xs text-white/60 truncate max-w-xs">{bot.system_prompt}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Current page indicator */}
      <div className="h-1" style={{ backgroundColor: `${color}55` }} />
    </div>
  );
}
