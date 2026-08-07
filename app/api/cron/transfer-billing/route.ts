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

  const today = new Date();
  const period = nextBillingMonth(today);

  // The index that must exist before billing: the month BEFORE the run month.
  // Running on 16.9 → August's index, published ~15.9.
  const expected = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const { data: idx } = await supabase.from("cpi_records")
    .select("year, month, value").eq("base_year", BASE_YEAR)
    .eq("year", expected.getFullYear()).eq("month", expected.getMonth() + 1).limit(1);

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
    return NextResponse.json({ ok: true, waiting: true, expectedIndex: (expected.getMonth() + 1) + "/" + expected.getFullYear() });
  }

  const result = await generateTransferCharges({ supabase, today });

  // The user reviews, then sends the letters — so a run that created charges
  // announces itself as an alert rather than passing silently.
  if (result.created > 0 || result.errors.length > 0) {
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

  return NextResponse.json({
    ok: true, period: period.label,
    created: result.created, skippedExisting: result.skippedExisting,
    skippedZero: result.skippedZero, errors: result.errors,
  });
}
