// שליחת מייל דרך Supabase Edge Function
// עושה שימוש ב-Resend API שמוגדר כ-secret ב-Supabase

export interface EmailPayload {
  to:       string;
  subject:  string;
  html:     string;
  from?:    string;
  replyTo?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error ?? "שגיאה בשליחה" };
    return { ok: true };
  } catch(e: any) {
    return { ok: false, error: e?.message ?? "שגיאת רשת" };
  }
}

export function buildLetterEmail(params: {
  tenantName:   string;
  tenantEmail:  string;
  propertyName: string;
  letterType:   string;
  htmlContent:  string;
  companyName?: string;
}): EmailPayload {
  const subjects: Record<string,string> = {
    annual_start:  "שיקים לשנת השכירות הקרובה — " + params.propertyName,
    indexation:    "הפרשי הצמדה — " + params.propertyName,
    management:    "השלמת דמי ניהול — " + params.propertyName,
    demand:        "דרישת תשלום — " + params.propertyName,
    insurance:     "דמי ביטוח — " + params.propertyName,
  };
  return {
    to:      params.tenantEmail,
    subject: subjects[params.letterType] ?? "מכתב מנהל נכסים — " + params.propertyName,
    from:    params.companyName ? params.companyName + " <noreply@propmanager.co.il>" : undefined,
    html:    params.htmlContent,
  };
}
