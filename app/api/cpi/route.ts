import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// סדרות לפי שנת בסיס
const CBS_SERIES: Record<number, string> = {
  2020: "120010",
  2010: "120020",
  2000: "120030",
};

async function fetchFromCBS(seriesId: string, year: number): Promise<{year:number,month:number,value:number}[]> {
  const url = `https://api.cbs.gov.il/index/data/price?id=${seriesId}&startperiod=${year}-01&endperiod=${year}-12&lang=he&format=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  const obs = data?.GetIndexResponse?.SeriesInfo?.[0]?.Obs ?? data?.data ?? [];
  if (!Array.isArray(obs)) return [];
  return obs.flatMap((o: any) => {
    const period = o?.["@TIME_PERIOD"] ?? o?.period ?? "";
    const val = parseFloat(o?.["@OBS_VALUE"] ?? o?.value ?? "0");
    if (!period || !val) return [];
    const [y, m] = period.split("-");
    return [{ year: parseInt(y), month: parseInt(m), value: val }];
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const fromYear = parseInt(searchParams.get("from_year") ?? yearParam ?? String(new Date().getFullYear()));
  const toYear = parseInt(searchParams.get("to_year") ?? yearParam ?? String(new Date().getFullYear()));
  const baseYear = parseInt(searchParams.get("base_year") ?? "0"); // 0 = כל הבסיסים
  const refresh = searchParams.get("refresh") === "true";

  // אם לא refresh — החזר ממסד
  if (!refresh && yearParam) {
    const { data } = await supabase.from("cpi_records").select("*").eq("year", fromYear).order("month");
    if (data && data.length > 0) return NextResponse.json({ source: "db", records: data, added: 0 });
  }

  const seriesToFetch = baseYear > 0
    ? { [baseYear]: CBS_SERIES[baseYear] ?? "120010" }
    : CBS_SERIES;

  let totalAdded = 0;
  const allRecords: any[] = [];
  const errors: string[] = [];

  for (let y = fromYear; y <= toYear; y++) {
    for (const [baseYearStr, seriesId] of Object.entries(seriesToFetch)) {
      try {
        const records = await fetchFromCBS(seriesId, y);
        if (records.length > 0) {
          const toInsert = records.map(r => ({ ...r, base_year: Number(baseYearStr) }));
          const { error } = await supabase.from("cpi_records")
            .upsert(toInsert, { onConflict: "year,month,base_year" });
          if (!error) { totalAdded += records.length; allRecords.push(...toInsert); }
          else errors.push(`${y}/${baseYearStr}: ${error.message}`);
        }
      } catch (e: any) {
        errors.push(`${y}/${baseYearStr}: ${e.message}`);
      }
    }
  }

  return NextResponse.json({
    source: "cbs",
    added: totalAdded,
    years: `${fromYear}-${toYear}`,
    records: allRecords,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export async function POST(request: Request) {
  try {
    const { year, month, value, base_year = 2020 } = await request.json();
    if (!year || !month || !value) return NextResponse.json({ error: "חסרים שדות" }, { status: 400 });
    const { data, error } = await supabase.from("cpi_records")
      .upsert({ year, month, value, base_year }, { onConflict: "year,month,base_year" })
      .select().single();
    if (error) throw error;
    return NextResponse.json({ record: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
