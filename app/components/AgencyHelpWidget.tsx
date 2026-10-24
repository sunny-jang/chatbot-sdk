"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// 파트너 에이전시 워크스페이스에 설치되는 안내 챗봇.
// 환경별로 다른 봇이므로 NEXT_PUBLIC_AGENCY_HELP_BOT_ID / _TOKEN이 없으면 설치하지 않습니다.
const BOT_ID = process.env.NEXT_PUBLIC_AGENCY_HELP_BOT_ID || "";
const BOT_TOKEN = process.env.NEXT_PUBLIC_AGENCY_HELP_BOT_TOKEN || "";

function excluded(path: string) {
  // 데모·고객사 데스크 화면은 자기 위젯을 띄우므로 겹치지 않게 뺍니다.
  return (
    path === "/demo" ||
    path.startsWith("/demo/") ||
    path === "/customer" ||
    path.startsWith("/customer/")
  );
}

export default function AgencyHelpWidget() {
  const path = usePathname();
  const active = !!BOT_ID && !!BOT_TOKEN && !excluded(path);
  useEffect(() => {
    if (!active || document.getElementById("__agency-help-widget")) return;
    // 위젯은 document.currentScript의 data-* 속성을 읽으므로 실제 <script>로 넣습니다.
    const s = document.createElement("script");
    s.id = "__agency-help-widget";
    s.src = "/chatbot-widget.js";
    s.async = true;
    s.dataset.botId = BOT_ID;
    s.dataset.botToken = BOT_TOKEN;
    s.dataset.endpoint = window.location.origin;
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.getElementById("__chatbot-widget")?.remove();
      document.getElementById("__chatbot-widget-style")?.remove();
    };
  }, [active]);
  return null;
}
