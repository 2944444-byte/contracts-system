// lib/cpi-utils.ts
// כלים לחישוב הצמדה למדד

const CBS_API = "https://api.cbs.gov.il/index/data/price?id=120010";

export async function fetchSingleCPI(year: number, month: number): Promise<number | null> {
  try {
    const from = `${year}-${String(month).padStart(2,"0")}`;
    const url  = `${CBS_API}&startPeriod=${from}&endPeriod=${from}&format=json`;
    const r    = await fetch(url);
    if (!r.ok) return null;
    const json = await r.json();
    const val  = json?.DataSet?.Series?.[0]?.obs?.[0]?.obsValue;
    return val ? Number(val) : null;
  } catch { return null; }
}

export async function fetchCPIRange(
  fromYear: number, fromMonth: number,
  toYear:   number, toMonth:   number
): Promise<{ year: number; month: number; value: number }[]> {
  try {
    const from = `${fromYear}-${String(fromMonth).padStart(2,"0")}`;
    const to   = `${toYear}-${String(toMonth).padStart(2,"0")}`;
    const url  = `${CBS_API}&startPeriod=${from}&endPeriod=${to}&format=json`;
    const r    = await fetch(url);
    if (!r.ok) return [];
    const json = await r.json();
    const obs  = json?.DataSet?.Series?.[0]?.obs ?? [];
    return obs.map(function(o: any) {
      const [y, m] = o.timePeriod.split("-").map(Number);
      return { year: y, month: m, value: Number(o.obsValue) };
    });
  } catch { return []; }
}

// כלל t-2: מדד קובע = 2 חודשים לפני תאריך תשלום
export function getT2Month(paymentDate: string): { year: number; month: number; label: string } {
  const d = new Date(paymentDate);
  d.setMonth(d.getMonth() - 2);
  return {
    year:  d.getFullYear(),
    month: d.getMonth() + 1,
    label: d.toLocaleDateString("he-IL", { year: "numeric", month: "long" }),
  };
}

// מנגנון מדד גבוה ביותר בתקופה
export async function fetchHighestCPI(
  baseDateStr: string,
  paymentDate: string
): Promise<{ value: number; year: number; month: number; allCount: number } | null> {
  const base = new Date(baseDateStr);
  const t2   = getT2Month(paymentDate);
  const all  = await fetchCPIRange(
    base.getFullYear(), base.getMonth() + 1,
    t2.year, t2.month
  );
  if (!all.length) return null;
  const highest = all.reduce(function(max, curr) { return curr.value > max.value ? curr : max; });
  return { ...highest, allCount: all.length };
}

// חישוב גרייס חלקי על ימים
export function calcGraceAmount(
  baseAmount:  number,
  gracePct:    number,
  periodFrom?: string,
  periodTo?:   string
): number {
  if (!gracePct) return baseAmount;
  return baseAmount * (1 - gracePct / 100);
}

// חישוב הצמדה מלא
export function calcIndexedRent(
  baseRentPerSqm: number,
  area:           number,
  baseIndex:      number,
  currentIndex:   number,
  vatPct:         number,
  mgmtFeePerSqm:  number = 0
): {
  baseAmount:    number;
  indexedAmount: number;
  mgmtAmount:    number;
  vatAmount:     number;
  total:         number;
  ratio:         number;
  increasePct:   number;
} {
  const ratio    = currentIndex / baseIndex;
  const base     = baseRentPerSqm * area;
  const indexed  = base * ratio;
  const mgmt     = mgmtFeePerSqm * area;
  const vat      = (indexed + mgmt) * (vatPct / 100);
  const total    = indexed + mgmt + vat;
  return {
    baseAmount:    base,
    indexedAmount: indexed,
    mgmtAmount:    mgmt,
    vatAmount:     vat,
    total,
    ratio,
    increasePct:   (ratio - 1) * 100,
  };
}
