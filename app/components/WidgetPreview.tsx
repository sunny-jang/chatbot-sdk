"use client";
import { useState } from "react";
const escapeAttribute = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
export default function WidgetPreview({
  botId,
  botToken,
}: {
  botId: string;
  botToken: string;
}) {
  const [source, setSource] = useState(""),
    [mobile, setMobile] = useState(false);
  function open() {
    const endpoint = window.location.origin;
    setSource(
      `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>챗봇 위젯 미리보기</title><body style="background:#f8f7ff;font-family:system-ui;padding:24px"><h2 style="font-size:18px">챗봇 위젯 미리보기</h2><p style="font-size:13px;color:#6b7280">오른쪽 아래 채팅 버튼을 열어 확인하세요.</p><script src="${escapeAttribute(endpoint)}/chatbot-widget.js" data-bot-id="${escapeAttribute(botId)}" data-bot-token="${escapeAttribute(botToken)}" data-endpoint="${escapeAttribute(endpoint)}"></script></body></html>`,
    );
  }
  return (
    <section className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="font-bold text-lg">실제 위젯 미리보기</h2>
      <p className="text-sm text-gray-500 mt-2">
        Q&A·상담 연결·견적 신청 버튼을 실제 위젯에서 확인하세요. 테스트 대화와
        신청도 저장되며, 연결된 상담 채널로 알림이 전송될 수 있습니다.
      </p>
      <div className="flex gap-2 my-4">
        <button
          onClick={source ? () => setSource("") : open}
          className="bg-violet-600 text-white rounded-lg px-4 py-2 text-sm"
        >
          {source ? "미리보기 닫기" : "위젯 미리보기 열기"}
        </button>
        {source && (
          <button
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? "넓은 화면" : "모바일 너비"}
          </button>
        )}
      </div>
      {source && (
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
