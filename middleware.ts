import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // דפים ציבוריים - תמיד מאפשר
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/"
  ) {
    return NextResponse.next();
  }

  // בדוק cookies - Supabase v2 cookie name: sb-{project_ref}-auth-token
  const PROJECT_REF = "ndvcqgrpsqykhodiyrhx";
  const cookies = req.cookies.getAll();
  
  const hasAuth = cookies.some(function(c) {
    return (
      c.name === `sb-${PROJECT_REF}-auth-token` ||
      c.name === `sb-${PROJECT_REF}-auth-token.0` ||
      c.name === `sb-${PROJECT_REF}-auth-token.1` ||
      c.name.startsWith(`sb-${PROJECT_REF}`) ||
      c.name.startsWith("sb-") ||
      c.name.includes("auth-token")
    );
  });

  if (!hasAuth) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)" ],
};
