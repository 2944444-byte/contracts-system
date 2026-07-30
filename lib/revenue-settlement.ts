// Periodic settlement of a turnover lease (the "התחשבנות" clause).
//
// The tenant pays the base (minimum) rent monthly. At the end of each
// settlement period the two sides are restated to the index known on the
// settlement date and compared:
//
//   base_m = the minimum actually paid for month m, indexed from the index
//            known on the 1st of that month to the settlement-date index
//   alt_m  = that month's turnover share, indexed the same way
//
// If Σ alt > Σ base the tenant pays the difference, plus VAT, within the agreed
// number of days. If not, nothing is owed — the minimum already covered it.

export type SettlementFreq = "monthly" | "quarterly" | "semiannual" | "annual";

export const FREQ_MONTHS: Record<SettlementFreq, number> = {
  monthly: 1, quarterly: 3, semiannual: 6, annual: 12,
};

export const FREQ_LABELS: Record<SettlementFreq, string> = {
  monthly: "חודשית", quarterly: "רבעונית", semiannual: "חצי שנתית", annual: "שנתית",
};

export type SettlementPeriod = {
  key: string;             // "2026-Q1"
  label: string;           // "רבעון 1 2026"
  year: number;
  months: number[];        // 1-based calendar months in the period
  periodStart: string;     // YYYY-MM-01
  periodEnd: string;       // YYYY-MM-last
  settlementDate: string;  // when the settlement is drawn up
};

function lastDay(year: number, month1: number): string {
  const d = new Date(year, month1, 0);
  return year + "-" + String(month1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Every settlement period of a calendar year, with the date each one is drawn
// up (the agreed day of the month AFTER the period closes).
export function periodsForYear(year: number, freq: SettlementFreq, settlementDay: number = 15): SettlementPeriod[] {
  const size = FREQ_MONTHS[freq] || 1;
  const out: SettlementPeriod[] = [];
  const quarterLabel = ["", "רבעון 1", "רבעון 2", "רבעון 3", "רבעון 4"];
  const halfLabel = ["", "מחצית 1", "מחצית 2"];

  for (var startM = 1; startM <= 12; startM += size) {
    const months: number[] = [];
    for (var m = startM; m < startM + size && m <= 12; m++) months.push(m);
    const endM = months[months.length - 1];

    // The settlement happens in the month after the period closes.
    const sYear = endM === 12 ? year + 1 : year;
    const sMonth = endM === 12 ? 1 : endM + 1;
    const maxDay = new Date(sYear, sMonth, 0).getDate();
    const day = Math.min(Math.max(1, settlementDay || 15), maxDay);

    const idx = Math.floor((startM - 1) / size) + 1;
    const label = size === 3 ? quarterLabel[idx] + " " + year
      : size === 6 ? halfLabel[idx] + " " + year
      : size === 12 ? "שנת " + year
      : "חודש " + startM + "/" + year;

    out.push({
      key: year + "-" + freq + "-" + idx,
      label,
      year,
      months,
      periodStart: year + "-" + String(startM).padStart(2, "0") + "-01",
      periodEnd: lastDay(year, endM),
      settlementDate: sYear + "-" + String(sMonth).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
    });
  }
  return out;
}

export type SettlementMonthRow = {
  month: number;
  monthKey: string;        // YYYY-MM-01
  reported: boolean;
  base: number;            // minimum rent paid that month
  alt: number;             // turnover share that month
  ratio: number;           // index(settlement) / index(1st of month)
  indexedBase: number;
  indexedAlt: number;
};

export type SettlementCalc = {
  ok: boolean;
  error?: string;
  rows: SettlementMonthRow[];
  totalBase: number;
  totalAlt: number;
  difference: number;      // owed by the tenant when positive; never negative
  vatPct: number;
  vatAmount: number;
  total: number;
  dueDate: string;
  missingMonths: number[]; // months with no report — the settlement is partial
  unindexed: boolean;      // true when no ratio was available for some month
};

// `ratios` maps a month key (YYYY-MM-01) to index(settlementDate)/index(month).
// A month with no ratio is carried at 1 and flagged, rather than silently
// under-stating what the tenant owes.
export function computeSettlement(params: {
  period: SettlementPeriod;
  reports: any[];                        // revenue_reports rows for the period
  ratios: Record<string, number>;
  vatPct: number;
  dueDays?: number;                      // days from the demand (annex: 7)
  // What the month was ALREADY billed. Defaults to the month's full rent, so a
  // tenant who paid the turnover share directly settles to zero — using the
  // minimum here unconditionally made the whole share look unpaid. A
  // minimum-advance contract passes the minimum instead: the advance covered
  // that much, and the gap to the share is what is still owed.
  baseOf?: (rep: any) => number;
  // The turnover-based rent for the month. Must be the SAME figure the monthly
  // calculation weighs against the minimum — i.e. the share net of management
  // fees where those are included in the percentage. `calculated_rent` alone is
  // the share BEFORE that deduction and would overstate the gap.
  altOf?: (rep: any) => number;
}): SettlementCalc {
  const { period, reports, ratios, vatPct } = params;
  const baseOf = params.baseOf ?? function (rep: any) { return Number(rep?.final_rent) || 0; };
  const altOf = params.altOf ?? function (rep: any) { return Number(rep?.calculated_rent) || 0; };
  const rows: SettlementMonthRow[] = [];
  const missing: number[] = [];
  var unindexed = false;
  var totalBase = 0, totalAlt = 0;

  for (const m of period.months) {
    const key = period.year + "-" + String(m).padStart(2, "0") + "-01";
    const rep = reports.find(function(r: any) { return String(r.report_month).slice(0, 10) === key; });
    if (!rep) missing.push(m);

    const base = rep ? baseOf(rep) : 0;
    // What the turnover actually yielded, before the floor was applied.
    const alt = rep ? altOf(rep) : 0;
    const ratio = ratios[key] && ratios[key] > 0 ? ratios[key] : 1;
    if (!ratios[key]) unindexed = true;

    const indexedBase = Math.round(base * ratio * 100) / 100;
    const indexedAlt = Math.round(alt * ratio * 100) / 100;
    totalBase += indexedBase;
    totalAlt += indexedAlt;

    rows.push({ month: m, monthKey: key, reported: !!rep, base, alt, ratio, indexedBase, indexedAlt });
  }

  totalBase = Math.round(totalBase * 100) / 100;
  totalAlt = Math.round(totalAlt * 100) / 100;
  // One-directional: the minimum is a floor, so a period where turnover fell
  // short produces nothing to refund.
  const difference = Math.max(0, Math.round((totalAlt - totalBase) * 100) / 100);
  const vatAmount = Math.round(difference * vatPct * 100) / 100;

  const due = new Date(period.settlementDate);
  due.setDate(due.getDate() + (params.dueDays ?? 7));
  const dueDate = due.getFullYear() + "-" + String(due.getMonth() + 1).padStart(2, "0") + "-" + String(due.getDate()).padStart(2, "0");

  return {
    ok: true,
    rows, totalBase, totalAlt, difference,
    vatPct, vatAmount,
    total: Math.round((difference + vatAmount) * 100) / 100,
    dueDate,
    missingMonths: missing,
    unindexed,
  };
}
