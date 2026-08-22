"use client";

import { useState } from "react";

export type HelpContent = {
  title: string;
  sections: { heading: string; items: string[] }[];
};

export default function HelpButton({ content }: { content: HelpContent }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
        style={{ backgroundColor: "#ede9ff", color: "#6949f4", fontWeight: 500 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#ddd6fe"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#ede9ff"; }}
      >
        <span style={{ fontSize: 13 }}>?</span>
        이 화면 사용방법 보기
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl overflow-hidden"
            style={{ backgroundColor: "#fff", boxShadow: "0 20px 60px rgba(105,73,244,0.18)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#e8e6ff" }}>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 18 }}>📖</span>
                <h2 className="font-bold text-base" style={{ color: "#1a1040" }}>{content.title}</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-lg leading-none transition-colors"
                style={{ color: "#b8aee0" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#6949f4"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#b8aee0"; }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
              {content.sections.map((section, i) => (
                <div key={i}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#6949f4" }}>
                    {section.heading}
                  </h3>
                  <ul className="space-y-2">
                    {section.items.map((item, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm" style={{ color: "#3d2b6b" }}>
                        <span className="mt-0.5 shrink-0" style={{ color: "#a78bfa" }}>•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t" style={{ borderColor: "#e8e6ff" }}>
              <button
                onClick={() => setOpen(false)}
                className="w-full py-2 text-sm font-medium rounded-lg text-white transition-colors"
                style={{ backgroundColor: "#6949f4" }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
