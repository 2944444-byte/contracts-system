import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAlertSync, buildAlertsDigestHtml } from "@/lib/alerts-sync";
import { sendEmail } from "@/lib/email-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily alert sync (wired in vercel.json crons). Scans contracts, options,
// guarantees, insurances and safety inspections; inserts alerts; then emails
// a digest of the newly-created alerts to the company contact (best-effort).
export async function GET(req: NextRequest) {
  // Optional auth: when CRON_SECRET is set, require it via Vercel's
  // Authorization: Bearer header or a ?secret= query param.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    const qsecret = req.nextUrl.searchParams.get("secret") || "";
    if (auth !== `Bearer ${secret}` && qsecret !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { created, newAlerts } = await runAlertSync(supabase);

  let emailed = false; let emailError: string | undefined;
  if (newAlerts.length > 0) {
    try {
      // Recipient: first company with an email, else ALERT_EMAIL env.
      const { data: companies } = await supabase.from("companies").select("email").not("email", "is", null).limit(1);
      const to = (companies && companies[0]?.email) || process.env.ALERT_EMAIL || "";
      if (to) {
        const res = await sendEmail({
          to,
          subject: `התראות מערכת — ${newAlerts.length} חדשות (${new Date().toLocaleDateString("he-IL")})`,
          html: buildAlertsDigestHtml(newAlerts),
        });
        emailed = res.ok; emailError = res.error;
      } else {
        emailError = "no recipient (companies.email / ALERT_EMAIL)";
      }
    } catch (e: any) { emailError = e?.message || String(e); }
  }

  return NextResponse.json({ ok: true, created, emailed, emailError });
}
