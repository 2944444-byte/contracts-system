import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PropManager — מערכת ניהול נכסים",
  description: "PropManager v4 — ניהול נכסים מסחריים",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
