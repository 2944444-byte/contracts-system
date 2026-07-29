import { fetchCpiAdjustedWithRetry } from "@/lib/cpi-server";

// The landlord funds tenant improvements against a minimum stay. If the tenant
// leaves before that window closes — typically by not exercising an option —
// the unearned part comes back:
//
//   S = (X / H) × (H − months actually rented)
//
// X = the funded amount, H = the agreed commitment window in months (per deal:
// often 120, 96 in the annex this was modelled on). Plus VAT, and linked from
// the day the money reached the tenant to the day it is repaid.

export type ClawbackTerms = {
  months: number | null;       // H
  indexed: boolean;
  vat: boolean;
  indexFrom: string | null;    // overrides the payment date as the linkage start
  notes: string | null;
};

export function clawbackTermsFromRow(ti: any): ClawbackTerms {
  return {
    months: ti?.clawback_months != null ? Number(ti.clawback_months) : null,
    indexed: ti?.clawback_indexed !== false,
    vat: ti?.clawback_vat !== false,
    indexFrom: ti?.clawback_index_from ? String(ti.clawback_index_from).slice(0, 10) : null,
    notes: ti?.clawback_notes ?? null,
  };
}

export function clawbackTermsToRow(t: ClawbackTerms | null | undefined): Record<string, any> {
  const v = t ?? { months: null, indexed: true, vat: true, indexFrom: null, notes: null };
  return {
    clawback_months: v.months ?? null,
    clawback_indexed: v.indexed !== false,
    clawback_vat: v.vat !== false,
    clawback_index_from: v.indexFrom || null,
    clawback_notes: v.notes || null,
  };
}

export function hasClawback(t: ClawbackTerms): boolean {
  return !!t.months && t.months > 0;
}

// Whole months the tenant actually held the premises, from the lease start to
// the exit date. Partial months count only when complete — the annex counts
// rented months, not calendar fragments.
export function monthsRented(startDate: string | Date, exitDate: string | Date): number {
  const s = new Date(startDate), e = new Date(exitDate);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  var m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) m -= 1;
  return Math.max(0, m);
}

export type ClawbackCalc = {
  ok: boolean;
  error?: string;
  fundedAmount: number;
  commitmentMonths: number;
  monthsRented: number;
  monthsRemaining: number;
  perMonth: number;
  rawBase: number;      // before linkage
  cpiRatio: number;
  base: number;         // after linkage
  vatPct: number;
  vatAmount: number;
  total: number;
};

function toCbsDate(d: string | Date): string | null {
  const x = typeof d === "string" ? new Date(d) : new Date(d.getTime());
  if (isNaN(x.getTime())) return null;
  if (x.getDate() === 15) x.setDate(16);
  return String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0") + "-" + x.getFullYear();
}

// What the tenant owes for leaving at `exitDate`.
export async function computeInvestmentClawback(params: {
  ti: any;               // contract_ti row (funded amount + terms)
  contract: any;         // needs start_date
  exitDate: Date;
  vatPct: number;        // fraction, resolved by the caller at the demand date
}): Promise<ClawbackCalc> {
  const { ti, contract, exitDate, vatPct } = params;
  const terms = clawbackTermsFromRow(ti);
  const empty: ClawbackCalc = {
    ok: false, fundedAmount: 0, commitmentMonths: 0, monthsRented: 0, monthsRemaining: 0,
    perMonth: 0, rawBase: 0, cpiRatio: 1, base: 0, vatPct: 0, vatAmount: 0, total: 0,
  };

  // What the landlord actually paid out, falling back to the agreed amount.
  const funded = Number(ti?.paid_amount) > 0 ? Number(ti.paid_amount) : Number(ti?.ti_amount) || 0;
  if (!(funded > 0)) return { ...empty, error: "לא נרשם סכום השקעה" };
  if (!hasClawback(terms)) return { ...empty, error: "לא הוגדרה תקופת התחייבות להחזר השקעות" };
  if (!contract?.start_date) return { ...empty, error: "לחוזה אין תאריך תחילה" };

  const H = Number(terms.months);
  const rented = monthsRented(contract.start_date, exitDate);
  const remaining = Math.max(0, H - rented);
  const perMonth = funded / H;
  const rawBase = Math.round(perMonth * remaining * 100) / 100;

  if (remaining <= 0) {
    return { ...empty, ok: true, fundedAmount: funded, commitmentMonths: H, monthsRented: rented,
      monthsRemaining: 0, perMonth: Math.round(perMonth * 100) / 100 };
  }

  var cpiRatio = 1;
  if (terms.indexed) {
    // Linkage runs from the day the funds were made available.
    const fromRaw = terms.indexFrom || ti?.paid_at || ti?.payment_due_date || contract.start_date;
    const fromCbs = toCbsDate(fromRaw);
    const toCbs = toCbsDate(exitDate);
    if (!fromCbs || !toCbs) return { ...empty, error: "חסר תאריך העמדת ההשקעה — לא ניתן להצמיד" };
    const res: any = await fetchCpiAdjustedWithRetry({ value: 10000, fromDate: fromCbs, toDate: toCbs });
    if (!res?.success) return { ...empty, error: "שליפת מדד מהלמ\"ס נכשלה: " + (res?.error || "לא ידוע") };
    cpiRatio = Number(res.adjustedRentPerSqm) / 10000;
    if (!(cpiRatio > 0)) return { ...empty, error: "התקבל יחס הצמדה לא תקין" };
  }

  const base = Math.round(rawBase * cpiRatio * 100) / 100;
  const pct = terms.vat ? vatPct : 0;
  const vatAmount = Math.round(base * pct * 100) / 100;

  return {
    ok: true,
    fundedAmount: funded,
    commitmentMonths: H,
    monthsRented: rented,
    monthsRemaining: remaining,
    perMonth: Math.round(perMonth * 100) / 100,
    rawBase, cpiRatio, base,
    vatPct: pct, vatAmount,
    total: Math.round((base + vatAmount) * 100) / 100,
  };
}

export function describeClawback(terms: ClawbackTerms, ti?: any): string {
  if (!hasClawback(terms)) return "";
  const funded = Number(ti?.paid_amount) > 0 ? Number(ti.paid_amount) : Number(ti?.ti_amount) || 0;
  const parts: string[] = [];
  if (funded > 0) parts.push("השקעה " + funded.toLocaleString("he-IL") + " ₪");
  parts.push("התחייבות " + terms.months + " חודשים");
  parts.push("ביציאה מוקדמת מוחזר יחסית לחודשים שנותרו");
  if (terms.indexed) parts.push("צמוד למדד ממועד ההעמדה");
  if (terms.vat) parts.push("בתוספת מע\"מ");
  return parts.join(" · ");
}
