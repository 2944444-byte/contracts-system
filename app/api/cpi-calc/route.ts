import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Types ────────────────────────────────────────────────────────────────────
export interface IndexationResult {
  // Input
  base_month: number;
  base_year: number;
  current_month: number;
  current_year: number;
  base_amount: number;
  // Index values
  base_index: number;
  current_index: number;
  base_index_period: string; // "2022=100"
  // Result
  ratio: number;             // current / base
  updated_amount: number;    // base_amount × ratio
  diff_amount: number;       // updated - base
  change_percent: number;
  // Meta
  source: "cbs_api" | "db";
  calculated_at: string;
}

// ─── CBS API Calculator ───────────────────────────────────────────────────────
async function calcViaCBSApi(
  baseMonth: number, baseYear: number,
  currentMonth: number, currentYear: number,
  amount: number
): Promise<IndexationResult | null> {
  try {
    const fromDate = `01-${String(baseMonth).padStart(2, "0")}-${baseYear}`;
    const toDate = `01-${String(currentMonth).padStart(2, "0")}-${currentYear}`;
    const url = `https://api.cbs.gov.il/index/data/calculator/120010?value=${amount}&date=${fromDate}&toDate=${toDate}&format=json&download=false`;

    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const answer = data?.answer;
    if (!answer?.to_value) return null;

    const baseIndex = parseFloat(answer.from_index_value ?? "0");
    const currentIndex = parseFloat(answer.to_index_value ?? "0");
    const updatedAmount = parseFloat(answer.to_value);
    const ratio = baseIndex > 0 ? currentIndex / baseIndex : updatedAmount / amount;

    return {
      base_month: baseMonth, base_year: baseYear,
      current_month: currentMonth, current_year: currentYear,
      base_amount: amount,
      base_index: baseIndex,
      current_index: currentIndex,
      base_index_period: answer.base_year ? `${answer.base_year}=100` : "2022=100",
      ratio,
      updated_amount: updatedAmount,
      diff_amount: updatedAmount - amount,
      change_percent: parseFloat(answer.change_percent ?? "0"),
      source: "cbs_api",
      calculated_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── DB Fallback Calculator ───────────────────────────────────────────────────
async function calcViaDB(
  baseMonth: number, baseYear: number,
  currentMonth: number, currentYear: number,
  amount: number
): Promise<IndexationResult | null> {
  // Fetch both index values from DB
  const { data: rows } = await supabase
    .from("cpi_records")
    .select("year, month, value, base_year")
    .or(
      `and(year.eq.${baseYear},month.eq.${baseMonth}),and(year.eq.${currentYear},month.eq.${currentMonth})`
    )
    .order("year").order("month");

  if (!rows || rows.length < 2) return null;

  // Find base and current records (same base_year preferred)
  const baseRow = rows.find(r => r.year === baseYear && r.month === baseMonth);
  const currentRow = rows.find(r => r.year === currentYear && r.month === currentMonth);

  if (!baseRow || !currentRow) return null;
  if (baseRow.value <= 0) return null;

  // If different base_years — check if we have link coefficients
  if (baseRow.base_year !== currentRow.base_year) {
    // For now return null — needs chain linking (handled in cpi-utils.ts)
    return null;
  }

  const ratio = currentRow.value / baseRow.value;
  const updatedAmount = amount * ratio;

  return {
    base_month: baseMonth, base_year: baseYear,
    current_month: currentMonth, current_year: currentYear,
    base_amount: amount,
    base_index: baseRow.value,
    current_index: currentRow.value,
    base_index_period: `${baseRow.base_year}=100`,
    ratio,
    updated_amount: updatedAmount,
    diff_amount: updatedAmount - amount,
    change_percent: (ratio - 1) * 100,
    source: "db",
    calculated_at: new Date().toISOString(),
  };
}

// ─── Base Year Change Detection ───────────────────────────────────────────────
async function checkForBaseYearChange(): Promise<{ changed: boolean; newBase?: number }> {
  try {
    // Get last 3 months from DB ordered by date desc
    const { data: recent } = await supabase
      .from("cpi_records")
      .select("year, month, value, base_year")
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(3);

    if (!recent || recent.length < 3) return { changed: false };

    // If newest value is dramatically lower than previous (e.g., 103 → 98)
    // while that's > 5% drop, likely a base year reset
    const newest = recent[0].value;
    const previous = recent[1].value;
    const drop = ((previous - newest) / previous) * 100;

    if (drop > 8 && newest < 102) {
      // Probable base year change — newest ~100
      return { changed: true, newBase: recent[0].year };
    }
    return { changed: false };
  } catch {
    return { changed: false };
  }
}

async function sendBaseChangeAlert(newBase: number) {
  await supabase.from("alerts").insert({
    title: "⚠️ שינוי תקופת בסיס מדד — נדרש עדכון מערכת",
    message: `הלמ"ס כנראה שינתה את תקופת הבסיס ל-${newBase}=100. יש להוסיף מקדם קשר חדש לטבלת cpi_link_coefficients ולעדכן BASE_YEAR בקוד. פנה למפתח המערכת.`,
    alert_type: "system",
    priority: "high",
    related_entity_type: "system",
  });
}

// ─── Main Route ───────────────────────────────────────────────────────────────
// GET /api/cpi-calc?base_month=3&base_year=2023&current_month=3&current_year=2024&amount=10000
// Returns full indexation breakdown for display in UI
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const baseMonth = parseInt(searchParams.get("base_month") ?? "0");
  const baseYear = parseInt(searchParams.get("base_year") ?? "0");
  const currentMonth = parseInt(searchParams.get("current_month") ?? "0");
  const currentYear = parseInt(searchParams.get("current_year") ?? "0");
  const amount = parseFloat(searchParams.get("amount") ?? "0");

  if (!baseMonth || !baseYear || !currentMonth || !currentYear || !amount) {
    return NextResponse.json({ error: "חסרים פרמטרים: base_month, base_year, current_month, current_year, amount" }, { status: 400 });
  }

  // 1. Try CBS API first (most accurate — handles all base year changes)
  const cbsResult = await calcViaCBSApi(baseMonth, baseYear, currentMonth, currentYear, amount);
  if (cbsResult) {
    return NextResponse.json(cbsResult);
  }

  // 2. Fallback to DB
  const dbResult = await calcViaDB(baseMonth, baseYear, currentMonth, currentYear, amount);
  if (dbResult) {
    // Check for base year change while we're here
    const { changed, newBase } = await checkForBaseYearChange();
    if (changed && newBase) {
      await sendBaseChangeAlert(newBase);
    }
    return NextResponse.json(dbResult);
  }

  return NextResponse.json({
    error: "לא נמצאו נתוני מדד לתאריכים המבוקשים",
    base_month: baseMonth, base_year: baseYear,
    current_month: currentMonth, current_year: currentYear,
  }, { status: 404 });
}

// POST /api/cpi-calc — batch calculation for multiple payments
// Body: { base_month, base_year, base_index_value, payments: [{month, year, amount}] }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { base_month, base_year, base_index_value, payments } = body;

    if (!base_month || !base_year || !payments?.length) {
      return NextResponse.json({ error: "חסרים שדות" }, { status: 400 });
    }

    const results = await Promise.all(
      payments.map(async (p: { month: number; year: number; amount: number; paid?: number }) => {
        const calc = await calcViaCBSApi(base_month, base_year, p.month, p.year, p.amount)
          ?? await calcViaDB(base_month, base_year, p.month, p.year, p.amount);

        if (!calc) return {
          month: p.month, year: p.year,
          amount: p.amount, paid: p.paid ?? 0,
          error: "לא נמצא מדד",
        };

        const paid = p.paid ?? 0;
        const diff = calc.updated_amount - paid;

        return {
          month: p.month,
          year: p.year,
          base_amount: p.amount,
          base_index: calc.base_index,
          current_index: calc.current_index,
          ratio: calc.ratio,
          indexed_amount: calc.updated_amount,
          paid,
          diff,               // positive = tenant owes, negative = overpaid
          change_percent: calc.change_percent,
          source: calc.source,
        };
      })
    );

    const totalIndexed = results.reduce((s, r) => s + (r.indexed_amount ?? 0), 0);
    const totalPaid = results.reduce((s, r) => s + (r.paid ?? 0), 0);
    const totalDiff = results.reduce((s, r) => s + (r.diff ?? 0), 0);

    return NextResponse.json({
      base_month, base_year, base_index_value,
      payments: results,
      summary: {
        total_indexed: totalIndexed,
        total_paid: totalPaid,
        total_diff: totalDiff,
        change_percent: base_index_value && results[results.length - 1]?.current_index
          ? ((results[results.length - 1].current_index - base_index_value) / base_index_value) * 100
          : null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
