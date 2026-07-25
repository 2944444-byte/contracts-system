import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const BASE_YEAR = 2022;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from"); // "2023-01" or "2023-01-01"

  if (!from) return NextResponse.json({ missing: [], ok: true });

  const parts = from.split("-");
  const by = parseInt(parts[0]);
  const bm = parseInt(parts[1]);
  if (isNaN(by) || isNaN(bm)) return NextResponse.json({ missing: [], ok: true });

  // כלל t-2: בודקים רק עד 2 חודשים לפני היום
  // הלמ"ס מפרסם ב-15 לחודש את מדד החודש הקודם
  // לכן ב-14 במרץ 2026 — המדד האחרון הידוע הוא ינואר 2026
  const now = new Date();
  const t2 = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const endYear = t2.getFullYear();
  const endMonth = t2.getMonth() + 1;

  // אם תאריך הבסיס הוא אחרי t-2 — אין מה לבדוק
  if (by > endYear || (by === endYear && bm > endMonth)) {
    return NextResponse.json({ missing: [], ok: true });
  }

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

  return NextResponse.json({
    missing,
    ok: missing.length === 0,
    total: missing.length,
    checked_until: `${endYear}-${String(endMonth).padStart(2,"0")}`,
  });
}
