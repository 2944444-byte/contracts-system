import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // מסלולים ציבוריים
  const publicPaths = ["/login", "/api/", "/_next/", "/favicon", "/robots"];
  if (publicPaths.some(function(p){return pathname.startsWith(p);})) {
    return NextResponse.next();
  }

  // בדיקת auth cookie
  const cookieNames = req.cookies.getAll().map(function(c){return c.name;});
  const hasAuth = cookieNames.some(function(n){return n.includes("auth-token") || n.includes("supabase");});

  if (!hasAuth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
