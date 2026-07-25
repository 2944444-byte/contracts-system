import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const SERIES_ID = "120010"; // בסיס 2020=100 בלבד
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

async function fetchRangeFromCBS(fromYear: number, toYear: number) {
  const url = `https://api.cbs.gov.il/index/data/price?id=${SERIES_ID}&startperiod=${fromYear}-01&endperiod=${toYear}-12&lang=he&format=json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const dateArray = data?.month?.[0]?.date ?? [];
    if (!Array.isArray(dateArray)) return [];
    return dateArray
      .filter((d: any) => d?.year && d?.month && d?.currBase?.value)
      .map((d: any) => ({
        year: Number(d.year),
        month: Number(d.month),
        value: Number(d.currBase.value),
        base_year: BASE_YEAR,
      }));
  } catch {
    return [];
  }
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
  // CPI published on 15th — if before 15th fetch previous month
  if (now.getDate() < 15) {
    targetMonth -= 1;
    if (targetMonth === 0) { targetMonth = 12; targetYear -= 1; }
  }

  // Check if already exists
  const { data: existing } = await supabase
    .from("cpi_records")
    .select("id")
    .eq("year", targetYear)
    .eq("month", targetMonth)
    .eq("base_year", BASE_YEAR)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ message: "מדד כבר קיים", year: targetYear, month: targetMonth });
  }

  // Fetch new month
  const value = await fetchMonthFromCBS(targetYear, targetMonth);
  if (!value) {
    return NextResponse.json({ error: "לא נמצא מדד חדש", year: targetYear, month: targetMonth });
  }

  const { error } = await supabase
    .from("cpi_records")
    .upsert({ year: targetYear, month: targetMonth, value, base_year: BASE_YEAR }, { onConflict: "year,month,base_year" });

  if (!error) {
    await supabase.from("alerts").insert({
      title: "מדד מחירים עודכן אוטומטית",
      message: `מדד ${targetMonth}/${targetYear} = ${value} (בסיס 2020=100)`,
      alert_type: "system", priority: "low", related_entity_type: "system",
    });
  }

  return NextResponse.json({ success: true, year: targetYear, month: targetMonth, value, error: error?.message });
}
