import { auth } from "@/auth";
import { NextResponse } from "next/server";

const TENANT_PUBLIC_PATHS = ["/login", "/signup", "/demo", "/plan"];
const TENANT_PUBLIC_PREFIXES = ["/api/auth/", "/api/chat/", "/api/widget/", "/api/tenants", "/api/guide"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Super-admin routes
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const isAdminCookie = req.cookies.get("is_admin")?.value === "1";
    const isAdminSession = req.auth?.is_admin === true;
    if (!isAdminCookie && !isAdminSession) {
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

  // Tenant auth: cookie(이메일/비밀번호) or Auth.js session(OAuth)
  const cookieTenantId = req.cookies.get("tenant_id")?.value;
  const sessionTenantId = req.auth?.tenant_id ?? null;
  const tenantId = cookieTenantId || sessionTenantId;

  if (!tenantId) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // OAuth 로그인 후 쿠키가 없으면 세션에서 동기화
  if (!cookieTenantId && sessionTenantId) {
    const res = NextResponse.next();
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    };
    res.cookies.set("tenant_id", sessionTenantId, cookieOpts);
    if (req.auth?.is_admin) {
      res.cookies.set("is_admin", "1", cookieOpts);
    }
    return res;
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|chatbot-widget.js|guide.html).*)",
  ],
};
