import { NextRequest, NextResponse } from "next/server";

// API חישוב הצמדה — עוטף את מחשבון הלמ"ס
// GET /api/cpi-calc?value=55000&from=09-2020&to=10-2025
// מחזיר: { from_value, to_value, change_percent, base_year, verification_url }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const value = searchParams.get("value");
  const from  = searchParams.get("from");  // MM-YYYY
  const to    = searchParams.get("to");    // MM-YYYY

  if (!value || !from || !to) {
    return NextResponse.json({ error: "חסרים פרמטרים: value, from, to" }, { status: 400 });
  }

  // המר MM-YYYY ל-MM-DD-YYYY שנדרש ב-API
  function toApiDate(mmYyyy: string): string {
    const [mm, yyyy] = mmYyyy.split("-");
    return `${mm}-01-${yyyy}`;
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
