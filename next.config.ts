import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "mammoth"],
  // 로컬 개발 중 Telegram/Slack 웹훅 테스트용 임시 터널(ngrok, cloudflared) 주소를 허용합니다.
  allowedDevOrigins: ["127.0.0.1", "*.ngrok-free.dev", "*.ngrok-free.app", "*.trycloudflare.com"],
  async headers() {
    // /api/chat/*, /api/widget/*의 CORS는 봇별 허용 출처를 보는 lib/widget-origin.ts가 응답마다 붙입니다.
    return [
      { source: "/chatbot-widget.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    ];
  },
};

export default nextConfig;
