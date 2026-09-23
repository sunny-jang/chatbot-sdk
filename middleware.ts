import { auth } from "@/auth";
import { NextResponse } from "next/server";

const TENANT_PUBLIC_PATHS = ["/", "/login", "/signup", "/demo", "/plan", "/brochure.html"];
const TENANT_PUBLIC_PREFIXES = ["/api/auth/", "/api/chat/", "/api/widget/", "/api/integrations/telegram/", "/api/integrations/slack/", "/api/tenants", "/api/guide"];

// 인증은 Auth.js 세션(req.auth) 하나만 신뢰합니다. tenant_id / is_admin 같은 일반 쿠키는 보지 않습니다.
export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (req.method === "OPTIONS" && (pathname.startsWith("/api/chat/") || pathname.startsWith("/api/widget/"))) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Bot-Token",
      },
    });
  }

  // Super-admin routes: 1차 확인만 하고, 각 관리자 API와 관리자 화면에서 DB로 다시 확인합니다.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (req.auth?.is_admin !== true) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next();
  }

  // Tenant public routes
  if (
    TENANT_PUBLIC_PATHS.includes(pathname) ||
    TENANT_PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  if (!req.auth?.tenant_id) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // 공개 폴더의 이미지(로그인 화면 로고 등)는 로그인 전에도 보여야 하므로 인증 검사에서 제외합니다.
    "/((?!_next/static|_next/image|favicon.ico|chatbot-widget.js|guide.html|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
