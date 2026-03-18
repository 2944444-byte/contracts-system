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
 * שליפת המדד הגבוה ביותר בתקופה (לפי שיטת "מדד גבוה ביותר")
 */
export async function fetchHighestCPI(fromYear: number, fromMonth: number, toYear: number, toMonth: number): Promise<number | null> {
  try {
    const from = `${fromYear}/${String(fromMonth).padStart(2,"0")}`;
    const to   = `${toYear}/${String(toMonth).padStart(2,"0")}`;
    const url  = `https://api.cbs.gov.il/index/data/price?id=120010&startPeriod=${from}&endPeriod=${to}&format=json&download=false&lang=he`;
    const res  = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = data?.DataSet?.Series?.[0]?.obs ?? [];
    if (!rows.length) return null;
    const values = rows.map(function(r: any) { return parseFloat(r.obsValue ?? r.value ?? "0"); });
    return Math.max(...values);
  } catch {
    return null;
  }
}

/**
 * חישוב שכ"ד מוצמד
 * כלל t-2: מדד קובע = 2 חודשים לפני תאריך התשלום
 */
export function calcIndexedRent(baseRent: number, baseCPI: number, currentCPI: number): number {
  if (!baseCPI || !currentCPI) return baseRent;
  return baseRent * (currentCPI / baseCPI);
}

/**
 * קבלת חודש t-2 לפי תאריך תשלום
 */
export function getT2Month(paymentDate: Date): { year: number; month: number } {
  const d = new Date(paymentDate);
  d.setMonth(d.getMonth() - 2);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * פורמט תקופה לתצוגה
 */
export function formatPeriod(year: number, month: number): string {
  const months = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  return `${months[month]} ${year}`;
}
