import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromDate = searchParams.get("from");
  const toDate = searchParams.get("to");
  const value = searchParams.get("value") ?? "100";

  if (!fromDate || !toDate) {
    return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
  }

  try {
    const url = "https://api.cbs.gov.il/index/data/calculator/120010?value=" + value + "&date=" + fromDate + "&toDate=" + toDate + "&format=json&download=false";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "שגיאה מהלמס" }, { status: 502 });
    const data = await res.json();
    const answer = data?.answer;
    if (!answer) return NextResponse.json({ error: "תשובה ריקה" }, { status: 502 });
    return NextResponse.json({
      from_date: fromDate,
      to_date: toDate,
      original_value: answer.from_value,
      updated_value: answer.to_value,
      change_percent: answer.change_percent,
      from_index: answer.from_index_value,
      to_index: answer.to_index_value,
      base_year: answer.base_year,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
