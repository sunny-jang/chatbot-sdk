import { auth } from "@/auth";
import { NextResponse } from "next/server";

const TENANT_PUBLIC_PATHS = ["/login", "/signup", "/demo", "/plan"];
const TENANT_PUBLIC_PREFIXES = ["/api/auth/", "/api/chat/", "/api/widget/", "/api/tenants", "/api/guide"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Super-admin routes
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (
      pathname === "/admin/login" ||
      pathname === "/api/admin/login" ||
      pathname === "/api/admin/logout"
    ) {
      return NextResponse.next();
    }
    const masterSession = req.cookies.get("master_session")?.value;
    if (!masterSession) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/admin/login", req.url));
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

  // OAuth 로그인 후 tenant_id 쿠키가 없으면 세션에서 동기화
  if (!cookieTenantId && sessionTenantId) {
    const res = NextResponse.next();
    res.cookies.set("tenant_id", sessionTenantId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    return res;
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|chatbot-widget.js|guide.html).*)",
  ],
};
