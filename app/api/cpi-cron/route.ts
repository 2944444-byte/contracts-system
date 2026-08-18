import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

// Nightly CPI ingestion (scheduled in vercel.json, 04:30 UTC — half an hour
// before transfer-billing, so on the 16th the fresh index is already in).
//
// Fixed 2026-08-18: the route existed but was never scheduled, and its target
// month was wrong — after the 15th it fetched the CURRENT month (published
// only a month later), so the just-published index (last month's) was never
// ingested. That starved the transfer-billing gate, which waited for an index
// that would never arrive.

const SERIES_ID = "120010";
const BASE_YEAR = 2022;

async function fetchMonthFromCBS(year: number, month: number): Promise<number | null> {
  const period = `${year}-${String(month).padStart(2, "0")}`;
  const url = `https://api.cbs.gov.il/index/data/price?id=${SERIES_ID}&startperiod=${period}&endperiod=${period}&lang=he&format=json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const dateArray = data?.month?.[0]?.date ?? [];
    if (!Array.isArray(dateArray) || dateArray.length === 0) return null;
    const val = dateArray[0]?.currBase?.value;
    return val ? Number(val) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  // Fail CLOSED, header only — same hardening as the other crons.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if ((req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key,
    { auth: { autoRefreshToken: false, persistSession: false } });

  // The LATEST published month: on/after the 16th it's last month; before
  // that, two months back (the 15th itself is ambiguous — treated as not
  // yet published, same convention as the billing paths).
  const now = new Date();
  const back = now.getDate() >= 16 ? 1 : 2;
  const results: any[] = [];

  // Catch-up: check the last 4 published months and ingest any that are
  // missing — a single missed night (or a gap like July 2026) self-heals.
  for (var i = back; i < back + 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const { data: exists } = await supabase.from("cpi_records")
      .select("id").eq("year", y).eq("month", m).eq("base_year", BASE_YEAR).limit(1);
    if (exists && exists.length > 0) continue;
    const value = await fetchMonthFromCBS(y, m);
    if (value == null) { results.push({ year: y, month: m, status: "not_published" }); continue; }
    const { error } = await supabase.from("cpi_records")
      .upsert({ year: y, month: m, value: value, base_year: BASE_YEAR }, { onConflict: "year,month,base_year" });
    results.push({ year: y, month: m, value: value, status: error ? error.message : "ingested" });
    if (!error) {
      await supabase.from("alerts").insert({
        title: "📈 מדד " + m + "/" + y + " נקלט אוטומטית",
        message: "מדד " + m + "/" + y + " = " + value + " (בסיס 2022). חיובי העברה/ה\"ק ישתמשו בו אוטומטית.",
        severity: "info", alert_type: "system",
        entity_type: "system", entity_id: null, is_resolved: false,
      });
    }
  }

  try {
    await supabase.from("system_heartbeats").upsert({
      job: "cpi_ingest", last_run: new Date().toISOString(),
      last_status: results.some(function (r) { return r.status === "ingested"; }) ? "ok" : "no_new",
      details: results.length ? JSON.stringify(results).slice(0, 300) : "אין מדדים חסרים",
    }, { onConflict: "job" });
  } catch (e) { /* best-effort */ }

  return NextResponse.json({ ok: true, checked: back + 3, results: results });
}
