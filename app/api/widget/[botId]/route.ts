import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  await initSchema();
  const rows = await sql`
    SELECT widget_title, widget_color, greeting_message, name
    FROM bots WHERE id = ${botId}
  `;
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bot = rows[0] as {
    widget_title: string | null;
    widget_color: string | null;
    greeting_message: string | null;
    name: string;
  };

  return NextResponse.json({
    title: bot.widget_title || bot.name,
    color: bot.widget_color || "#2563eb",
    greeting: bot.greeting_message || null,
  });
}
