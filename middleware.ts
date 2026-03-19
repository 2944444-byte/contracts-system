import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/login") || pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname === "/") {
    return NextResponse.next();
  }

  const allCookies = req.cookies.getAll();
  const hasAuth = allCookies.some(function(c) {
    return c.name.includes("sb-") || c.name.includes("supabase") || c.name.includes("auth");
  });

  if (!hasAuth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
