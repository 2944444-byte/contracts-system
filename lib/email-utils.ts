// lib/email-utils.ts
// שליחת מיילים דרך Resend API

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    "PropManager <noreply@propmanager.co.il>",
        to:      [to],
        subject,
        html,
      }),
    });
    const d = await res.json();
    if (!res.ok) return { ok: false, error: d?.message ?? "Send failed" };
    return { ok: true };
  } catch(e: any) {
    return { ok: false, error: e?.message };
  }
}
