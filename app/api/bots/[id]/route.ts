import { widgetTitle, widgetColor } from "@/lib/widget-presentation";
import { NextResponse } from "next/server";
import sql from "@/lib/neon";
import { Bot, initSchema } from "@/lib/db";
import { normalizeProactive } from "@/lib/proactive";
import { normalizeSupportHours } from "@/lib/supportHours";
import { readTenantId } from "@/lib/auth";

async function getTenantId() {
  return (await readTenantId()) ?? null;
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await getTenantId();
  if (!tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initSchema();
  const { id } = await params;
  const rows =
    await sql`SELECT * FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!rows[0])
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rows[0] as unknown as Bot);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await getTenantId();
  if (!tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initSchema();
  const { id } = await params;
  const check =
    await sql`SELECT id FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (!check[0])
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const {
    proactive_settings,
    name,
    system_prompt,
    model,
    widget_title,
    widget_color,
    greeting_message,
    support_mode,
    qa_handoff_always,
    support_channel,
    support_hours,
  } = await req.json();
  if (
    (widget_title !== undefined &&
      widget_title !== null &&
      widget_title !== "" &&
      !widgetTitle(widget_title)) ||
    (widget_color !== undefined && !widgetColor(widget_color))
  ) {
    return NextResponse.json(
      {
        error:
          "위젯 제목은 100자 이내 일반 텍스트, 색상은 #RGB 또는 #RRGGBB로 입력해주세요.",
      },
      { status: 400 },
    );
  }
  const rows = await sql`
    UPDATE bots SET
      proactive_settings = COALESCE(${proactive_settings === undefined ? null : sql.json(normalizeProactive(proactive_settings))}, proactive_settings),
      name = COALESCE(${name ?? null}, name),
      system_prompt = COALESCE(${system_prompt ?? null}, system_prompt),
      model = COALESCE(${model ?? null}, model),
      widget_title = ${widget_title ?? null},
      widget_color = COALESCE(${widget_color ?? null}, widget_color),
      greeting_message = ${greeting_message ?? null},
      support_mode = COALESCE(${support_mode === "hybrid" || support_mode === "unattended" ? support_mode : null}, support_mode),
      qa_handoff_always = COALESCE(${typeof qa_handoff_always === "boolean" ? qa_handoff_always : null}, qa_handoff_always),
      -- Slack은 연동 준비 중이라 선택할 수 없습니다. (inbox, telegram만 저장)
      support_channel = COALESCE(${support_channel === "inbox" || support_channel === "telegram" ? support_channel : null}, support_channel)
    WHERE id = ${id}
    RETURNING *
  `;
  if (support_hours !== undefined) {
    // 잘못된 값은 기본값으로 보정해 저장합니다. null을 보내면 운영 시간 설정을 지웁니다.
    const hours =
      support_hours === null ? null : normalizeSupportHours(support_hours);
    const updated =
      await sql`UPDATE bots SET support_hours = ${hours ? sql.json(hours) : null} WHERE id = ${id} RETURNING *`;
    return NextResponse.json(updated[0] as unknown as Bot);
  }
  return NextResponse.json(rows[0] as unknown as Bot);
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await getTenantId();
  if (!tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initSchema();
  const { id } = await params;
  await sql`DELETE FROM bots WHERE id = ${id} AND tenant_id = ${tenantId}`;
  return NextResponse.json({ ok: true });
}
