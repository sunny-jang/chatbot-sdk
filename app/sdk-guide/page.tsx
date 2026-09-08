import Link from "next/link";
import CopyButton from "@/app/bots/[id]/CopyButton";

const installCode = "npm install ideal-ai-chatbot-sdk";
const basicCode = `import { initIdealAIChatbot } from "ideal-ai-chatbot-sdk";

const chatbot = await initIdealAIChatbot({
  botId: "YOUR_BOT_ID",
  endpoint: "https://chatbot.sdk.eunseon.com",
});

// 위젯을 제거할 때
chatbot.destroy();`;
const reactCode = `"use client";

import { useEffect } from "react";
import { initIdealAIChatbot } from "ideal-ai-chatbot-sdk";

export function IdealAIChatbot() {
  useEffect(() => {
    let destroy: (() => void) | undefined;

    initIdealAIChatbot({
      botId: "YOUR_BOT_ID",
      endpoint: "https://chatbot.sdk.eunseon.com",
    }).then((instance) => {
      destroy = instance.destroy;
    });

    return () => destroy?.();
  }, []);

  return null;
}`;

function CodeBlock({ code, tone = "violet" }: { code: string; tone?: "violet" | "blue" }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-[#111827] shadow-[0_18px_50px_rgba(15,23,42,.12)]">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
        <i className="h-2 w-2 rounded-full bg-rose-400" />
        <i className="h-2 w-2 rounded-full bg-amber-300" />
        <i className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="ml-2 font-mono text-[10px] tracking-widest text-slate-500">IDEAL AI / SDK</span>
      </div>
      <pre className={`overflow-x-auto p-5 text-[12px] leading-6 ${tone === "blue" ? "text-sky-300" : "text-violet-300"}`}>
        {code}
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

const steps = [
  { number: "01", title: "패키지 설치", text: "고객사 프로젝트에 SDK를 추가합니다." },
  { number: "02", title: "챗봇 연결", text: "관리자 화면의 봇 ID와 운영 주소를 입력합니다." },
  { number: "03", title: "운영 확인", text: "우측 하단 위젯과 분석 대시보드 수집을 확인합니다." },
];

export default function SdkGuidePage() {
  return (
    <div className="mx-auto max-w-6xl pb-20 text-slate-900">
      <section className="relative overflow-hidden rounded-[28px] border border-violet-100 bg-white px-10 py-11 shadow-[0_24px_80px_rgba(76,29,149,.09)]">
        <div className="absolute -right-20 -top-32 h-80 w-80 rounded-full bg-[radial-gradient(circle,#c4b5fd_0%,#dbeafe_42%,transparent_70%)] opacity-60" />
        <div className="relative grid grid-cols-[1.08fr_.92fr] items-end gap-12">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-semibold tracking-[.16em] text-violet-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_#d1fae5]" />
              NPM v0.1.0 · PUBLIC
            </div>
            <p className="mb-3 font-mono text-xs font-semibold text-violet-600">IDEAL AI CHATBOT SDK</p>
            <h1 className="max-w-2xl text-[44px] font-bold leading-[1.08] tracking-[-.055em] text-[#17172f]">
              고객 사이트에 챗봇을<br />3분 안에 연결하세요.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-7 text-slate-500">
              React, Next.js, Vue 또는 일반 웹 프로젝트에서 동일한 SDK를 사용합니다.
              대화 내용과 사용량은 IDEAL AI 분석 대시보드에 자동으로 수집됩니다.
            </p>
          </div>
          <div className="relative">
            <CodeBlock code={installCode} />
            <div className="absolute -bottom-4 -left-5 rounded-xl border border-blue-100 bg-white px-4 py-3 shadow-lg">
              <span className="block text-[10px] font-semibold tracking-wider text-slate-400">INSTALL SIZE</span>
              <strong className="mt-1 block font-mono text-lg text-blue-600">2.8 KB</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white px-8 py-7">
        <div className="grid grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.number} className="relative flex gap-4 pr-8 last:pr-0">
              {index < steps.length - 1 && <span className="absolute left-8 top-4 h-px w-[calc(100%-20px)] bg-gradient-to-r from-violet-300 to-blue-200" />}
              <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#211d48] font-mono text-[10px] text-white">{step.number}</span>
              <div className="relative z-10 bg-white pr-4">
                <strong className="block text-sm">{step.title}</strong>
                <p className="mt-1 text-xs leading-5 text-slate-500">{step.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 grid grid-cols-[220px_1fr] gap-10" id="quick-start">
        <div>
          <span className="font-mono text-[11px] font-semibold text-violet-600">QUICK START</span>
          <h2 className="mt-2 text-2xl font-bold tracking-[-.04em]">기본 설치</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">봇 설정 화면에서 ID가 입력된 코드를 바로 복사할 수 있습니다.</p>
        </div>
        <div className="space-y-4">
          <CodeBlock code={installCode} />
          <CodeBlock code={basicCode} tone="blue" />
        </div>
      </section>

      <section className="mt-14 grid grid-cols-[220px_1fr] gap-10 border-t border-slate-200 pt-12" id="nextjs">
        <div>
          <span className="font-mono text-[11px] font-semibold text-blue-600">REACT / NEXT.JS</span>
          <h2 className="mt-2 text-2xl font-bold tracking-[-.04em]">컴포넌트 연결</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">클라이언트 컴포넌트에서 한 번 초기화하고 페이지 해제 시 위젯도 정리합니다.</p>
        </div>
        <CodeBlock code={reactCode} tone="blue" />
      </section>

      <section className="mt-14 grid grid-cols-3 gap-4 border-t border-slate-200 pt-12">
        {[
          ["botId", "필수", "관리자 화면에서 생성된 챗봇의 고유 ID"],
          ["endpoint", "필수", "IDEAL AI 운영 서버 주소"],
          ["scriptUrl", "선택", "위젯 파일을 별도 호스팅할 때 지정"],
        ].map(([name, required, description]) => (
          <article key={name} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <code className="text-sm font-semibold text-violet-700">{name}</code>
              <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{required}</span>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">{description}</p>
          </article>
        ))}
      </section>

      <section className="mt-12 flex items-center justify-between rounded-2xl bg-gradient-to-r from-[#211d48] to-[#303d75] px-7 py-6 text-white">
        <div>
          <p className="text-xs font-semibold text-violet-200">설치 후 확인</p>
          <h2 className="mt-1 text-xl font-bold">테스트 대화를 보내고 분석 수집을 확인하세요.</h2>
        </div>
        <div className="flex gap-3">
          <Link href="/analytics" className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#211d48]">분석 대시보드</Link>
          <a href="https://www.npmjs.com/package/ideal-ai-chatbot-sdk" target="_blank" rel="noreferrer" className="rounded-lg border border-white/25 px-4 py-2.5 text-sm font-semibold text-white">npm 패키지 ↗</a>
        </div>
      </section>
    </div>
  );
}
