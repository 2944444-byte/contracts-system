import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // נתיבים ציבוריים
  const publicPaths = ["/login", "/api/", "/_next/", "/favicon", "/_vercel"];
  if (publicPaths.some(function(p) { return pathname.startsWith(p); })) {
    return NextResponse.next();
  }

  // בדוק auth token מה-cookies
  const token = request.cookies.get("sb-ndvcqgrpsqykhodiyrhx-auth-token")?.value ||
                request.cookies.get("supabase-auth-token")?.value;

  // אם אין token — redirect ל-login
  if (!token) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // אם מחובר ומגיע ל-/ — redirect ל-dashboard
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
