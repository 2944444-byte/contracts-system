import { NextResponse } from "next/server";

// Resend API — הוסף RESEND_API_KEY כ-Environment Variable ב-Vercel
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { to, subject, html, from, replyTo } = body;

    if (!to || !subject || !html) {
      return NextResponse.json({ error: "חסרים שדות חובה: to, subject, html" }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "RESEND_API_KEY לא מוגדר" }, { status: 500 });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:     from     ?? "PropManager <noreply@propmanager.co.il>",
        reply_to: replyTo  ?? undefined,
        to:       [to],
        subject,
        html,
      }),
    });

    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.message ?? "שגיאה בשליחה" }, { status: 500 });
    return NextResponse.json({ ok: true, id: data.id });
  } catch(e: any) {
    return NextResponse.json({ error: e?.message ?? "שגיאה" }, { status: 500 });
  }
}
