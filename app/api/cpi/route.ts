import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const CBS_SERIES: Record<number, string> = {
  2022: "120010",
  2010: "120020",
  2000: "120030",
};

async function fetchFromCBS(seriesId: string, fromYear: number, toYear: number) {
  const url = `https://api.cbs.gov.il/index/data/price?id=${seriesId}&startperiod=${fromYear}-01&endperiod=${toYear}-12&lang=he&format=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  const dateArray = data?.month?.[0]?.date ?? [];
  if (!Array.isArray(dateArray)) return [];
  return dateArray
    .filter((d: any) => d?.year && d?.month && d?.currBase?.value)
    .map((d: any) => ({ year: d.year, month: d.month, value: d.currBase.value }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromYear = parseInt(searchParams.get("from_year") ?? searchParams.get("year") ?? String(new Date().getFullYear()));
  const toYear = parseInt(searchParams.get("to_year") ?? searchParams.get("year") ?? String(new Date().getFullYear()));
  const baseYear = parseInt(searchParams.get("base_year") ?? "2022");
  const refresh = searchParams.get("refresh") === "true";

  if (!refresh) {
    const { data } = await supabase.from("cpi_records").select("*").order("year").order("month");
    if (data && data.length > 0) return NextResponse.json({ source: "db", records: data, count: data.length });
  }

  const seriesId = CBS_SERIES[baseYear] ?? "120010";
  try {
    const records = await fetchFromCBS(seriesId, fromYear, toYear);
    if (records.length === 0) return NextResponse.json({ source: "cbs_empty", count: 0, message: 'הלמ"ס לא החזיר נתונים' });
    const toInsert = records.map(r => ({ year: r.year, month: r.month, value: r.value, base_year: baseYear }));
    const { error } = await supabase.from("cpi_records").upsert(toInsert, { onConflict: "year,month,base_year" });
    if (error) return NextResponse.json({ source: "cbs", error: error.message, records: toInsert, count: toInsert.length });
    return NextResponse.json({ source: "cbs", count: records.length, records: toInsert });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { year, month, value, base_year = 2022 } = await request.json();
    if (!year || !month || !value) return NextResponse.json({ error: "חסרים שדות" }, { status: 400 });
    const { data, error } = await supabase.from("cpi_records").upsert({ year, month, value, base_year }, { onConflict: "year,month,base_year" }).select().single();
    if (error) throw error;
    return NextResponse.json({ record: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
