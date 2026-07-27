import { fetchCpiAdjustedWithRetry } from "@/lib/cpi-server";

// Compensation a tenant owes when an option is NOT exercised.
// Typical clause: "X ₪ per sqm per month for the whole first lease term, plus
// CPI linkage and VAT, payable within N days of the non-exercise notice."
// Everything here is data-driven — no contract, unit or amount is hardcoded.

export type PenaltyType = "none" | "per_sqm_month" | "fixed";
export type PenaltyBasis = "first_term" | "option_term" | "custom_months";

export type PenaltyTerms = {
  type: PenaltyType;
  value: number | null;      // ₪ per sqm per month, or the fixed total
  basis: PenaltyBasis;       // which period a per-month penalty covers
  months: number | null;     // used when basis = custom_months
  indexed: boolean;          // add CPI linkage
  vat: boolean;              // add VAT
  days: number;              // days to pay from the notice date
  notes: string | null;
};

export function emptyPenaltyTerms(): PenaltyTerms {
  return { type: "none", value: null, basis: "first_term", months: null, indexed: true, vat: true, days: 30, notes: null };
}

// Read the terms off a contract_options row (or an extraction result).
export function penaltyTermsFromRow(o: any): PenaltyTerms {
  if (!o) return emptyPenaltyTerms();
  const t = o.non_exercise_penalty_type;
  return {
    type: (t === "per_sqm_month" || t === "fixed") ? t : "none",
    value: o.non_exercise_penalty_value != null ? Number(o.non_exercise_penalty_value) : null,
    basis: (o.non_exercise_penalty_basis === "option_term" || o.non_exercise_penalty_basis === "custom_months")
      ? o.non_exercise_penalty_basis : "first_term",
    months: o.non_exercise_penalty_months != null ? Number(o.non_exercise_penalty_months) : null,
    indexed: o.non_exercise_penalty_indexed !== false,
    vat: o.non_exercise_penalty_vat !== false,
    days: o.non_exercise_penalty_days != null ? Number(o.non_exercise_penalty_days) : 30,
    notes: o.non_exercise_penalty_notes ?? null,
  };
}

// Map the UI/terms object onto contract_options columns.
export function penaltyTermsToRow(t: PenaltyTerms | undefined | null): Record<string, any> {
  const p = t ?? emptyPenaltyTerms();
  return {
    non_exercise_penalty_type: p.type || "none",
    non_exercise_penalty_value: p.type === "none" ? null : (p.value ?? null),
    non_exercise_penalty_basis: p.basis || "first_term",
    non_exercise_penalty_months: p.basis === "custom_months" ? (p.months ?? null) : null,
    non_exercise_penalty_indexed: p.indexed !== false,
    non_exercise_penalty_vat: p.vat !== false,
    non_exercise_penalty_days: p.days ?? 30,
    non_exercise_penalty_notes: p.notes || null,
  };
}

export function hasPenalty(t: PenaltyTerms): boolean {
  return t.type !== "none" && Number(t.value) > 0;
}

// Length of the contract's base (first) lease term in months, from
// lease_period_value/unit, falling back to the start/end dates.
export function baseTermMonths(contract: any): number {
  const v = Number(contract?.lease_period_value) || 0;
  const unit = contract?.lease_period_unit;
  if (v > 0) {
    if (unit === "years") return Math.round(v * 12);
    if (unit === "months") return Math.round(v);
  }
  if (contract?.start_date && contract?.end_date) {
    const s = new Date(contract.start_date), e = new Date(contract.end_date);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      const m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
      if (m > 0) return m;
    }
  }
  return 0;
}

// How many months the per-month penalty is charged for.
export function penaltyMonths(terms: PenaltyTerms, contract: any, option: any): number {
  if (terms.basis === "custom_months") return Math.max(0, Number(terms.months) || 0);
  if (terms.basis === "option_term") {
    const om = Number(option?.duration_months) || (Number(option?.duration_years) || 0) * 12;
    return Math.max(0, Math.round(om));
  }
  return baseTermMonths(contract);
}

// Leased area = sum of the contract's spaces. Accepts the contract_spaces shape
// used across the app (`spaces(area)`), so a contract over several units is
// charged on its full area rather than one unit's.
export function contractArea(contract: any): number {
  const rows = contract?.contract_spaces ?? [];
  var total = 0;
  for (const cs of rows) {
    const a = Number(cs?.spaces?.area ?? cs?.area ?? 0);
    if (a > 0) total += a;
  }
  return total;
}

// Format a date as MM-DD-YYYY for the CBS calculator (day 15 → 16, since CBS
// treats an index as "known" only from the 16th).
function toCbsDate(dateStr: string | Date): string | null {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  if (!d || isNaN(d.getTime())) return null;
  const x = new Date(d.getTime());
  if (x.getDate() === 15) x.setDate(16);
  return String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0") + "-" + x.getFullYear();
}

export type PenaltyCalc = {
  ok: boolean;
  error?: string;
  months: number;
  area: number;
  rawBase: number;       // before linkage
  cpiRatio: number;      // 1 when not indexed
  base: number;          // after linkage — the VAT-exclusive amount
  vatPct: number;        // 0 when no VAT
  vatAmount: number;
  total: number;
  dueDate: string;       // YYYY-MM-DD
  indexFrom?: string;    // CBS-resolved base index date
  indexTo?: string;      // CBS-resolved current index date
};

// Compute what the tenant owes. `noticeDate` is the tax point: the linkage runs
// up to it and the VAT rate in effect on it is the one applied (a penalty is
// billed when the non-exercise notice is given, not for a past rent period).
export async function computeOptionPenalty(params: {
  terms: PenaltyTerms;
  contract: any;
  option: any;
  area?: number;          // override the derived contract area
  vatPct: number;         // fraction, e.g. 0.18 — resolved by the caller at the notice date
  noticeDate?: Date;
}): Promise<PenaltyCalc> {
  const { terms, contract, option, vatPct } = params;
  const noticeDate = params.noticeDate ?? new Date();
  const dueDate = new Date(noticeDate.getTime() + (terms.days ?? 30) * 86400000);
  const dueStr = dueDate.getFullYear() + "-" + String(dueDate.getMonth() + 1).padStart(2, "0") + "-" + String(dueDate.getDate()).padStart(2, "0");

  const empty: PenaltyCalc = {
    ok: false, months: 0, area: 0, rawBase: 0, cpiRatio: 1, base: 0,
    vatPct: 0, vatAmount: 0, total: 0, dueDate: dueStr,
  };

  if (!hasPenalty(terms)) return { ...empty, error: "לא הוגדר פיצוי על אי מימוש עבור אופציה זו" };

  const area = params.area != null ? params.area : contractArea(contract);
  const months = terms.type === "per_sqm_month" ? penaltyMonths(terms, contract, option) : 0;

  var rawBase = 0;
  if (terms.type === "fixed") {
    rawBase = Number(terms.value) || 0;
  } else {
    if (!(area > 0)) return { ...empty, error: "לא נמצא שטח מושכר לחוזה — לא ניתן לחשב פיצוי לפי מ\"ר" };
    if (!(months > 0)) return { ...empty, error: "לא נמצאה תקופה לחישוב הפיצוי (תקופת שכירות ראשונה חסרה)" };
    rawBase = (Number(terms.value) || 0) * area * months;
  }

  var cpiRatio = 1;
  var indexFrom: string | undefined, indexTo: string | undefined;
  if (terms.indexed) {
    const fromRaw = contract?.index_base_date || contract?.start_date;
    const fromCbs = fromRaw ? toCbsDate(fromRaw) : null;
    const toCbs = toCbsDate(noticeDate);
    if (!fromCbs || !toCbs) {
      return { ...empty, error: "חסר מדד בסיס בחוזה — לא ניתן להצמיד את הפיצוי" };
    }
    // Same discipline as the advances calc: never silently fall back to ratio 1,
    // that would under-charge. Surface the failure and let the user retry.
    const res: any = await fetchCpiAdjustedWithRetry({ value: 10000, fromDate: fromCbs, toDate: toCbs });
    if (!res?.success) {
      return { ...empty, error: "שליפת מדד מהלמ\"ס נכשלה: " + (res?.error || "לא ידוע") };
    }
    cpiRatio = Number(res.adjustedRentPerSqm) / 10000;
    if (!(cpiRatio > 0)) return { ...empty, error: "התקבל יחס הצמדה לא תקין מהלמ\"ס" };
    indexFrom = res.fromDate || fromCbs;
    indexTo = res.toDate || toCbs;
  }

  const base = Math.round(rawBase * cpiRatio * 100) / 100;
  const pct = terms.vat ? vatPct : 0;
  const vatAmount = Math.round(base * pct * 100) / 100;
  const total = Math.round((base + vatAmount) * 100) / 100;

  return {
    ok: true, months, area, rawBase: Math.round(rawBase * 100) / 100, cpiRatio,
    base, vatPct: pct, vatAmount, total, dueDate: dueStr, indexFrom, indexTo,
  };
}

// One-line Hebrew summary of the terms, for the contract screen and letters.
export function describePenaltyTerms(terms: PenaltyTerms, contract?: any, option?: any): string {
  if (!hasPenalty(terms)) return "";
  const parts: string[] = [];
  if (terms.type === "per_sqm_month") {
    const m = contract ? penaltyMonths(terms, contract, option) : (terms.months || 0);
    parts.push(terms.value + " ₪ למ\"ר לחודש" + (m > 0 ? " × " + m + " חודשים" : ""));
  } else {
    parts.push(Number(terms.value).toLocaleString("he-IL") + " ₪ סכום קבוע");
  }
  if (terms.indexed) parts.push("צמוד למדד");
  if (terms.vat) parts.push("בתוספת מע\"מ");
  parts.push("לתשלום תוך " + (terms.days ?? 30) + " יום מההודעה");
  return parts.join(" · ");
}
