import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Only series 120010 (base 2020=100) — the current official series
const SERIES_ID = "120010";
const BASE_YEAR = 2022; // stored base_year in DB

async function fetchFromCBS(fromYear: number, toYear: number) {
  const url = `https://api.cbs.gov.il/index/data/price?id=${SERIES_ID}&startperiod=${fromYear}-01&endperiod=${toYear}-12&lang=he&format=json`;
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
}

// GET /api/cpi — returns all records from DB, or fetches from CBS if empty/refresh
// GET /api/cpi?year=2021 — fetches specific year from CBS and saves
// GET /api/cpi?from_year=2019&to_year=2024 — fetches range
// GET /api/cpi?refresh=true — force re-fetch current year
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "true";
  const fromYear = searchParams.get("from_year") ? parseInt(searchParams.get("from_year")!) : null;
  const toYear = searchParams.get("to_year") ? parseInt(searchParams.get("to_year")!) : null;
  const singleYear = searchParams.get("year") ? parseInt(searchParams.get("year")!) : null;

  // If no specific fetch requested, return DB records
  if (!refresh && !fromYear && !toYear && !singleYear) {
    const { data, error } = await supabase
      .from("cpi_records")
      .select("*")
      .eq("base_year", BASE_YEAR)
      .order("year")
      .order("month");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data && data.length > 0) return NextResponse.json({ source: "db", records: data, count: data.length });
  }

  // Determine fetch range
  const now = new Date();
  const fetchFrom = fromYear ?? singleYear ?? now.getFullYear();
  const fetchTo = toYear ?? singleYear ?? now.getFullYear();

  try {
    const records = await fetchFromCBS(fetchFrom, fetchTo);
    if (records.length === 0) {
      return NextResponse.json({ source: "cbs_empty", count: 0, message: "הלמ\"ס לא החזיר נתונים" });
    }

    // Remove old duplicate records for this period before inserting
    await supabase
      .from("cpi_records")
      .delete()
      .gte("year", fetchFrom)
      .lte("year", fetchTo)
      .neq("base_year", BASE_YEAR);

    const { error } = await supabase
      .from("cpi_records")
      .upsert(records, { onConflict: "year,month,base_year" });

    if (error) return NextResponse.json({ source: "cbs", error: error.message, count: records.length });

    return NextResponse.json({ source: "cbs", count: records.length, records });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { year, month, value } = await request.json();
    if (!year || !month || !value) return NextResponse.json({ error: "חסרים שדות" }, { status: 400 });
    const { data, error } = await supabase
      .from("cpi_records")
      .upsert({ year, month, value, base_year: BASE_YEAR }, { onConflict: "year,month,base_year" })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ record: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
