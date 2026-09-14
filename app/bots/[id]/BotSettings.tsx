"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "@/lib/db";
import HelpButton, { type HelpContent } from "@/app/HelpButton";
import { DEFAULT_SUPPORT_HOURS, formatSupportHours, getSupportStatus, normalizeSupportHours, type SupportHours } from "@/lib/supportHours";

// Telegram 상담원 연결 설정 가이드. 실제 설정 중 자주 막히는 지점(주제 기능, 봇 권한, Chat ID 형식)을 함께 안내합니다.
const TELEGRAM_GUIDE: HelpContent = {
  title: "Telegram 봇 연결 가이드",
  sections: [
    {
      heading: "1. 봇 만들고 토큰 받기",
      items: [
        "텔레그램에서 파란 인증 마크가 있는 @BotFather를 검색해 대화를 시작합니다.",
        "/newbot 을 입력하고 봇 이름(예: 뷰랩스 상담봇)과 아이디(영문, 끝이 bot, 예: beaulabs_support_bot)를 정합니다.",
        "완료 메시지의 'Use this token to access the HTTP API:' 아래 긴 문자열이 Bot Token입니다. 비밀번호와 같으니 이 설정 화면에만 입력하세요.",
        "봇 아이디를 잊었다면 @BotFather에 /mybots 를 입력하면 목록에서 확인할 수 있습니다.",
      ],
    },
    {
      heading: "2. 상담용 그룹 만들고 주제(Topics) 켜기",
      items: [
        "상담원들이 함께 쓸 새 그룹을 만듭니다.",
        "그룹 이름 → 편집 → 주제(Topics)를 켭니다. 상담 요청 1건마다 그룹 안에 주제(대화방)가 하나씩 생기므로 필수입니다.",
        "주제를 켜면 그룹이 슈퍼그룹으로 바뀌고 Chat ID도 새로 발급됩니다.",
      ],
    },
    {
      heading: "3. 봇을 관리자로 지정하고 권한 주기",
      items: [
        "그룹 이름 → 편집 → 관리자 → 관리자 추가 → 봇 아이디를 검색해 선택합니다.",
        "권한 목록에서 '주제 관리(Manage Topics)'를 켜고 저장합니다.",
        "봇을 먼저 관리자로 지정한 뒤 주제를 켰다면 이 권한이 꺼진 채 남습니다. 관리자 목록에서 봇을 눌러 권한이 켜져 있는지 꼭 다시 확인하세요.",
        "봇 프로필 화면에서는 권한을 바꿀 수 없습니다. 반드시 그룹 편집 → 관리자에서 설정하세요.",
      ],
    },
    {
      heading: "4. Chat ID 확인하기",
      items: [
        "그룹의 주제 정보에서 링크 t.me/c/4242797864/1 을 확인합니다. 가운데 숫자에 -100을 붙인 값(-1004242797864)이 Chat ID입니다.",
        "웹 텔레그램(web.telegram.org/k) 주소 끝 숫자(-4242797864)나 링크의 숫자만 넣어도 저장할 때 자동으로 -100을 붙여 찾습니다.",
        "링크 끝의 /1, _2 같은 주제 번호는 빼고 입력하세요.",
      ],
    },
    {
      heading: "5. 저장·테스트하고 채널 선택하기",
      items: [
        "Bot Token과 Chat ID를 입력하고 '연결 저장·테스트'를 누릅니다.",
        "성공하면 그룹에 '✅ IDEAL AI 연동 테스트' 주제가 생기고 연동 완료 메시지가 옵니다. 테스트 주제는 지워도 됩니다.",
        "실패하면 카드 아래 빨간 문구의 안내(주제 꺼짐, 권한 없음 등)를 따라 고친 뒤 다시 누르세요.",
        "상담원 연결 채널에서 'Telegram'을 선택하고 페이지 아래 저장 버튼을 누르면 이후 상담 요청이 텔레그램으로 전달됩니다.",
      ],
    },
    {
      heading: "알아두기",
      items: [
        "상담원은 해당 주제에 답장하면 고객 웹챗으로 전달되고, /close 를 입력하면 상담이 종료됩니다.",
        "텔레그램 답장이 웹챗으로 돌아오려면 외부에서 접속 가능한 실서버 주소에서 저장해야 합니다. 로컬(localhost)에서는 텔레그램으로 보내는 것만 동작합니다.",
        "채널을 바꾸거나 설정을 고쳐도 이미 접수된 상담은 원래 채널에서 이어집니다. 새 설정은 다음 상담 요청부터 적용됩니다.",
      ],
    },
  ],
};

// 저장된 토큰·시크릿은 서버가 내려주지 않으므로, 저장 여부만 가림 문자열로 표시합니다.
const SECRET_MASK = "********";
const secretToSend = (value: string) => (value && value !== SECRET_MASK ? value : undefined);
const selectMaskOnFocus = (e: React.FocusEvent<HTMLInputElement>) => {
  if (e.target.value === SECRET_MASK) e.target.select();
};

export default function BotSettings({ bot }: { bot: Bot }) {
  const router = useRouter();
  const [name, setName] = useState(bot.name);
  const [systemPrompt, setSystemPrompt] = useState(bot.system_prompt ?? "");
  const [model, setModel] = useState(bot.model);
  const [widgetTitle, setWidgetTitle] = useState(bot.widget_title ?? "");
  const [widgetColor, setWidgetColor] = useState(bot.widget_color ?? "#2563eb");
  const [greeting, setGreeting] = useState(bot.greeting_message ?? "");
  const [supportMode, setSupportMode] = useState<"unattended" | "hybrid">(bot.support_mode ?? "unattended");
  const [qaHandoffAlways, setQaHandoffAlways] = useState(bot.qa_handoff_always !== false);
  const [supportChannel, setSupportChannel] = useState<"inbox" | "telegram" | "slack">(bot.support_channel ?? "inbox");
  const [supportHours, setSupportHours] = useState<SupportHours>(normalizeSupportHours(bot.support_hours) ?? DEFAULT_SUPPORT_HOURS);
  const [forceUnattended, setForceUnattended] = useState(Boolean(bot.force_unattended));
  const [forceSaving, setForceSaving] = useState(false);
  const [forceError, setForceError] = useState("");
  // 운영 시간 경계를 넘으면 상태 표시가 바뀌도록 30초마다 다시 계산합니다.
  const [statusNow, setStatusNow] = useState(() => new Date());
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [slackConnected, setSlackConnected] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramStatus, setTelegramStatus] = useState("");
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [slackToken, setSlackToken] = useState("");
  const [slackSecret, setSlackSecret] = useState("");
  const [slackChannelId, setSlackChannelId] = useState("");
  const [slackStatus, setSlackStatus] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const [origin, setOrigin] = useState("");
  const [logoUrl, setLogoUrl] = useState(bot.logo_url ?? "");
  const [logoUploading, setLogoUploading] = useState(false);
  const [serviceDesc, setServiceDesc] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setStatusNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch(`/api/bots/${bot.id}/integrations/telegram`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.chat_id) setTelegramChatId(data.chat_id);
        if (data?.connected) { setTelegramStatus("연결 정보가 저장되어 있습니다."); setTelegramConnected(true); }
        if (data?.hasToken) setTelegramToken(SECRET_MASK);
      })
      .catch(() => null);
    fetch(`/api/bots/${bot.id}/integrations/slack`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.channel_id) setSlackChannelId(data.channel_id);
        if (data?.connected) { setSlackStatus("연결 정보가 저장되어 있습니다."); setSlackConnected(true); }
        if (data?.hasToken) setSlackToken(SECRET_MASK);
        if (data?.hasSecret) setSlackSecret(SECRET_MASK);
      })
      .catch(() => null);
  }, [bot.id]);

  async function handleGenerate() {
    if (!serviceDesc.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}/generate-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: serviceDesc }),
      });
      const data = await res.json();
      if (data.systemPrompt) setSystemPrompt(data.systemPrompt);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/bots/${bot.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        system_prompt: systemPrompt,
        model,
        widget_title: widgetTitle || null,
        widget_color: widgetColor,
        greeting_message: greeting || null,
        support_mode: supportMode,
        qa_handoff_always: qaHandoffAlways,
        support_channel: supportChannel,
        support_hours: supportHours,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  // 강제 무인 운영은 긴급 전환용이라 하단 저장 버튼 없이 즉시 저장합니다.
  async function handleForceUnattended(next: boolean) {
    setForceSaving(true);
    setForceError("");
    const previous = forceUnattended;
    setForceUnattended(next);
    try {
      const res = await fetch(`/api/bots/${bot.id}/support-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force_unattended: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "전환에 실패했습니다.");
    } catch (error) {
      setForceUnattended(previous);
      setForceError(error instanceof Error ? error.message : "전환에 실패했습니다.");
    } finally {
      setForceSaving(false);
    }
  }

  async function handleTelegramSave() {
    setTelegramSaving(true);
    setTelegramStatus("");
    try {
      const res = await fetch(`/api/bots/${bot.id}/integrations/telegram`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_token: secretToSend(telegramToken), chat_id: telegramChatId, enabled: true }),
      });
      const data = await res.json();
      setTelegramStatus(res.ok ? `✓ Telegram 연결 완료${data.botUsername ? ` (@${data.botUsername})` : ""}` : data.error || "연결에 실패했습니다.");
      if (res.ok) { setTelegramToken(SECRET_MASK); setTelegramConnected(true); }
      // 주제를 켜서 그룹 ID가 바뀐 경우 서버가 확인한 새 Chat ID로 입력칸을 맞춥니다.
      if (data.chatId) setTelegramChatId(String(data.chatId));
    } finally {
      setTelegramSaving(false);
    }
  }

  async function handleSlackSave() {
    setSlackSaving(true);
    setSlackStatus("");
    try {
      const res = await fetch(`/api/bots/${bot.id}/integrations/slack`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_token: secretToSend(slackToken), signing_secret: secretToSend(slackSecret), channel_id: slackChannelId, enabled: true }),
      });
      const data = await res.json();
      setSlackStatus(res.ok ? `✓ Slack 연결 완료${data.teamName ? ` (${data.teamName})` : ""}` : data.error || "연결에 실패했습니다.");
      if (res.ok) { setSlackToken(SECRET_MASK); setSlackSecret(SECRET_MASK); setSlackConnected(true); }
    } finally {
      setSlackSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`"${bot.name}" 챗봇을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
    router.push("/");
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    const form = new FormData(); form.append("file", file);
    const res = await fetch(`/api/bots/${bot.id}/logo`, { method: "POST", body: form });
    const data = await res.json();
    if (res.ok) setLogoUrl(data.logo_url);
    setLogoUploading(false); e.target.value = "";
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* 기본 설정 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-900">기본 설정</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">챗봇 이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {bot.type === "ai" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">서비스 설명</label>
              <div className="flex gap-2">
                <textarea
                  value={serviceDesc}
                  onChange={(e) => setServiceDesc(e.target.value)}
                  rows={2}
                  placeholder="예) 강남구 소재 피부과 클리닉 챗봇입니다. 진료 예약, 시술 안내, 가격 문의에 응대합니다."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                />
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !serviceDesc.trim()}
                  className="shrink-0 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg disabled:opacity-40 transition-colors leading-tight"
                >
                  {generating ? (
                    <span className="flex flex-col items-center gap-0.5">
                      <span>생성 중</span>
                      <span>...</span>
                    </span>
                  ) : (
                    <span className="flex flex-col items-center gap-0.5">
                      <span>✨ 프롬프트</span>
                      <span>생성</span>
                    </span>
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">시스템 프롬프트</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">모델</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="gpt-4o-mini">gpt-4o-mini (빠름, 저렴)</option>
                <option value="gpt-4o">gpt-4o (고성능)</option>
                <option value="gpt-4.1">gpt-4.1</option>
              </select>
            </div>
          </>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-gray-900">상담 운영 방식</h3>
          <p className="text-xs text-gray-500 mt-1">챗봇별로 24시간 무인 상담 또는 상담원 연결형을 선택합니다.</p>
        </div>
        {(() => {
          const status = getSupportStatus({ support_mode: supportMode, force_unattended: forceUnattended, support_hours: supportHours }, statusNow);
          const tone = status.live
            ? { dot: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", text: "#166534" }
            : status.reason === "forced"
              ? { dot: "#dc2626", bg: "#fef2f2", border: "#fecaca", text: "#991b1b" }
              : status.reason === "outside_hours"
                ? { dot: "#d97706", bg: "#fffbeb", border: "#fde68a", text: "#92400e" }
                : { dot: "#9ca3af", bg: "#f9fafb", border: "#e5e7eb", text: "#374151" };
          return (
            <div className="rounded-xl border p-4 flex items-center justify-between gap-4" style={{ backgroundColor: tone.bg, borderColor: tone.border }}>
              <div className="min-w-0">
                <p className="text-[11px] font-medium" style={{ color: tone.text, opacity: 0.8 }}>현재 상담 운영 상태</p>
                <p className="mt-0.5 flex items-center gap-2 text-sm font-semibold" style={{ color: tone.text }}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tone.dot }} aria-hidden />
                  {status.label}
                </p>
                <p className="text-xs mt-1" style={{ color: tone.text, opacity: 0.8 }}>
                  {supportMode !== "hybrid"
                    ? "상담원 연결 버튼이 표시되지 않습니다."
                    : forceUnattended
                      ? "운영 시간과 관계없이 상담원 연결 버튼을 숨기고 챗봇만 응대합니다. 진행 중인 상담은 유지됩니다."
                      : "강제 무인 운영을 켜면 즉시 상담원 연결을 멈춥니다."}
                  {bot.support_mode !== supportMode && " · 운영 방식 변경은 아래 저장 후 적용됩니다."}
                </p>
                {forceError && <p className="text-xs mt-1 text-red-600">{forceError}</p>}
              </div>
              <label className={`flex items-center gap-2 shrink-0 ${supportMode === "hybrid" ? "cursor-pointer" : "opacity-40"}`}>
                <span className="text-xs font-medium" style={{ color: tone.text }}>{forceSaving ? "전환 중…" : "강제 무인 운영"}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={forceUnattended}
                  aria-label="강제 무인 운영"
                  disabled={forceSaving || supportMode !== "hybrid"}
                  onClick={() => handleForceUnattended(!forceUnattended)}
                  className="relative w-11 h-6 rounded-full transition-colors disabled:cursor-not-allowed"
                  style={{ backgroundColor: forceUnattended ? "#dc2626" : "#d1d5db" }}
                >
                  <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform" style={{ transform: forceUnattended ? "translateX(20px)" : "translateX(0)" }} />
                </button>
              </label>
            </div>
          );
        })()}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setSupportMode("unattended")} className={`p-4 rounded-xl border-2 text-left ${supportMode === "unattended" ? "border-violet-500 bg-violet-50" : "border-gray-200"}`}>
            <b className="block text-sm text-gray-900">24시간 무인 상담</b>
            <span className="block text-xs text-gray-500 mt-1">Q&A 또는 AI가 계속 응대하고 상담원 연결은 표시하지 않습니다.</span>
          </button>
          <button type="button" onClick={() => setSupportMode("hybrid")} className={`p-4 rounded-xl border-2 text-left ${supportMode === "hybrid" ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}>
            <b className="block text-sm text-gray-900">챗봇 + 상담원 연결</b>
            <span className="block text-xs text-gray-500 mt-1">고객 요청이나 답변 실패 시 Telegram 또는 Slack 상담원에게 연결합니다.</span>
          </button>
        </div>
        {supportMode === "hybrid" && <div className="space-y-3">
        {bot.type === "qa" && (
          <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 p-4 cursor-pointer">
            <span>
              <b className="block text-sm text-gray-900">Q&A 답변 후 항상 상담원 연결 표시</b>
              <span className="block text-xs text-gray-500 mt-1">
                {qaHandoffAlways
                  ? "질문을 골라 답변을 본 마지막 단계에서 항상 상담원 연결 버튼을 보여줍니다."
                  : "답변을 찾지 못한 경우에만 상담원 연결 버튼을 보여줍니다. 상단 상담원 연결 바는 계속 표시됩니다."}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={qaHandoffAlways}
              onChange={(e) => setQaHandoffAlways(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-blue-500"
            />
          </label>
        )}
        <div className="rounded-xl border border-gray-200 p-4 space-y-3">
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <span>
              <b className="block text-sm text-gray-900">상담원 연결 가능 시간</b>
              <span className="block text-xs text-gray-500 mt-1">
                {supportHours.enabled
                  ? "설정한 시간에만 상담원 연결 버튼을 보여주고, 그 외 시간에는 버튼을 숨기고 무인 상담으로 운영하며 가능 시간을 안내합니다."
                  : "꺼져 있으면 항상 상담원 연결 버튼을 보여줍니다."}
              </span>
            </span>
            <input type="checkbox" role="switch" checked={supportHours.enabled} onChange={(e) => setSupportHours({ ...supportHours, enabled: e.target.checked })} className="mt-1 h-5 w-5 shrink-0 accent-blue-500" />
          </label>
          {supportHours.enabled && <>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="상담 가능 요일">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const selected = supportHours.days.includes(day);
                return (
                  <button key={day} type="button" aria-pressed={selected}
                    onClick={() => setSupportHours({ ...supportHours, days: selected ? supportHours.days.filter((d) => d !== day) : [...supportHours.days, day].sort() })}
                    className={`w-9 h-9 rounded-lg text-xs font-medium border ${selected ? "bg-blue-500 text-white border-blue-500" : "bg-white text-gray-600 border-gray-300"}`}>
                    {["일", "월", "화", "수", "목", "금", "토"][day]}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <input type="time" value={supportHours.start} onChange={(e) => e.target.value && setSupportHours({ ...supportHours, start: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg" aria-label="시작 시각" />
              <span className="text-gray-400">~</span>
              <input type="time" value={supportHours.end} onChange={(e) => e.target.value && setSupportHours({ ...supportHours, end: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg" aria-label="종료 시각" />
              <span className="text-xs text-gray-400">한국 표준시</span>
            </div>
            <p className="text-xs text-gray-500">
              {supportHours.days.length === 0
                ? "⚠ 요일을 하나 이상 선택해주세요. 선택하지 않으면 상담원 연결이 표시되지 않습니다."
                : <>고객에게 표시: <b className="text-gray-700">상담원 연결 가능 시간: {formatSupportHours(supportHours)}</b>{supportHours.start > supportHours.end && " (자정을 넘겨 다음 날까지 운영)"}</>}
            </p>
          </>}
        </div>
        <div><b className="text-sm text-gray-900">상담원 연결 채널</b><p className="text-xs text-gray-500 mt-1">상담원이 응대할 채널을 하나 선택합니다. 자체 상담함(상담원 연결 관리)에는 항상 함께 기록됩니다.</p></div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="상담원 연결 채널">
          {([
            { value: "inbox", label: "자체 상담함만", desc: "관리자 화면에서 응대" },
            { value: "telegram", label: "Telegram", desc: telegramConnected ? "연결됨" : "연결 필요" },
            // Slack은 실제 워크스페이스 연동 테스트 전까지 선택할 수 없게 막아둡니다.
            { value: "slack", label: "Slack", desc: "준비 중", disabled: true },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={supportChannel === option.value}
              aria-disabled={"disabled" in option && option.disabled}
              disabled={"disabled" in option && option.disabled}
              title={"disabled" in option && option.disabled ? "Slack 연동은 준비 중입니다." : undefined}
              onClick={() => setSupportChannel(option.value)}
              className={`p-3 rounded-xl border-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${supportChannel === option.value ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}
            >
              <b className="block text-sm text-gray-900">{option.label}</b>
              <span className="block text-[11px] text-gray-500 mt-0.5">{option.desc}</span>
            </button>
          ))}
        </div>
        {((supportChannel === "telegram" && !telegramConnected) || (supportChannel === "slack" && !slackConnected)) && (
          <p className="text-xs rounded-lg px-3 py-2" style={{ backgroundColor: "#fffbeb", color: "#b45309" }}>
            ⚠ 아래에서 {supportChannel === "telegram" ? "Telegram" : "Slack"} 연결을 저장하기 전까지는 상담 요청이 자체 상담함으로만 접수됩니다.
          </p>
        )}
        <p className="text-[11px] text-gray-500">채널을 바꿔도 이미 진행 중인 상담은 원래 채널에서 이어집니다. 변경 후 아래 저장 버튼을 눌러주세요.</p>
        {supportChannel === "telegram" && <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
          <div><div className="flex items-center justify-between gap-3"><b className="text-sm text-gray-900">Telegram 연결</b><HelpButton content={TELEGRAM_GUIDE} label="연결 가이드" /></div><p className="text-xs text-gray-500 mt-1">토큰은 암호화되어 저장됩니다. ******** 는 저장된 토큰을 가린 표시이며, 그대로 두면 기존 토큰이 유지됩니다.</p></div>
          <input type="password" value={telegramToken} onFocus={selectMaskOnFocus} onChange={(e) => setTelegramToken(e.target.value)} placeholder="Bot Token" autoComplete="off" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <input type="text" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="슈퍼그룹 Chat ID (예: -1001234567890)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <div className="flex items-center justify-between gap-3"><span className={`text-xs ${telegramStatus.startsWith("✓") ? "text-green-600" : "text-gray-500"}`}>{telegramStatus}</span><button type="button" onClick={handleTelegramSave} disabled={telegramSaving || !telegramChatId} className="px-3 py-2 rounded-lg bg-sky-500 text-white text-xs font-medium disabled:opacity-40">{telegramSaving ? "연결 중..." : "연결 저장·테스트"}</button></div>
        </div>}
        {supportChannel === "slack" && <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
          <div><b className="text-sm text-gray-900">Slack 연결</b><p className="text-xs text-gray-500 mt-1">토큰과 Signing Secret은 암호화되어 저장됩니다. ******** 는 저장된 값을 가린 표시이며, 그대로 두면 기존 값이 유지됩니다.</p></div>
          <input type="password" value={slackToken} onFocus={selectMaskOnFocus} onChange={(e) => setSlackToken(e.target.value)} placeholder="Bot User OAuth Token (xoxb-...)" autoComplete="off" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <input type="password" value={slackSecret} onFocus={selectMaskOnFocus} onChange={(e) => setSlackSecret(e.target.value)} placeholder="Signing Secret" autoComplete="off" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <input type="text" value={slackChannelId} onChange={(e) => setSlackChannelId(e.target.value)} placeholder="Channel ID (예: C01ABCDEFGH)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <p className="text-[11px] text-gray-500 break-all">Slack App의 Event Subscriptions Request URL: <code className="bg-white px-1 py-0.5 rounded border border-gray-200">{origin}/api/integrations/slack/{bot.id}/events</code><br />필요 Bot Scope: chat:write, channels:join, users:read + 이벤트 구독 message.channels(또는 비공개 채널은 message.groups)</p>
          <div className="flex items-center justify-between gap-3"><span className={`text-xs ${slackStatus.startsWith("✓") ? "text-green-600" : "text-gray-500"}`}>{slackStatus}</span><button type="button" onClick={handleSlackSave} disabled={slackSaving || !slackChannelId} className="px-3 py-2 rounded-lg bg-violet-500 text-white text-xs font-medium disabled:opacity-40">{slackSaving ? "연결 중..." : "연결 저장·테스트"}</button></div>
        </div>}
        </div>}
      </div>

      {/* 위젯 커스터마이징 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-900">위젯 설정</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">챗봇 로고</label>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
              {logoUrl ? <img src={logoUrl} alt="챗봇 로고" className="w-full h-full object-contain" /> : <span className="text-xl">💬</span>}
            </div>
            <label className="px-3 py-2 rounded-lg bg-purple-50 text-purple-700 text-xs font-medium cursor-pointer hover:bg-purple-100">
              {logoUploading ? "업로드 중..." : "이미지 선택"}
              <input type="file" accept="image/*" className="hidden" disabled={logoUploading} onChange={handleLogoUpload} />
            </label>
          </div>
          <p className="text-xs text-gray-400 mt-1">PNG·JPG, 최대 2MB</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">위젯 제목</label>
            <input
              type="text"
              value={widgetTitle}
              onChange={(e) => setWidgetTitle(e.target.value)}
              placeholder={bot.name}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">비워두면 챗봇 이름 사용</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">테마 색상</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={widgetColor}
                onChange={(e) => setWidgetColor(e.target.value)}
                className="w-10 h-9 rounded border border-gray-300 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={widgetColor}
                onChange={(e) => setWidgetColor(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">인사말</label>
          <input
            type="text"
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            placeholder="안녕하세요! 무엇을 도와드릴까요?"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">위젯을 열면 처음 표시되는 메시지</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
        >
          {deleting ? "삭제 중..." : "챗봇 삭제"}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saved ? "✓ 저장됨" : saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}
