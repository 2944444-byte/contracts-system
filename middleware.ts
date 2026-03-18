import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // מסלולים ציבוריים — לא בודקים auth
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/"
  ) {
    return NextResponse.next();
  }

  // Supabase v2 cookie format: sb-{ref}-auth-token
  const cookies = req.cookies.getAll();
  const hasAuth = cookies.some(function(c) {
    return (
      c.name.includes("sb-") && c.name.includes("auth-token") ||
      c.name.includes("supabase-auth") ||
      c.name === "sb-access-token"
    );
  });

  if (!hasAuth) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
