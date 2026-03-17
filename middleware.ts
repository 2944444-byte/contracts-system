import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isLogin  = pathname.startsWith("/login");
  const isApi    = pathname.startsWith("/api");
  const isStatic = pathname.startsWith("/_next") || pathname.includes(".");

  if (isStatic || isApi) return NextResponse.next();

  // בדוק cookie של supabase
  const sbCookie = req.cookies.getAll().some(function(c) {
    return c.name.includes("sb-") && c.name.includes("-auth-token");
  });

  if (!sbCookie && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (sbCookie && isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
