export interface EmailAttachment {
  filename: string;
  content:  string; // base64-encoded content
}

export interface EmailPayload {
  to:           string;
  subject:      string;
  html:         string;
  from?:        string;
  cc?:          string[];
  attachments?: EmailAttachment[];
}

export async function sendEmail(payload: EmailPayload): Promise<{ok:boolean;error?:string}> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return {ok:false,error:"RESEND_API_KEY not configured"};
  try {
    const body: any = {
      from: payload.from ?? "PropManager <noreply@propmanager.co.il>",
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
    };
    if (payload.cc && payload.cc.length > 0) body.cc = payload.cc;
    if (payload.attachments && payload.attachments.length > 0) body.attachments = payload.attachments;
    const res = await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
    const d = await res.json();
    if (!res.ok) return {ok:false,error:d?.message??"Send failed"};
    return {ok:true};
  } catch(e:any) { return {ok:false,error:e?.message}; }
}

export function buildLetterHtml(subject: string, body: string, tenant: string, property: string): string {
  return `<div dir="rtl" style="font-family:Arial,sans-serif;direction:rtl;padding:32px;max-width:600px">
    <h2 style="color:#1e3a5f;border-bottom:2px solid #3b82f6;padding-bottom:8px">${subject}</h2>
    <p style="color:#64748b;font-size:13px">${tenant} | ${property} | ${new Date().toLocaleDateString("he-IL")}</p>
    <div style="line-height:1.8;white-space:pre-wrap;margin-top:16px">${body}</div>
    <hr style="margin-top:32px;border:none;border-top:1px solid #e2e8f0"/>
    <p style="font-size:11px;color:#94a3b8">PropManager v4</p>
  </div>`;
}
