// Rent protection on a turnover lease.
//
// Without it the minimum is a pure floor: a period whose turnover fell short
// charges nothing and the landlord keeps the minimum it already collected. With
// it the tenant is protected — the shortfall comes back — so the settlement gap
// is allowed to be negative for as long as the protection is in force.
//
// Three things end a protection, whichever comes FIRST:
//   · its own months running out
//   · an extension option agreed to cancel it
//   · the project reaching an agreed occupancy level
//
// That third one is the same clause as "עד לאיכלוס 60% משטחי הפרויקט ישלם השוכר
// דמי שכירות חליפיים בלבד". It belongs here rather than in a mechanism of its
// own: both say "for this window the tenant pays the turnover share with no
// floor", and they differ only in what closes the window — a fixed number of
// months, or an event in the project. Keeping them apart meant two blocks in the
// form that a reader could not tell apart.
//
// The two effects it can have are NOT interchangeable, and the difference is
// mechanical, not commercial:
//   · when the minimum is collected monthly as an advance, the money is already
//     in — so the gap comes back at settlement (refund_gap)
//   · when it is not, there is nothing to refund and the floor is simply absent
//     (see minimumApplies in lib/project-occupancy)
// Both end on the same date, which is what makes them consistent.

export type RevenueProtectionType = "none" | "refund_gap";

export type RevenueProtection = {
  type: RevenueProtectionType;
  months: number | null;   // from the lease start; null = the whole lease
  notes: string | null;
  // Ends when the project reaches this occupancy. Stored in the
  // min_rent_condition_* columns, so the two views of the same clause can never
  // disagree with each other.
  untilOccupancyPct: number | null;
  occupancyMetAt: string | null;
};

export function emptyRevenueProtection(): RevenueProtection {
  return { type: "none", months: null, notes: null, untilOccupancyPct: null, occupancyMetAt: null };
}

export function revenueProtectionFromRow(c: any): RevenueProtection {
  return {
    type: c?.revenue_protection_type === "refund_gap" ? "refund_gap" : "none",
    months: c?.revenue_protection_months != null ? Number(c.revenue_protection_months) : null,
    notes: c?.revenue_protection_notes ?? null,
    untilOccupancyPct: c?.min_rent_condition_type === "project_occupancy_pct"
      ? (c?.min_rent_condition_pct != null ? Number(c.min_rent_condition_pct) : null) : null,
    occupancyMetAt: c?.min_rent_condition_met_at ?? null,
  };
}

export function revenueProtectionToRow(p: RevenueProtection | null | undefined): Record<string, any> {
  const v = p ?? emptyRevenueProtection();
  return {
    revenue_protection_type: v.type || "none",
    revenue_protection_months: v.type === "none" ? null : (v.months ?? null),
    revenue_protection_notes: v.notes || null,
    // The occupancy end-condition lives in its own columns; writing them here
    // keeps one save path for the whole clause.
    min_rent_condition_type: (Number(v.untilOccupancyPct) || 0) > 0 ? "project_occupancy_pct" : null,
    min_rent_condition_pct: (Number(v.untilOccupancyPct) || 0) > 0 ? Number(v.untilOccupancyPct) : null,
    min_rent_condition_met_at: (Number(v.untilOccupancyPct) || 0) > 0 ? (v.occupancyMetAt || null) : null,
  };
}

export function hasRevenueProtection(p: RevenueProtection): boolean {
  return p.type === "refund_gap";
}

// Is there a window at all — by either route?
export function hasAnyAlternativeRent(p: RevenueProtection): boolean {
  return hasRevenueProtection(p) || (Number(p.untilOccupancyPct) || 0) > 0;
}

// A date-only string must land on LOCAL midnight. new Date("2026-02-28") is UTC
// midnight = 02:00 in Israel, which made a settlement period ending exactly on
// the protection's last day compare as AFTER it — the tenant lost the refund
// right for that whole period.
function dLocal(v: any): Date | null {
  if (!v) return null;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const x = new Date(v);
  return isNaN(x.getTime()) ? null : new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

function addMonths(dateStr: string, months: number): Date {
  const d = dLocal(dateStr) || new Date(dateStr);
  const day = d.getDate();
  const shifted = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, last));
  return shifted;
}

// The day the protection stops covering. Returns null when it runs for the whole
// lease and nothing cancels it. `options` are contract_options rows: an EXERCISED
// option flagged to cancel the protection ends it on the day that option starts.
export function protectionEndsOn(params: {
  contract: any;
  protection: RevenueProtection;
  options?: any[];
}): { date: Date | null; reason: "months" | "option" | "occupancy" | "lease" } {
  const { contract, protection } = params;
  if (!hasAnyAlternativeRent(protection) || !contract?.start_date) return { date: null, reason: "lease" };

  var byMonths: Date | null = null;
  if (protection.months && protection.months > 0) {
    byMonths = addMonths(contract.start_date, protection.months);
    byMonths.setDate(byMonths.getDate() - 1);
  }

  // An exercised cancelling option ends it the day its term begins.
  var byOption: Date | null = null;
  for (const o of (params.options ?? [])) {
    if (!o?.cancels_revenue_protection) continue;
    const exercised = o.is_exercised || o.status === "exercised";
    if (!exercised || !o.start_date) continue;
    const d = dLocal(o.start_date);
    if (!d) continue;
    d.setDate(d.getDate() - 1);
    if (!byOption || d < byOption) byOption = d;
  }

  // The occupancy threshold, once it has been reached and recorded. The window
  // closes the day BEFORE the floor starts applying, so the two never overlap.
  var byOccupancy: Date | null = null;
  if ((Number(protection.untilOccupancyPct) || 0) > 0 && protection.occupancyMetAt) {
    byOccupancy = dLocal(protection.occupancyMetAt);
    if (byOccupancy) byOccupancy.setDate(byOccupancy.getDate() - 1);
  }

  // Whichever comes first.
  const cands: { date: Date; reason: "months" | "option" | "occupancy" }[] = [];
  if (byMonths) cands.push({ date: byMonths, reason: "months" });
  if (byOption) cands.push({ date: byOption, reason: "option" });
  if (byOccupancy) cands.push({ date: byOccupancy, reason: "occupancy" });
  if (cands.length === 0) return { date: null, reason: "lease" };
  cands.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });
  return cands[0];
}

// Is a settlement period covered? A period is protected when its END is still
// inside the window — a period straddling the end is settled without protection,
// which is the conservative reading (the refund right had lapsed by the time the
// settlement was drawn up).
export function isPeriodProtected(params: {
  contract: any;
  protection: RevenueProtection;
  options?: any[];
  periodEnd: string;
}): boolean {
  if (!hasRevenueProtection(params.protection)) return false;
  const { date } = protectionEndsOn(params);
  if (!date) return true;                        // runs for the whole lease
  const pe = dLocal(params.periodEnd);
  if (!pe) return false;
  return pe.getTime() <= date.getTime();
}

export function describeRevenueProtection(p: RevenueProtection, contract?: any, options?: any[]): string {
  if (!hasRevenueProtection(p)) return "";
  const parts: string[] = ["הגנה על שכ\"ד — פער שלילי מוחזר לשוכר"];
  if (p.months) parts.push(p.months + " חודשי שכירות");
  if ((Number(p.untilOccupancyPct) || 0) > 0) {
    parts.push("עד " + p.untilOccupancyPct + "% איכלוס בפרויקט" +
      (p.occupancyMetAt ? "" : " (המועד טרם אושר)"));
  }
  if (contract) {
    const { date, reason } = protectionEndsOn({ contract, protection: p, options });
    if (date) {
      parts.push("עד " + date.toLocaleDateString("he-IL") +
        (reason === "option" ? " (בוטלה במימוש אופציה)"
         : reason === "occupancy" ? " (הפרויקט הגיע לאיכלוס המוסכם)" : ""));
    } else {
      parts.push("לכל תקופת ההסכם");
    }
  }
  return parts.join(" · ");
}
