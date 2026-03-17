import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PropManager — מערכת ניהול נכסים",
  description: "PropManager v4 — ניהול נכסים מסחריים",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
