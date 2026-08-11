"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

type Bot = { id: string; name: string; type: "qa" | "ai" };

export default function DemoPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>("");
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    fetch("/api/bots")
      .then((r) => r.json())
      .then((data: Bot[]) => {
        setBots(data);
        if (data.length > 0) setSelectedBotId(data[0].id);
      });
  }, []);

  useEffect(() => {
    // 이전 위젯 제거
    const prev = document.getElementById("__chatbot-widget");
    if (prev) prev.remove();
    if (scriptRef.current) scriptRef.current.remove();

    if (!selectedBotId) return;

    const s = document.createElement("script");
    s.src = "/chatbot-widget.js";
    s.setAttribute("data-bot-id", selectedBotId);
    s.setAttribute("data-endpoint", window.location.origin);
    document.body.appendChild(s);
    scriptRef.current = s;
  }, [selectedBotId]);

  const selectedBot = bots.find((b) => b.id === selectedBotId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-white/10">
        <div className="flex items-center gap-2 font-bold text-lg">
          <span>🤖</span> Chatbot SDK
        </div>
        <div className="flex items-center gap-5 text-sm text-white/60">
          <Link href="/guide.html" className="hover:text-white transition-colors">가이드</Link>
          <Link href="/" className="hover:text-white transition-colors">관리자</Link>
          <a
            href="https://github.com/sunny-jang/chatbot-sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-white"
          >
            GitHub →
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center px-6 pt-20 pb-14">
        <div className="inline-block px-3 py-1 bg-blue-500/20 border border-blue-400/30 rounded-full text-blue-300 text-xs font-semibold mb-5 tracking-wide">
          OPEN SOURCE · SELF-HOSTED
        </div>
        <h1 className="text-5xl font-extrabold leading-tight mb-4 bg-gradient-to-r from-white to-blue-300 bg-clip-text text-transparent">
          script 태그 하나로<br />AI 챗봇을 붙이세요
        </h1>
        <p className="text-white/60 text-lg max-w-xl mx-auto mb-8">
          Q&A 봇부터 GPT 기반 AI 봇까지, 관리자 패널에서 만들고 한 줄로 임베드합니다.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl font-semibold text-sm transition-colors"
          >
            관리자 패널 열기
          </Link>
          <Link
            href="/guide.html"
            className="px-5 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl font-semibold text-sm transition-colors"
          >
            가이드 보기
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-4xl mx-auto px-6 pb-16 grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: "📚", title: "Q&A 봇", desc: "질문/답변 세트 등록 → OpenAI 임베딩으로 시맨틱 매칭" },
          { icon: "✨", title: "AI 봇", desc: "GPT 모델 + 시스템 프롬프트로 자유로운 대화" },
          { icon: "⚡", title: "한 줄 설치", desc: "script 태그 하나. PHP, 그누보드, 어디든 가능" },
        ].map((f) => (
          <div key={f.title} className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="text-3xl mb-3">{f.icon}</div>
            <div className="font-bold mb-1">{f.title}</div>
            <div className="text-sm text-white/50">{f.desc}</div>
          </div>
        ))}
      </section>

      {/* Live Demo */}
      <section className="max-w-3xl mx-auto px-6 pb-24">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold mb-2">🎮 라이브 데모</h2>
            <p className="text-white/50 text-sm">관리자에서 만든 봇을 선택해 지금 바로 대화해보세요</p>
          </div>

          {bots.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-white/40 text-sm mb-4">아직 생성된 봇이 없어요</p>
              <Link
                href="/bots/new"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
              >
                첫 봇 만들기 →
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <label className="text-sm text-white/60 whitespace-nowrap">봇 선택</label>
                <select
                  value={selectedBotId}
                  onChange={(e) => setSelectedBotId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-sm focus:outline-none focus:border-blue-400 text-white"
                >
                  {bots.map((b) => (
                    <option key={b.id} value={b.id} className="bg-slate-800">
                      {b.type === "qa" ? "📚" : "✨"} {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedBot && (
                <div className="mb-6 p-3 bg-white/5 rounded-xl text-xs text-white/40 font-mono">
                  <span className="text-blue-400">data-bot-id</span>=
                  <span className="text-green-400">"{selectedBot.id}"</span>
                  {"  "}
                  <span className="text-white/30">
                    [{selectedBot.type === "qa" ? "Q&A 봇" : "AI 봇"}]
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 p-4 bg-blue-500/10 border border-blue-400/20 rounded-xl text-sm text-blue-300">
                <span>💬</span>
                <span>우측 하단의 챗봇 버튼을 클릭해 대화를 시작하세요</span>
              </div>
            </>
          )}
        </div>

        {/* Embed code */}
        <div className="mt-6 bg-white/5 border border-white/10 rounded-2xl p-6">
          <h3 className="font-semibold mb-3 text-sm text-white/70">임베드 코드</h3>
          <div className="bg-black/40 rounded-xl p-4 font-mono text-xs text-green-400 leading-relaxed">
            &lt;script src="https://your-server.com/chatbot-widget.js"<br />
            {"        "}data-bot-id="<span className="text-yellow-300">{selectedBotId || "봇-ID"}</span>"<br />
            {"        "}data-endpoint="https://your-server.com"&gt;&lt;/script&gt;
          </div>
        </div>
      </section>
    </div>
  );
}
