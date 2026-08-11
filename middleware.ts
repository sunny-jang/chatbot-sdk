import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/demo"];
const PUBLIC_PREFIXES = ["/api/auth/", "/api/chat/", "/api/tenants"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

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
