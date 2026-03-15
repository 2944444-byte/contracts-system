export interface EmailPayload {
  to:      string;
  subject: string;
  html:    string;
  from?:   string;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  try {
    const res = await fetch("/api/send-email", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
