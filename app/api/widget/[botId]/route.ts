import {
  widgetTitle,
  widgetColor,
  widgetLogo,
  DEFAULT_WIDGET_COLOR,
} from "@/lib/widget-presentation";
import { normalizeProactive } from "@/lib/proactive";
import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import { getSupportStatus } from "@/lib/supportHours";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ botId: string }> },
) {
  const { botId } = await params;
  await initSchema();
  const rows = await sql`
    SELECT proactive_settings, widget_title, widget_color, greeting_message, logo_url, name, type, support_mode, qa_handoff_always, support_hours, force_unattended
    FROM bots WHERE id = ${botId}
  `;
  if (!rows[0])
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bot = rows[0] as {
    proactive_settings: unknown;
    widget_title: string | null;
    widget_color: string | null;
    greeting_message: string | null;
    logo_url: string | null;
    name: string;
    type: string;
    support_mode: string;
    qa_handoff_always: boolean | null;
    support_hours: unknown;
    force_unattended: boolean | null;
  };

  let qaFolders: {
    id: string;
    name: string;
    questions: { id: string; question: string; answer: string }[];
  }[] = [];
  if (bot.type === "qa") {
    const folders =
      await sql`SELECT id, name FROM qa_folders WHERE bot_id = ${botId} ORDER BY name ASC`;
    const pairs =
      await sql`SELECT id, folder_id, question, answer FROM qa_pairs WHERE bot_id = ${botId} ORDER BY created_at ASC`;
    qaFolders = folders
      .map((folder) => ({
        id: folder.id as string,
        name: folder.name as string,
        questions: pairs
          .filter((pair) => pair.folder_id === folder.id)
          .map((pair) => ({
            id: pair.id as string,
            question: pair.question as string,
            answer: pair.answer as string,
          })),
      }))
      .filter((folder) => folder.questions.length > 0);
    const loose = pairs.filter((pair) => pair.folder_id === null);
    if (loose.length)
      qaFolders.push({
        id: "__uncategorized",
        name: "자주 묻는 질문",
        questions: loose.map((pair) => ({
          id: String(pair.id),
          question: String(pair.question),
          answer: String(pair.answer),
        })),
      });
  }

  return NextResponse.json(
    {
      proactive: normalizeProactive(bot.proactive_settings),
      title:
        widgetTitle(bot.widget_title) || widgetTitle(bot.name) || "고객 상담",
      type: bot.type,
      supportMode: bot.support_mode || "unattended",
      qaHandoffAlways: bot.qa_handoff_always !== false,
      // 강제 무인 운영이거나 운영 시간 밖이면 위젯이 상담원 연결 버튼을 숨기고 안내 문구를 표시합니다.
      // (무인 상담 모드는 supportMode로 따로 처리하므로 여기서는 hybrid 기준으로 계산합니다.)
      ...(() => {
        const status = getSupportStatus({ ...bot, support_mode: "hybrid" });
        return {
          supportAvailable: status.live,
          supportUnavailableReason: status.reason,
          supportHoursText: status.hoursText,
        };
      })(),
      color: widgetColor(bot.widget_color) || DEFAULT_WIDGET_COLOR,
      greeting: bot.greeting_message || null,
      logo: widgetLogo(bot.logo_url),
      qaFolders,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
