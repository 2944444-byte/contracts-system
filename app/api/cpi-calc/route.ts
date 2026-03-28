import { NextRequest, NextResponse } from "next/server";

// API חישוב הצמדה — עוטף את מחשבון הלמ"ס
// GET /api/cpi-calc?value=55000&from=06-15-2020&to=03-28-2026
// Accepts MM-DD-YYYY (full date) or MM-YYYY (day defaults to 15).
// The day matters: CBS determines "מדד ידוע" based on whether the date
// is before/after the ~15th (CPI for month X is published mid-month X+1).
// מחזיר: { from_value, to_value, change_percent, base_year, verification_url }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const value = searchParams.get("value");
  const from  = searchParams.get("from");  // MM-DD-YYYY or MM-YYYY
  const to    = searchParams.get("to");    // MM-DD-YYYY or MM-YYYY

  if (!value || !from || !to) {
    return NextResponse.json({ error: "חסרים פרמטרים: value, from, to" }, { status: 400 });
  }

  // Ensure MM-DD-YYYY format. If MM-YYYY is passed, default to 15th (known-index cutoff)
  function toApiDate(input: string): string {
    const parts = input.split("-");
    if (parts.length === 3) return input; // already MM-DD-YYYY
    // MM-YYYY → default to 15th
    return `${parts[0]}-15-${parts[1]}`;
  }

  const fromDate = toApiDate(from);
  const toDate   = toApiDate(to);

  const apiUrl = `https://api.cbs.gov.il/index/data/calculator/120010?value=${value}&date=${fromDate}&toDate=${toDate}&format=json&download=false`;

  try {
    const res = await fetch(apiUrl, {
      headers: { "Accept": "application/json" },
      next: { revalidate: 3600 }, // cache שעה
    });

    if (!res.ok) {
      return NextResponse.json({ error: `API הלמ"ס החזיר שגיאה: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();

    // CBS response: { request: {...}, answer: { from_value, to_value, change_percent, base_year, ... } }
    const answer = data.answer ?? data;
    return NextResponse.json({
      from_value:       answer.from_value ?? Number(value),
      to_value:         answer.to_value,
      change_percent:   answer.change_percent,
      base_year:        answer.base_year,
      from_index_date:  answer.from_index_date,
      from_index_value: answer.from_index_value,
      to_index_date:    answer.to_index_date,
      to_index_value:   answer.to_index_value,
      from_date:        from,
      to_date:          to,
      verification_url: apiUrl,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "שגיאת רשת: " + e.message }, { status: 503 });
  }
}
