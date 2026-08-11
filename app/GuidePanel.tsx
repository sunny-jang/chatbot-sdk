"use client";

import { useEffect, useRef, useState } from "react";

const SECTIONS = [
  { label: "서비스 개요", id: "overview" },
  { label: "봇 만들기", id: "create-bot" },
  { label: "Q&A 봇", id: "qa-bot" },
  { label: "AI 봇 & 문서", id: "ai-bot" },
  { label: "위젯 임베드", id: "embed" },
  { label: "그누보드", id: "gnuboard" },
  { label: "Cafe24", id: "cafe24" },
  { label: "웹뷰", id: "webview" },
  { label: "서버 설치", id: "quickstart" },
  { label: "환경변수", id: "env" },
  { label: "채팅 API", id: "api" },
  { label: "RAG 검색", id: "rag" },
  { label: "데이터베이스", id: "db" },
  { label: "폴더 구조", id: "structure" },
];

export default function GuidePanel({
  section,
  onClose,
}: {
  section: string | null;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (section) {
      setVisible(true);
      setActive(section);
    }
  }, [section]);

  // Send scroll message to iframe whenever active section changes
  useEffect(() => {
    if (!active || !iframeRef.current) return;
    const send = () => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "scrollTo", id: active },
        "*"
      );
    };
    // Try immediately, then again after iframe loads
    send();
    const t = setTimeout(send, 400);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!section) return null;

  return (
    <>
      {/* Backdrop — starts after sidebar (w-56 = 224px) */}
      <div
        className="fixed top-0 right-0 bottom-0 z-40"
        style={{
          left: "224px",
          backgroundColor: "rgba(0,0,0,0.18)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.25s",
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col bg-white shadow-2xl"
        style={{
          width: "700px",
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0"
          style={{ borderColor: "#e8e6ff", backgroundColor: "#f8f7ff" }}
        >
          <div className="flex items-center gap-2">
            <span>📖</span>
            <span className="font-semibold text-sm" style={{ color: "#2d1b69" }}>
              개발자 가이드
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        {/* Section tabs */}
        <div
          className="flex gap-1 px-4 py-2 border-b overflow-x-auto shrink-0 flex-nowrap"
          style={{ borderColor: "#f0eeff" }}
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className="px-2.5 py-1 text-xs rounded-full whitespace-nowrap shrink-0 transition-colors"
              style={
                active === s.id
                  ? { backgroundColor: "#ede9ff", color: "#6d28d9", fontWeight: 600 }
                  : { color: "#7c6aaa" }
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Iframe — fully isolated CSS */}
        <iframe
          ref={iframeRef}
          src="/api/guide"
          className="flex-1 w-full border-0"
          title="개발자 가이드"
          onLoad={() => {
            if (active) {
              iframeRef.current?.contentWindow?.postMessage(
                { type: "scrollTo", id: active },
                "*"
              );
            }
          }}
        />
      </div>
    </>
  );
}
