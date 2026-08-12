import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAlertSync, buildAlertsDigestHtml } from "@/lib/alerts-sync";
import { syncContractStatuses } from "@/lib/contractSync";
import { autoCreateGuaranteeRenewalLetters, getUnsentLetters, buildLettersReminderHtml } from "@/lib/guarantee-letters";
import { sendEmail } from "@/lib/email-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily alert sync (wired in vercel.json crons). Scans contracts, options,
// guarantees, insurances and safety inspections; inserts alerts; then emails
// a digest of the newly-created alerts to the company contact (best-effort).
export async function GET(req: NextRequest) {
  // Optional auth: when CRON_SECRET is set, require it via Vercel's
  // Authorization: Bearer header or a ?secret= query param.
  // Fail CLOSED (same hardening as transfer-billing): unauthenticated calls
  // could trigger digest emails on every hit and probe internals.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if ((req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Same hardening as transfer-billing: under the anon key every scoped
  // query silently returns nothing and the sync "succeeds" doing zero work.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Recycle-bin retention: history older than 14 days is purged nightly.
  let historyPurged = 0;
  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase.from("row_history")
      .delete({ count: "exact" }).lt("created_at", cutoff);
    historyPurged = count ?? 0;
  } catch (e) { /* best-effort — never blocks the sync */ }

  // Status lifecycle + auto-exercised options + visitor-parking billing dates.
  // This ran ONLY from the manual "סנכרן סטטוסים" button until now — a lease
  // whose notice deadline passed was auto-exercised only when somebody
  // happened to click.
  const statusUpdates = await syncContractStatuses(supabase);

  const { created, newAlerts } = await runAlertSync(supabase);

  // Auto-create guarantee-renewal letters for guarantees expiring within 30 days
  // (idempotent — skips guarantees that already have a renewal letter).
  let createdGuaranteeLetters: Array<{ tenantName: string; ref: string; deadline: string; needsUpdate: boolean }> = [];
  try { createdGuaranteeLetters = await autoCreateGuaranteeRenewalLetters(supabase, 30); }
  catch (e) { /* best-effort */ }

  // All letters still waiting to be sent (for the manager reminder).
  let unsent: any[] = [];
  try { unsent = await getUnsentLetters(supabase); } catch (e) { /* best-effort */ }

  // Email the manager when there's anything to act on: new alerts, newly
  // auto-created guarantee letters, or letters still waiting to be sent.
  let emailed = false; let emailError: string | undefined;
  const hasLettersReminder = createdGuaranteeLetters.length > 0 || unsent.length > 0;
  if (newAlerts.length > 0 || hasLettersReminder) {
    try {
      // Recipient: first company with an email, else ALERT_EMAIL env.
      const { data: companies } = await supabase.from("companies").select("email").not("email", "is", null).limit(1);
      const to = (companies && companies[0]?.email) || process.env.ALERT_EMAIL || "";
      if (to) {
        const alertsHtml = newAlerts.length > 0 ? buildAlertsDigestHtml(newAlerts) : "";
        const lettersHtml = buildLettersReminderHtml(unsent, createdGuaranteeLetters);
        const subjParts: string[] = [];
        if (newAlerts.length > 0) subjParts.push(`${newAlerts.length} התראות`);
        if (unsent.length > 0) subjParts.push(`${unsent.length} מכתבים לשליחה`);
        const res = await sendEmail({
          to,
          subject: `PropManager — ${subjParts.join(" · ") || "סיכום יומי"} (${new Date().toLocaleDateString("he-IL")})`,
          html: alertsHtml + lettersHtml,
        });
        emailed = res.ok; emailError = res.error;
      } else {
        emailError = "no recipient (companies.email / ALERT_EMAIL)";
      }
    } catch (e: any) { emailError = e?.message || String(e); }
  }

  // Heartbeat: lets the errors screen tell "ran and failed" apart from
  // "silently stopped running" (cron outage, schedule change).
  try {
    await supabase.from("system_heartbeats").upsert({
      job: "sync_contracts", last_run: new Date().toISOString(), last_status: "ok",
      details: statusUpdates + " עדכוני סטטוס · " + created + " התראות",
    }, { onConflict: "job" });
  } catch (e) { /* best-effort */ }

  return NextResponse.json({
    ok: true, created, statusUpdates, emailed, emailError,
    guaranteeLettersCreated: createdGuaranteeLetters.length,
    unsentLetters: unsent.length,
    historyPurged,
  });
}
