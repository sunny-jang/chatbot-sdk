"use client";
import { useEffect, useState } from "react";
import type { WidgetTheme } from "@/lib/widget-presentation";
const escapeAttribute = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
/** 저장 전 값. 위젯이 저장값 위에 덮어 보여주며, 위젯 쪽에서 같은 규칙으로 다시 거릅니다. */
export type WidgetPreviewSettings = {
  title?: string | null;
  color?: string | null;
  greeting?: string | null;
  theme?: WidgetTheme | null;
};
export default function WidgetPreview({
  botId,
  botToken,
  presentation,
  heading = "실제 위젯 미리보기",
}: {
  botId: string;
  botToken: string;
  presentation?: WidgetPreviewSettings;
  heading?: string;
}) {
  const [opened, setOpened] = useState(false),
    [mobile, setMobile] = useState(false),
    [source, setSource] = useState("");
  const overrides = presentation
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(presentation).filter(
            ([, value]) => value !== undefined && value !== null && value !== "",
          ),
        ),
      )
    : "";
  const left = presentation?.theme?.position === "left";
  useEffect(() => {
    if (!opened) return;
    // 색상 선택처럼 연속으로 바뀌는 입력은 잠시 모았다가 한 번만 다시 그립니다.
    const timer = setTimeout(() => {
      const endpoint = window.location.origin;
      setSource(
        `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>챗봇 위젯 미리보기</title><body style="background:#f4f5f8;font-family:system-ui;padding:24px"><h2 style="font-size:18px">챗봇 위젯 미리보기</h2><p style="font-size:13px;color:#5c6675">${left ? "왼쪽" : "오른쪽"} 아래 채팅 버튼을 열어 확인하세요.</p><script src="${escapeAttribute(endpoint)}/chatbot-widget.js" data-bot-id="${escapeAttribute(botId)}" data-bot-token="${escapeAttribute(botToken)}" data-endpoint="${escapeAttribute(endpoint)}"${overrides ? ` data-preview-settings="${escapeAttribute(overrides)}"` : ""}></script></body></html>`,
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [opened, botId, botToken, overrides, left]);
  return (
    <section className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="font-bold text-lg">{heading}</h2>
      <p className="text-sm text-gray-500 mt-2">
        {presentation
          ? "저장 전 디자인이 바로 반영됩니다. 고객 홈페이지에는 저장한 뒤 적용됩니다. "
          : ""}
        Q&A·상담 연결·견적 신청 버튼을 실제 위젯에서 확인하세요. 테스트 대화와
        신청도 저장되며, 연결된 상담 채널로 알림이 전송될 수 있습니다.
      </p>
      <div className="flex gap-2 my-4">
        <button
          type="button"
          onClick={() => {
            if (opened) setSource("");
            setOpened(!opened);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm"
        >
          {opened ? "미리보기 닫기" : "위젯 미리보기 열기"}
        </button>
        {opened && (
          <button
            type="button"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? "넓은 화면" : "모바일 너비"}
          </button>
        )}
      </div>
      {opened && source && (
        <div
          className="mx-auto border border-gray-200 rounded-xl overflow-hidden"
          style={{ maxWidth: mobile ? 375 : "100%" }}
        >
          <iframe
            title="실제 챗봇 위젯 미리보기"
            srcDoc={source}
            className="w-full border-0"
            style={{ height: 740 }}
          />
        </div>
      )}
    </section>
  );
}
