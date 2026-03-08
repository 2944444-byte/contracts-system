import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const CBS_SERIES: Record<number, string> = {
  2020: "120010",
  2010: "120020",
  2000: "120030",
};

async function fetchCBSSeries(seriesId: string, year: number, month: number) {
  const period = `${year}-${String(month).padStart(2,"0")}`;
  const url = `https://api.cbs.gov.il/index/data/price?id=${seriesId}&startperiod=${period}&endperiod=${period}&lang=he&format=json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const obs = data?.GetIndexResponse?.SeriesInfo?.[0]?.Obs ?? data?.data ?? [];
    if (!Array.isArray(obs) || obs.length === 0) return null;
    const val = parseFloat(obs[0]?.["@OBS_VALUE"] ?? obs[0]?.value ?? "0");
    return val > 0 ? val : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth() + 1;
  if (now.getDate() < 15) {
    targetMonth -= 1;
    if (targetMonth === 0) { targetMonth = 12; targetYear -= 1; }
  }

  const { data: existing } = await supabase.from("cpi_records")
    .select("id").eq("year", targetYear).eq("month", targetMonth).eq("base_year", 2020).limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json({ message: "מדד כבר קיים", year: targetYear, month: targetMonth });
  }

  const results: any[] = [];
  for (const [baseYearStr, seriesId] of Object.entries(CBS_SERIES)) {
    const value = await fetchCBSSeries(seriesId, targetYear, targetMonth);
    if (value) {
      const { error } = await supabase.from("cpi_records").upsert(
        { year: targetYear, month: targetMonth, value, base_year: Number(baseYearStr) },
        { onConflict: "year,month,base_year" }
      );
      results.push({ baseYear: Number(baseYearStr), value, saved: !error });
    }
  }

  if (results.length > 0) {
    await supabase.from("alerts").insert({
      title: "מדד מחירים עודכן אוטומטית",
      message: `מדד ${targetMonth}/${targetYear} נוסף (${results.length} סדרות)`,
      alert_type: "system", priority: "low", related_entity_type: "system",
    });
  }

  return NextResponse.json({ success: true, year: targetYear, month: targetMonth, results });
}
