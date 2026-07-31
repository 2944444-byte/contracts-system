// The turnover percentage can step up over the years, just like the minimum.
//
// A revenue lease has TWO figures that move independently:
//   · the minimum rent  — handled by lib/min-rent.ts, driven by the rent steps
//   · the percentage    — handled here
//
// Leases state the percentage in absolute terms ("3.5% for the first three
// years, 4% from the fourth"), so that is what a tier holds: the percentage
// itself, not an increment. A contract with no tiers simply keeps its single
// revenue_pct, so nothing changes for the contracts that already exist.

import { contractYearAt } from "@/lib/min-rent";

export type RevenuePctTier = {
  from_year: number;
  to_year: number;      // inclusive; 0/undefined = open-ended
  pct: number;          // the percentage in force during that range
  notes?: string | null;
};

export function emptyPctTier(fromYear: number): RevenuePctTier {
  return { from_year: fromYear, to_year: fromYear, pct: 0, notes: null };
}

export function pctTiersFromRow(c: any): RevenuePctTier[] {
  const raw = c?.revenue_pct_tiers;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(function (t: any) { return t && Number(t.pct) > 0; })
    .map(function (t: any) {
      return {
        from_year: Number(t.from_year) || 1,
        to_year: Number(t.to_year) || 0,
        pct: Number(t.pct) || 0,
        notes: t.notes ?? null,
      };
    })
    .sort(function (a, b) { return a.from_year - b.from_year; });
}

// The percentage in force on a date. Falls back to the flat percentage for any
// year no tier covers — including the years before the first tier starts.
export function revenuePctAtDate(params: {
  basePct: number;
  tiers: RevenuePctTier[] | any[];
  contractStart: string | Date;
  date: string | Date;
}): number {
  const base = Number(params.basePct) || 0;
  const tiers = Array.isArray(params.tiers) ? params.tiers : [];
  if (tiers.length === 0) return base;

  const year = contractYearAt(params.contractStart, params.date);
  var pct = base;
  const sorted = tiers.slice().sort(function (a: any, b: any) {
    return (Number(a.from_year) || 0) - (Number(b.from_year) || 0);
  });
  for (const t of sorted) {
    const from = Number(t.from_year) || 1;
    const to = Number(t.to_year) || 0;      // 0 = runs to the end of the lease
    if (from > year) break;
    if (to > 0 && to < year) continue;      // this range already ended
    if (Number(t.pct) > 0) pct = Number(t.pct);
  }
  return pct;
}

// Human-readable schedule, for the contract summary and the revenue screen.
export function describePctTiers(basePct: number, tiers: RevenuePctTier[] | any[]): string {
  const list = Array.isArray(tiers) ? tiers.slice().sort(function (a: any, b: any) {
    return (Number(a.from_year) || 0) - (Number(b.from_year) || 0);
  }) : [];
  if (list.length === 0) return (Number(basePct) || 0) + "% מהפדיון";

  const parts: string[] = [];
  const firstFrom = Number(list[0].from_year) || 1;
  if (firstFrom > 1) parts.push("שנים 1–" + (firstFrom - 1) + ": " + (Number(basePct) || 0) + "%");
  for (const t of list) {
    const from = Number(t.from_year) || 1;
    const to = Number(t.to_year) || 0;
    const range = to > 0 && to !== from ? "שנים " + from + "–" + to : to > 0 ? "שנה " + from : "משנה " + from + " ואילך";
    parts.push(range + ": " + (Number(t.pct) || 0) + "%");
  }
  return parts.join(" · ");
}

// Validation mirroring the rent-step validator: ranges must be sane, ordered
// and inside the lease.
export function validatePctTiers(tiers: RevenuePctTier[] | any[], contractYears: number): string[] {
  const errs: string[] = [];
  const list = Array.isArray(tiers) ? tiers : [];
  var prevTo = 0;
  list.slice()
    .sort(function (a: any, b: any) { return (Number(a.from_year) || 0) - (Number(b.from_year) || 0); })
    .forEach(function (t: any, i: number) {
      const from = Number(t.from_year) || 0;
      const to = Number(t.to_year) || 0;
      const label = "מדרגה " + (i + 1);
      if (from < 1) errs.push(label + ": שנת התחלה חייבת להיות 1 או יותר");
      if (to > 0 && to < from) errs.push(label + ': "עד שנה" קטן מ"משנה"');
      if (contractYears > 0 && from > contractYears) errs.push(label + ": חורג מתקופת החוזה (" + contractYears + " שנים)");
      if (from <= prevTo) errs.push(label + ": חופף למדרגה הקודמת");
      if (!(Number(t.pct) > 0)) errs.push(label + ": יש להזין אחוז");
      prevTo = to > 0 ? to : contractYears;
    });
  return errs;
}
