import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const BASE_YEAR = 2022; // same as cpi/route.ts

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from"); // "2023-01" or "2023-01-01"

  if (!from) return NextResponse.json({ missing: [], ok: true });

  // support both "YYYY-MM" and "YYYY-MM-DD"
  const parts = from.split("-");
  const by = parseInt(parts[0]);
  const bm = parseInt(parts[1]);

  if (isNaN(by) || isNaN(bm)) return NextResponse.json({ missing: [], ok: true });

  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1;

  const { data: records } = await supabase
    .from("cpi_records")
    .select("year, month")
    .eq("base_year", BASE_YEAR)
    .gte("year", by);

  const existing = new Set(
    (records ?? []).map((r: any) => `${r.year}-${String(r.month).padStart(2,"0")}`)
  );

  const missing: string[] = [];
  let y = by, m = bm;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const key = `${y}-${String(m).padStart(2,"0")}`;
    if (!existing.has(key)) missing.push(key);
    m++;
    if (m > 12) { m = 1; y++; }
  }

  return NextResponse.json({ missing, ok: missing.length === 0, total: missing.length });
}
