import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: { remotePatterns: [{ protocol:"https", hostname:"*.supabase.co" }] },
  // יצירת PDF בשרת (Chromium): החבילות נטענות כפי שהן (לא נארזות ב-webpack),
  // וקובצי הגופנים נכללים בפונקציה של המסלול שקורא אותם מהדיסק.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: { "/api/letter-pdf": ["./lib/fonts/**"] },
  env: {
    // Stamped at build time — shown next to the version in the sidebar and
    // settings, so "which build am I on" is answerable at a glance.
    NEXT_PUBLIC_BUILD_DATE: new Date().toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }),
  },
};
export default nextConfig;
