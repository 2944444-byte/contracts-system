import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateTransferCharges, nextBillingMonth } from "@/lib/transfer-billing";

export const runtime = "nodejs";
export const maxDuration = 60;

// Monthly billing for transfer / standing-order tenants, run by cron on the
// 16th-20th of each month (vercel.json). The CBS publishes each month's index
// around the 15th of the following month — earlier when the 15th falls on a
// holiday or Shabbat — so by the 16th the governing index for next month's
// payment is normally out.
//
// The run is idempotent: generateTransferCharges skips any contract already
// billed for the period, so the daily 16-20 window simply retries until the
// index is in. The gate below makes the retry meaningful — the run REFUSES to
// bill until the index for the EXPECTED month (the month before the run) is
// actually in cpi_records, exactly as the user specified: run on the 16th,
// but only after verifying the published index is the month it should be.

const BASE_YEAR = 2022;

export async function GET(req: NextRequest) {
  // Fail CLOSED: without a configured secret this endpoint would be open to
  // any caller — triggering runs, racing the dedup, and probing portfolio
  // metadata. Header only; a ?secret= query param lands in access logs.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if ((req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  // The anon-key fallback made a missing service key a SILENT no-op: every
  // scoped SELECT returned empty under RLS, the index looked unpublished
  // forever, and nobody was billed or told. Fail loudly instead.
  if (!key) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const today = new Date();
  const period = nextBillingMonth(today);

  // The index that must exist before billing: the month BEFORE the run month.
  // Running on 16.9 → August's index, published ~15.9.
  const expected = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  var { data: idx } = await supabase.from("cpi_records")
    .select("year, month, value").eq("base_year", BASE_YEAR)
    .eq("year", expected.getFullYear()).eq("month", expected.getMonth() + 1).limit(1);

  // Self-heal: if the expected index isn't ingested yet, try fetching it from
  // the CBS right now instead of just waiting for the nightly cpi-cron —
  // July 2026 sat unpublished-locally for days exactly this way.
  if (!idx || idx.length === 0) {
    try {
      const p = expected.getFullYear() + "-" + String(expected.getMonth() + 1).padStart(2, "0");
      const cbsRes = await fetch("https://api.cbs.gov.il/index/data/price?id=120010&startperiod=" + p + "&endperiod=" + p + "&lang=he&format=json", { cache: "no-store" });
      if (cbsRes.ok) {
        const cbsData = await cbsRes.json();
        const val = cbsData?.month?.[0]?.date?.[0]?.currBase?.value;
        if (val) {
          await supabase.from("cpi_records").upsert({
            year: expected.getFullYear(), month: expected.getMonth() + 1,
            value: Number(val), base_year: BASE_YEAR,
          }, { onConflict: "year,month,base_year" });
          idx = [{ year: expected.getFullYear(), month: expected.getMonth() + 1, value: Number(val) } as any];
        }
      }
    } catch (e) { /* fall through to the waiting path */ }
  }

  if (!idx || idx.length === 0) {
    // Not published yet — tomorrow's run will try again. Past the 20th this
    // stops being a normal delay and becomes something a human should see.
    if (today.getDate() >= 20) {
      const title = "⚠️ מדד " + (expected.getMonth() + 1) + "/" + expected.getFullYear() +
        " טרם נקלט — חיובי העברה/ה\"ק ל" + period.label + " ממתינים";
      const { data: exist } = await supabase.from("alerts")
        .select("id").eq("alert_type", "transfer_billing_waiting")
        .eq("title", title).eq("is_resolved", false).limit(1);
      if (!exist || exist.length === 0) {
        await supabase.from("alerts").insert({
          title, message: "הריצה האוטומטית ממתינה למדד. בדוק את קליטת המדד במסך הצמדה, או הרץ ידנית ממסך החיובים.",
          severity: "warning", alert_type: "transfer_billing_waiting",
          entity_type: "billing", entity_id: null, is_resolved: false,
        });
      }
    }
    // Waiting for the index is still a healthy run — stamp the heartbeat.
    try {
      await supabase.from("system_heartbeats").upsert({
        job: "transfer_billing", last_run: new Date().toISOString(), last_status: "waiting",
        details: "ממתין למדד " + (expected.getMonth() + 1) + "/" + expected.getFullYear(),
      }, { onConflict: "job" });
    } catch (e) { /* best-effort */ }
    return NextResponse.json({ ok: true, waiting: true, expectedIndex: (expected.getMonth() + 1) + "/" + expected.getFullYear() });
  }

  const result = await generateTransferCharges({ supabase, today });

  // The user reviews, then sends the letters — so a run that created charges
  // announces itself as an alert rather than passing silently.
  if (result.created > 0 || result.errors.length > 0) {
    // The error path is not self-limiting the way success is (the dedup makes
    // the next successful run a no-op) — a broken CBS API would otherwise
    // insert a fresh alert on every scheduled retry.
    if (result.created === 0) {
      const { data: errExist } = await supabase.from("alerts")
        .select("id").eq("alert_type", "transfer_billing_run")
        .eq("is_resolved", false).ilike("title", "%" + period.label + "%").limit(1);
      if (errExist && errExist.length > 0) {
        return NextResponse.json({ ok: true, period: period.label, created: 0, skippedExisting: result.skippedExisting, skippedZero: result.skippedZero, errorCount: result.errors.length, alertExists: true });
      }
    }
    await supabase.from("alerts").insert({
      title: "🏦 " + (result.created > 0
        ? "נוצרו " + result.created + " חיובי העברה/ה\"ק ל" + period.label + " — לבדיקתך"
        : "שגיאות בהרצת חיובי העברה/ה\"ק ל" + period.label),
      message: "מדד " + (expected.getMonth() + 1) + "/" + expected.getFullYear() + " = " + idx[0].value + "\n" +
        result.lines.join("\n") +
        (result.errors.length ? "\n\nשגיאות:\n" + result.errors.join("\n") : "") +
        "\n\nבמסך החיובים: בדוק את הסכומים ולחץ 📧 להפקת מכתב הודעה לכל שוכר.",
      severity: result.errors.length ? "warning" : "info",
      alert_type: "transfer_billing_run",
      entity_type: "billing", entity_id: null, is_resolved: false,
    });
  }

  // Heartbeat for the errors screen ("ran and failed" vs "never ran").
  try {
    await supabase.from("system_heartbeats").upsert({
      job: "transfer_billing", last_run: new Date().toISOString(),
      last_status: result.errors.length ? "errors" : "ok",
      details: period.label + ": " + result.created + " נוצרו, " + result.skippedExisting + " קיימים",
    }, { onConflict: "job" });
  } catch (e) { /* best-effort */ }

  // Counts only in the HTTP response. The per-tenant lines carry names and
  // amounts; they belong in the alert (RLS-protected, visible only to
  // authorized users), not in a JSON body that a caller without CRON_SECRET
  // configured could read.
  return NextResponse.json({
    ok: true, period: period.label,
    created: result.created, skippedExisting: result.skippedExisting,
    skippedZero: result.skippedZero, errorCount: result.errors.length,
  });
}
