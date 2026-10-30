"use client";
import { useEffect, useRef, useState } from "react";
import { demoBackgroundBlocked } from "@/lib/demo/background-rules";
/**
 * 서버(Node)와 브라우저의 ko-KR 날짜 표기가 달라("AM"/"오전") 하이드레이션이 어긋나므로
 * 한국 시간(UTC+9, 서머타임 없음)으로 직접 만듭니다.
 */
function seoulDateTime(epochSeconds: number) {
  const d = new Date((epochSeconds + 9 * 3600) * 1000),
    pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}. ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export default function DemoSite({
  token,
  botId,
  siteUrl,
  customerName,
  botName,
  expiresAt,
  backgroundUrl,
}: {
  token: string;
  botId: string;
  siteUrl: string;
  customerName: string;
  botName: string;
  expiresAt: number;
  backgroundUrl: string | null;
}) {
  // 배경 우선순위: 에이전시가 올린 홈페이지 캡처 → 실제 홈페이지(iframe) → 대체 화면.
  // http:// 홈페이지는 HTTPS 데모 안에서 브라우저가 막으므로 iframe을 건너뜁니다.
  const insecureSite = demoBackgroundBlocked(siteUrl);
  const [view, setView] = useState<"shot" | "frame" | "fallback">(
      backgroundUrl ? "shot" : insecureSite ? "fallback" : "frame",
    ),
    [frameReady, setFrameReady] = useState(false),
    [hintVisible, setHintVisible] = useState(true);
  // 안내 상자는 홈페이지 메뉴를 가리므로 불러온 뒤 잠시만 보여줍니다. 상단 버튼은 계속 남습니다.
  useEffect(() => {
    if (!frameReady) return;
    const timer = setTimeout(() => setHintVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [frameReady]);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "/chatbot-widget.js";
    script.setAttribute("data-bot-id", botId);
    script.setAttribute("data-bot-token", token);
    script.setAttribute(
      "data-endpoint",
      `${location.origin}/api/demo/${token}`,
    );
    document.body.appendChild(script);
    scriptRef.current = script;
    return () => {
      script.remove();
      const root = document.getElementById("__chatbot-widget") as
        (HTMLElement & { cleanupProactive?: () => void }) | null;
      root?.cleanupProactive?.();
      root?.remove();
      document.getElementById("__chatbot-widget-style")?.remove();
    };
  }, [token, botId]);
  return (
    <main className="site-demo">
      <header className="site-demo-bar">
        <div>
          <strong>{customerName} · 챗봇 데모</strong>
          <p>
            체험용 화면입니다. 실제 상담원 연결·접수 알림은 전송하지 않습니다.
          </p>
        </div>
        <div className="site-demo-actions">
          <a href={siteUrl} target="_blank" rel="noopener noreferrer">
            원본 홈페이지
          </a>
          {!insecureSite &&
            (backgroundUrl ? (
              <button
                onClick={() => setView((v) => (v === "shot" ? "frame" : "shot"))}
              >
                {view === "shot" ? "실제 홈페이지로 보기" : "캡처 화면으로 보기"}
              </button>
            ) : (
              <button
                onClick={() =>
                  setView((v) => (v === "fallback" ? "frame" : "fallback"))
                }
              >
                {view === "fallback"
                  ? "홈페이지 배경 보기"
                  : "배경이 안 보이면 대체 화면"}
              </button>
            ))}
        </div>
      </header>
      <p className="site-demo-note">
        오른쪽 아래 챗봇을 열어보세요.{" "}
        {seoulDateTime(expiresAt)}
        까지 · 홈페이지 내부 스크롤·클릭 행동 분석은 실제 설치 후 동작합니다.
      </p>
      {view === "shot" && backgroundUrl ? (
        <section className="site-demo-shot">
          <p>
            {customerName} 홈페이지 캡처 화면입니다. 배경 안의 링크·메뉴는
            동작하지 않습니다.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- 데모 토큰으로 보호된 동적 이미지 */}
          <img src={backgroundUrl} alt={`${customerName} 홈페이지 화면`} />
        </section>
      ) : view === "fallback" ? (
        <section className="site-demo-fallback">
          <span>홈페이지 대체 미리보기</span>
          <h1>{customerName}</h1>
          <p>{new URL(siteUrl).hostname}</p>
          <div>
            <h2>{botName}을 체험해보세요</h2>
            <p>
              {insecureSite
                ? "이 홈페이지는 보안 연결(HTTPS)을 지원하지 않아 브라우저가 데모 배경으로 표시하지 않습니다. 이 화면에서 같은 챗봇을 사용할 수 있으며, 배경은 원본 홈페이지 화면이 아닙니다. 원본은 상단의 '원본 홈페이지'에서 확인하세요."
                : "실제 홈페이지가 외부 표시를 차단하는 경우 이 화면에서 같은 챗봇을 사용할 수 있습니다. 이 배경은 원본 홈페이지 화면이 아닙니다."}
            </p>
          </div>
        </section>
      ) : (
        <div className="site-demo-frame">
          <iframe
            src={siteUrl}
            title={`${customerName} 홈페이지 배경`}
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerPolicy="no-referrer"
            onLoad={() => setFrameReady(true)}
          />
          {/* Browsers do not report X-Frame-Options/CSP blocks, so a short cue appears after load. */}
          {hintVisible && (
            <p className="site-demo-frame-hint" role="status">
              {frameReady
                ? "배경이 비어 보이면 상단의 대체 화면을 선택해주세요."
                : "홈페이지 배경을 불러오는 중입니다."}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
