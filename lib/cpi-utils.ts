// lib/cpi-utils.ts
// CBS API: https://api.cbs.gov.il/index/data/price?id=120010

export interface CPIRecord {
  period: string;  // "YYYY/MM"
  value:  number;
}

/**
 * שליפת מדד לפי חודש ספציפי (t-2)
 */
export async function fetchCPI(year: number, month: number): Promise<number | null> {
  try {
    const url = `https://api.cbs.gov.il/index/data/price?id=120010&startPeriod=${year}/${String(month).padStart(2,"0")}&endPeriod=${year}/${String(month).padStart(2,"0")}&format=json&download=false&lang=he`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = data?.DataSet?.Series?.[0]?.obs ?? [];
    if (!rows.length) return null;
    return parseFloat(rows[0].obsValue ?? rows[0].value ?? "0");
  } catch {
    return null;
  }
}

/**
 * @deprecated DO NOT USE — returns null intentionally.
 *
 * Originally meant to fetch the highest published CPI value in a date range
 * for "highest_in_period" contracts, but had two fundamental problems:
 *
 *   1. The URL it used (`startPeriod=YYYY/MM&endPeriod=YYYY/MM`) returns an
 *      HTML error page from CBS — not JSON. Every call ended up in the
 *      `catch` block and returned null silently.
 *
 *   2. Even if the URL worked, the returned values would be raw published
 *      CPI values under DIFFERENT base years (Israeli CPI re-bases every 2
 *      years). Comparing raw values across base years is invalid — e.g.,
 *      Oct-24 = 109.1 (base 2022) appears > Apr-25 = 103.1 (base 2024) but
 *      the chained values are actually 115.88 < 117.61.
 *
 * For "highest_in_period" calculations use `fetchHighestChainedCpi` in
 * `lib/cpi-server.ts` instead — it scans chained values via CBS calculator.
 *
 * This function is kept (returning null) only to avoid breaking call sites
 * that haven't been migrated yet (notably AdvancesTab, which has been
 * thoroughly verified by the user with this function returning null and
 * MUST NOT have its calculation behaviour changed).
 */
export async function fetchHighestCPI(_fromYear: number, _fromMonth: number, _toYear: number, _toMonth: number): Promise<number | null> {
  return null;
}

/**
 * חישוב שכ"ד מוצמד — נוסחת הלמ"ס עם מקדם קשר
 * adjusted = baseRent × (currentCPI × chainingCoeff) / baseCPI
 * מקדם הקשר מגשר בין שנות בסיס שונות (למשל 2018→2024)
 */
export function calcIndexedRent(baseRent: number, baseCPI: number, currentCPI: number, chainingCoeff: number = 1): number {
  if (!baseCPI || !currentCPI) return baseRent;
  return baseRent * (currentCPI * chainingCoeff) / baseCPI;
}

/**
 * חישוב מקדם קשר מצטבר בין שנות בסיס
 * @param fromBaseYear - שנת בסיס של המדד הנוכחי (למשל 2024)
 * @param toBaseYear - שנת בסיס של מדד הבסיס (למשל 2018)
 * @param coefficients - רשימת מקדמי קשר מה-DB
 */
export function calcChainingCoefficient(
  fromBaseYear: number,
  toBaseYear: number,
  coefficients: Array<{ from_base_year: number; to_base_year: number; coefficient: string | number }>
): number {
  if (fromBaseYear === toBaseYear) return 1;
  var result = 1.0;
  var year = fromBaseYear;
  var maxSteps = 20;
  while (year !== toBaseYear && maxSteps-- > 0) {
    var link = coefficients.find(function(c) { return c.from_base_year === year; });
    if (!link) break;
    result *= Number(link.coefficient);
    year = link.to_base_year;
  }
  return result;
}

/**
 * "מדד ידוע" — המדד שפורסם נכון לתאריך נתון.
 * מדד בגין חודש X מתפרסם ב-15 לחודש X+1.
 * אם התאריך מה-15 והלאה → מדד ידוע = חודש קודם.
 * אם התאריך לפני ה-15 → מדד ידוע = 2 חודשים אחורה.
 */
export function getKnownIndexMonth(date: Date): { year: number; month: number } {
  const d = new Date(date);
  // CBS publishes CPI for month X on the 15th of month X+1.
  // The index is considered "known" starting from the 16th (not the 15th).
  const monthsBack = d.getDate() >= 16 ? 1 : 2;
  d.setMonth(d.getMonth() - monthsBack);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * @deprecated Use getKnownIndexMonth instead
 */
export function getT2Month(paymentDate: Date): { year: number; month: number } {
  return getKnownIndexMonth(paymentDate);
}

/**
 * פורמט תקופה לתצוגה
 */
export function formatPeriod(year: number, month: number): string {
  const months = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  return `${months[month]} ${year}`;
}
