import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-api-auth";
import { renderLetterPdf } from "@/lib/letter-pdf-server";

export const runtime = "nodejs";
// דפדפן השרת "מתעורר" בקריאה הראשונה אחרי זמן שקט (כמה שניות).
export const maxDuration = 60;

// Body: { html, filename? } → application/pdf. ה-HTML נבנה בדפדפן המשתמש
// (buildLetterHtmlDoc) — אותו מסמך שכפתור ההדפסה מציג.
export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { html, filename } = await req.json();
    if (!html || typeof html !== "string") return NextResponse.json({ ok: false, error: "missing html" }, { status: 400 });
    if (html.length > 3_000_000) return NextResponse.json({ ok: false, error: "html too large" }, { status: 413 });
    const pdf = await renderLetterPdf(html);
    const safe = String(filename || "letter").replace(/[\r\n"]/g, "").slice(0, 120);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"letter.pdf\"; filename*=UTF-8''" + encodeURIComponent(safe + ".pdf"),
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("letter-pdf failed:", e?.stack || e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
