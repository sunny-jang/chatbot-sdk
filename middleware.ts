import { auth } from "@/auth";
import { NextResponse } from "next/server";
import {
  isCustomerPortalHost,
  customerHostPath,
} from "@/lib/customer-portal/host";

const TENANT_PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/demo",
  "/plan",
  "/brochure.html",
  "/customer/login",
];
const TENANT_PUBLIC_PREFIXES = [
  "/api/cron/",
  "/api/auth/",
  "/api/chat/",
  "/api/widget/",
  "/api/external/",
  "/api/integrations/telegram/",
  "/api/integrations/slack/",
  "/api/tenants",
  "/api/guide",
  "/api/demo/",
];

// 인증은 Auth.js 세션(req.auth) 하나만 신뢰합니다. tenant_id / is_admin 같은 일반 쿠키는 보지 않습니다.
export default auth((req) => {
  const onCustomerHost = isCustomerPortalHost(
    req.headers.get("host") || req.nextUrl.host,
  );
  const originalPath = req.nextUrl.pathname;
  const pathname = onCustomerHost
    ? customerHostPath(originalPath)
    : originalPath;
  const next = () => {
    if (pathname === originalPath) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = pathname;
    return NextResponse.rewrite(url);
  };
  // Shared demo capabilities are public on either entry host; their APIs validate expiry and revocation themselves.
  if (pathname.startsWith("/demo/") || pathname.startsWith("/api/demo/"))
    return next();
  if (
    onCustomerHost &&
    !(
      pathname === "/customer" ||
      pathname.startsWith("/customer/") ||
      pathname.startsWith("/api/customer/") ||
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/chat/") ||
      pathname.startsWith("/api/widget/")
    )
  ) {
    if (pathname.startsWith("/api/"))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.redirect(new URL("/customer", req.url));
  }

  if (
    req.method === "OPTIONS" &&
    (pathname.startsWith("/api/chat/") || pathname.startsWith("/api/widget/"))
  ) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Bot-Token",
      },
    });
  }

  // Customer identities never inherit an agency tenant or enter its private routes.
  if (
    pathname === "/customer" ||
    pathname.startsWith("/customer/") ||
    pathname.startsWith("/api/customer/")
  ) {
    if (
      pathname === "/customer/login" ||
      pathname === "/customer/forgot-password" ||
      pathname.startsWith("/customer/reset-password/") ||
      pathname.startsWith("/api/customer/password-reset") ||
      pathname.startsWith("/customer/activate/") ||
      pathname.startsWith("/customer/invite/") ||
      pathname.startsWith("/api/customer/activate/") ||
      pathname.startsWith("/api/customer/invitations/")
    )
      return next();
    if (!req.auth?.customer_user_id && !req.auth?.tenant_id) {
      if (pathname.startsWith("/api/"))
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      return NextResponse.redirect(new URL("/customer/login", req.url));
    }
    return next();
  }
  if (req.auth?.customer_user_id) {
    if (
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/chat/") ||
      pathname.startsWith("/api/widget/")
    )
      return next();
    if (pathname.startsWith("/api/"))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.redirect(new URL("/customer", req.url));
  }

  // Super-admin routes: 1차 확인만 하고, 각 관리자 API와 관리자 화면에서 DB로 다시 확인합니다.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (req.auth?.is_admin !== true) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return next();
  }

  // Tenant public routes
  if (
    pathname.startsWith("/demo/") ||
    TENANT_PUBLIC_PATHS.includes(pathname) ||
    TENANT_PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    return next();
  }

  if (!req.auth?.tenant_id) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return next();
});

export const config = {
  matcher: [
    // 공개 폴더의 이미지(로그인 화면 로고 등)는 로그인 전에도 보여야 하므로 인증 검사에서 제외합니다.
    "/((?!_next/static|_next/image|favicon.ico|chatbot-widget.js|guide.html|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
