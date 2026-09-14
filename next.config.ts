import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "mammoth"],
  // 로컬 개발 중 Telegram/Slack 웹훅 테스트용 임시 터널(ngrok, cloudflared) 주소를 허용합니다.
  allowedDevOrigins: ["127.0.0.1", "*.ngrok-free.dev", "*.ngrok-free.app", "*.trycloudflare.com"],
  async headers() {
    const cors = [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
      { key: "Access-Control-Allow-Headers", value: "Content-Type, X-Bot-Token" },
    ];
    return [
      { source: "/api/chat/:path*", headers: cors },
      { source: "/api/widget/:path*", headers: cors },
      { source: "/chatbot-widget.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    ];
  },
};

export default nextConfig;
