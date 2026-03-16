import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { html, filename } = await req.json();
  if (!html) return NextResponse.json({ error: "Missing html" }, { status: 400 });

  // שלח ל-browserless/puppeteer או החזר HTML להדפסה
  // בגרסה זו — מחזיר HTML מוכן להדפסה
  const printHtml = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; direction: rtl; padding: 40px; color: #1e293b; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  .header { border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 24px; }
  .meta { font-size: 12px; color: #64748b; }
  .content { line-height: 1.8; white-space: pre-wrap; }
  .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #94a3b8; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>${html}</body>
</html>`;

  return new NextResponse(printHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename || 'document'}.html"`,
    },
  });
}
