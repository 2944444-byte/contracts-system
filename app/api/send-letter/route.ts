import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email-utils";

export const runtime = "nodejs";
export const maxDuration = 30;

// Send a letter as an email with the rendered PDF attached and a short body.
// The PDF is generated client-side (correct Hebrew/RTL via the browser) and sent
// here as base64. Body: { to, cc?, subject, shortHtml, pdfBase64, filename }.
export async function POST(req: NextRequest) {
  try {
    const { to, cc, subject, shortHtml, pdfBase64, filename } = await req.json();
    if (!to) return NextResponse.json({ ok: false, error: "missing recipient" }, { status: 400 });
    if (!pdfBase64) return NextResponse.json({ ok: false, error: "missing pdf" }, { status: 400 });

    const res = await sendEmail({
      to: to,
      cc: Array.isArray(cc) ? cc : undefined,
      subject: subject || "מכתב",
      html: shortHtml || "<div dir=\"rtl\">שלום,<br/>מצורף מכתב.<br/><br/>בברכה,<br/>הנהלת הנכס</div>",
      attachments: [{ filename: (filename || "letter") + ".pdf", content: pdfBase64 }],
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
