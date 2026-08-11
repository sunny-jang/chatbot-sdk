import { NextRequest, NextResponse } from "next/server";

const TENANT_PUBLIC_PATHS = ["/login", "/demo"];
const TENANT_PUBLIC_PREFIXES = ["/api/auth/", "/api/chat/", "/api/tenants"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Super-admin routes: /admin/* and /api/admin/*
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (pathname === "/admin/login" || pathname === "/api/admin/login" || pathname === "/api/admin/logout") {
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

  // Tenant protected routes
  const tenantId = req.cookies.get("tenant_id")?.value;
  if (!tenantId) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|chatbot-widget.js|guide.html).*)",
  ],
};
