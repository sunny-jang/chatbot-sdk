"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "@/lib/db";

export default function BotSettings({ bot }: { bot: Bot }) {
  const router = useRouter();
  const [name, setName] = useState(bot.name);
  const [systemPrompt, setSystemPrompt] = useState(bot.system_prompt ?? "");
  const [model, setModel] = useState(bot.model);
  const [widgetTitle, setWidgetTitle] = useState(bot.widget_title ?? "");
  const [widgetColor, setWidgetColor] = useState(bot.widget_color ?? "#2563eb");
  const [greeting, setGreeting] = useState(bot.greeting_message ?? "");
  const [supportMode, setSupportMode] = useState<"unattended" | "hybrid">(bot.support_mode ?? "unattended");
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
    setOrigin(window.location.origin);
    fetch(`/api/bots/${bot.id}/integrations/telegram`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.chat_id) setTelegramChatId(data.chat_id);
        if (data?.connected) setTelegramStatus("연결 정보가 저장되어 있습니다.");
      })
      .catch(() => null);
    fetch(`/api/bots/${bot.id}/integrations/slack`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.channel_id) setSlackChannelId(data.channel_id);
        if (data?.connected) setSlackStatus("연결 정보가 저장되어 있습니다.");
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
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  async function handleTelegramSave() {
    setTelegramSaving(true);
    setTelegramStatus("");
    try {
      const res = await fetch(`/api/bots/${bot.id}/integrations/telegram`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_token: telegramToken || undefined, chat_id: telegramChatId, enabled: true }),
      });
      const data = await res.json();
      setTelegramStatus(res.ok ? `✓ Telegram 연결 완료${data.botUsername ? ` (@${data.botUsername})` : ""}` : data.error || "연결에 실패했습니다.");
      if (res.ok) setTelegramToken("");
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
        body: JSON.stringify({ bot_token: slackToken || undefined, signing_secret: slackSecret || undefined, channel_id: slackChannelId, enabled: true }),
      });
      const data = await res.json();
      setSlackStatus(res.ok ? `✓ Slack 연결 완료${data.teamName ? ` (${data.teamName})` : ""}` : data.error || "연결에 실패했습니다.");
      if (res.ok) { setSlackToken(""); setSlackSecret(""); }
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
        <div><b className="text-sm text-gray-900">상담원 연결 채널</b><p className="text-xs text-gray-500 mt-1">자체 상담함은 항상 사용되며, 아래 채널을 연결하면 상담 건이 동시에 전달됩니다.</p></div>
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
          <div><b className="text-sm text-gray-900">Telegram 연결</b><p className="text-xs text-gray-500 mt-1">토큰은 암호화되어 저장되며 화면에 다시 표시되지 않습니다.</p></div>
          <input type="password" value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} placeholder="Bot Token (기존 토큰 유지 시 비워두기)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <input type="text" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="슈퍼그룹 Chat ID (예: -1001234567890)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <div className="flex items-center justify-between gap-3"><span className={`text-xs ${telegramStatus.startsWith("✓") ? "text-green-600" : "text-gray-500"}`}>{telegramStatus}</span><button type="button" onClick={handleTelegramSave} disabled={telegramSaving || !telegramChatId} className="px-3 py-2 rounded-lg bg-sky-500 text-white text-xs font-medium disabled:opacity-40">{telegramSaving ? "연결 중..." : "연결 저장·테스트"}</button></div>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
          <div><b className="text-sm text-gray-900">Slack 연결</b><p className="text-xs text-gray-500 mt-1">토큰과 Signing Secret은 암호화되어 저장되며 화면에 다시 표시되지 않습니다.</p></div>
          <input type="password" value={slackToken} onChange={(e) => setSlackToken(e.target.value)} placeholder="Bot User OAuth Token (xoxb-...) · 기존 값 유지 시 비워두기" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <input type="password" value={slackSecret} onChange={(e) => setSlackSecret(e.target.value)} placeholder="Signing Secret (기존 값 유지 시 비워두기)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <input type="text" value={slackChannelId} onChange={(e) => setSlackChannelId(e.target.value)} placeholder="Channel ID (예: C01ABCDEFGH)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <p className="text-[11px] text-gray-500 break-all">Slack App의 Event Subscriptions Request URL: <code className="bg-white px-1 py-0.5 rounded border border-gray-200">{origin}/api/integrations/slack/{bot.id}/events</code><br />필요 Bot Scope: chat:write, channels:join, users:read + 이벤트 구독 message.channels(또는 비공개 채널은 message.groups)</p>
          <div className="flex items-center justify-between gap-3"><span className={`text-xs ${slackStatus.startsWith("✓") ? "text-green-600" : "text-gray-500"}`}>{slackStatus}</span><button type="button" onClick={handleSlackSave} disabled={slackSaving || !slackChannelId} className="px-3 py-2 rounded-lg bg-violet-500 text-white text-xs font-medium disabled:opacity-40">{slackSaving ? "연결 중..." : "연결 저장·테스트"}</button></div>
        </div>
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
