import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // נתיבים ציבוריים — לא דורשים התחברות
  const publicPaths = ["/login", "/api/", "/_next/", "/favicon"];
  if (publicPaths.some(function(p) { return pathname.startsWith(p); })) {
    return NextResponse.next();
  }

  // בדוק session
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(function({ name, value }) {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(function({ name, value, options }) {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // אם לא מחובר — redirect ל-login
  if (!user && !pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // אם מחובר ומנסה להגיע ל-/ — redirect ל-dashboard
  if (user && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
