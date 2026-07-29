import { getKnownIndexMonth, formatPeriod } from "@/lib/cpi-utils";

// Some leases don't fix the base index at signing. Instead the contract says
// something like "the index known 18 months before the premises open" — a date
// nobody knows until the unit is actually handed over. This module turns that
// rule into a concrete base month + value once the milestone date exists.
//
// index_base_date / index_base_value remain the single source of truth for every
// downstream calculation; this only decides what to write into them.

export type BaseIndexAnchor = "actual_handover" | "planned_handover" | "rent_start";

export const ANCHOR_LABELS: Record<BaseIndexAnchor, string> = {
  actual_handover: "מועד המסירה בפועל",
  planned_handover: "מועד מסירה מתוכנן",
  rent_start: "מועד תחילת תשלום שכ\"ד",
};

export type BaseIndexRule = {
  mode: "fixed" | "derived";
  anchor: BaseIndexAnchor;
  offsetMonths: number | null;   // months BEFORE the anchor date
};

export function baseIndexRuleFromRow(c: any): BaseIndexRule {
  return {
    mode: c?.index_base_mode === "derived" ? "derived" : "fixed",
    anchor: (c?.index_base_anchor as BaseIndexAnchor) || "actual_handover",
    offsetMonths: c?.index_base_offset_months != null ? Number(c.index_base_offset_months) : null,
  };
}

export function baseIndexRuleToRow(r: BaseIndexRule): Record<string, any> {
  return {
    index_base_mode: r.mode || "fixed",
    index_base_anchor: r.anchor || "actual_handover",
    index_base_offset_months: r.mode === "derived" ? (r.offsetMonths ?? null) : null,
  };
}

// The milestone date the rule counts back from.
export function anchorDate(c: any, anchor: BaseIndexAnchor): string | null {
  const v = anchor === "actual_handover" ? c?.actual_handover_date
    : anchor === "planned_handover" ? c?.planned_handover_date
    : c?.start_date;
  return v ? String(v).slice(0, 10) : null;
}

// Subtract N months from a date, clamping the day (31.3 − 1 month → 28/29.2).
function minusMonths(dateStr: string, months: number): Date {
  const d = new Date(dateStr);
  const day = d.getDate();
  const shifted = new Date(d.getFullYear(), d.getMonth() - months, 1);
  const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, lastDay));
  return shifted;
}

export type ResolvedBaseIndex = {
  ok: boolean;
  reason?: string;
  cutoffDate?: string;    // anchor − offset months (the "known as of" date)
  baseYear?: number;      // the CPI month that was published/known by then
  baseMonth?: number;
  baseLabel?: string;     // "מאי 2024"
  baseDateForDb?: string; // YYYY-MM-01 written into index_base_date
};

// Resolve the rule to a concrete base month. Two steps, both taken from the
// contract wording: step back `offsetMonths` from the anchor, then take the
// index KNOWN on that date (CBS publishes month X on the 15th of X+1, so a date
// on/after the 16th knows month−1, earlier knows month−2).
export function resolveBaseIndexMonth(params: {
  rule: BaseIndexRule;
  contract: any;
}): ResolvedBaseIndex {
  const { rule, contract } = params;
  if (rule.mode !== "derived") return { ok: false, reason: "מדד הבסיס אינו נגזר — הוזן ידנית" };
  if (!rule.offsetMonths || rule.offsetMonths < 0) return { ok: false, reason: "לא הוגדר מספר חודשים אחורה" };

  const anchor = anchorDate(contract, rule.anchor);
  if (!anchor) {
    return { ok: false, reason: ANCHOR_LABELS[rule.anchor] + " טרם נקבע — מדד הבסיס ייקבע כשיוזן" };
  }

  const cutoff = minusMonths(anchor, rule.offsetMonths);
  const known = getKnownIndexMonth(cutoff);
  const cutoffStr = cutoff.getFullYear() + "-" + String(cutoff.getMonth() + 1).padStart(2, "0") + "-" + String(cutoff.getDate()).padStart(2, "0");

  return {
    ok: true,
    cutoffDate: cutoffStr,
    baseYear: known.year,
    baseMonth: known.month,
    baseLabel: formatPeriod(known.year, known.month),
    baseDateForDb: known.year + "-" + String(known.month).padStart(2, "0") + "-01",
  };
}

// Human-readable description of the rule, for the contract screen and forms.
export function describeBaseIndexRule(rule: BaseIndexRule, contract?: any): string {
  if (rule.mode !== "derived") return "";
  const head = "מדד הבסיס = המדד הידוע " + (rule.offsetMonths ?? "—") + " חודשים לפני " + ANCHOR_LABELS[rule.anchor];
  if (!contract) return head;
  const res = resolveBaseIndexMonth({ rule, contract });
  if (!res.ok) return head + " · " + (res.reason || "");
  return head + " · נקבע: מדד " + res.baseLabel + " (ידוע ליום " + res.cutoffDate + ")";
}

// True when the contract needs a base index but it can't be determined yet —
// every rent/linkage figure for it is provisional until the milestone lands.
export function baseIndexPending(c: any): boolean {
  if (c?.indexation_method === "none") return false;
  const rule = baseIndexRuleFromRow(c);
  if (rule.mode !== "derived") return false;
  if (c?.index_base_value) return false;
  return !resolveBaseIndexMonth({ rule, contract: c }).ok || !c?.index_base_date;
}
