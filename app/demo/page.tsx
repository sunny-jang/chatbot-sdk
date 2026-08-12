"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const DEMO_BOT_ID = process.env.NEXT_PUBLIC_DEMO_BOT_ID;

export default function DemoPage() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [widgetReady, setWidgetReady] = useState(false);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    if (!DEMO_BOT_ID) return;

    const prev = document.getElementById("__chatbot-widget");
    if (prev) prev.remove();
    if (scriptRef.current) scriptRef.current.remove();

    const s = document.createElement("script");
    s.src = "/chatbot-widget.js";
    s.setAttribute("data-bot-id", DEMO_BOT_ID);
    s.setAttribute("data-endpoint", window.location.origin);
    s.onload = () => setWidgetReady(true);
    document.body.appendChild(s);
    scriptRef.current = s;

    return () => {
      const widget = document.getElementById("__chatbot-widget");
      if (widget) widget.remove();
      scriptRef.current?.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-slate-800 border border-white/10 rounded-2xl p-8 w-full max-w-sm mx-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-3xl mb-3">🔑</div>
            <h3 className="text-xl font-bold mb-2">시작하기</h3>
            <p className="text-white/50 text-sm mb-8">발급받은 액세스 키가 있으신가요?</p>
            <div className="space-y-3">
              <button
                onClick={() => router.push("/login")}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-semibold text-sm transition-colors"
              >
                네, 키가 있어요 →
              </button>
              <button
                onClick={() => router.push("/plan")}
                className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl font-semibold text-sm transition-colors text-white/80"
              >
                아니요, 플랜 보기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-white/10">
        <Link href="/demo" className="flex items-center gap-2.5">
          <div style={{
            display: "grid", placeItems: "center", color: "white",
            width: "34px", height: "34px", borderRadius: "10px 10px 6px 6px",
            fontSize: "13px", fontWeight: 800, letterSpacing: "-1px",
            transform: "skew(-6deg)",
            background: "linear-gradient(145deg, #f054c1, #6949f4 64%, #2f7bf4)",
            flexShrink: 0,
          }}>iA</div>
          <span className="font-bold text-lg">
            <span className="text-white">Ideal </span>
            <span style={{ color: "#6949f4" }}>AI</span>
          </span>
        </Link>
        <div className="flex items-center gap-5 text-sm text-white/60">
          <Link href="/guide.html" className="hover:text-white transition-colors">가이드</Link>
          <Link href="/login" className="hover:text-white transition-colors">관리자</Link>
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
            <p className="text-white/50 text-sm">지금 바로 AI 챗봇과 대화해보세요</p>
          </div>

          {DEMO_BOT_ID ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 bg-blue-500/10 border border-blue-400/20 rounded-xl text-sm text-blue-300">
                <span className={`w-2 h-2 rounded-full ${widgetReady ? "bg-green-400" : "bg-yellow-400 animate-pulse"}`} />
                <span>
                  {widgetReady
                    ? "챗봇이 준비됐어요! 우측 하단 버튼을 클릭해 대화를 시작하세요 💬"
                    : "챗봇 로딩 중..."}
                </span>
              </div>
              <div className="text-center pt-2">
                <button
                  onClick={() => setShowModal(true)}
                  className="px-8 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-900/40"
                >
                  나도 만들고 싶어요 →
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-white/40 text-sm mb-4">
                데모 봇을 설정하려면 <code className="text-blue-400 bg-white/5 px-1.5 py-0.5 rounded">NEXT_PUBLIC_DEMO_BOT_ID</code> 환경변수를 설정하세요
              </p>
              <button
                onClick={() => setShowModal(true)}
                className="px-8 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-900/40"
              >
                시작하기 →
              </button>
            </div>
          )}
        </div>

        {/* Embed code */}
        <div className="mt-6 bg-white/5 border border-white/10 rounded-2xl p-6">
          <h3 className="font-semibold mb-3 text-sm text-white/70">임베드 코드</h3>
          <div className="bg-black/40 rounded-xl p-4 font-mono text-xs text-green-400 leading-relaxed">
            &lt;script src="https://your-server.com/chatbot-widget.js"<br />
            {"        "}data-bot-id="<span className="text-yellow-300">{DEMO_BOT_ID || "봇-ID"}</span>"<br />
            {"        "}data-endpoint="https://your-server.com"&gt;&lt;/script&gt;
          </div>
        </div>
      </section>
    </div>
  );
}
