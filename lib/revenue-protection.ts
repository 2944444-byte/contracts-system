// Rent protection on a turnover lease.
//
// Without it the minimum is a pure floor: a period whose turnover fell short
// charges nothing and the landlord keeps the minimum it already collected. With
// it the tenant is protected — the shortfall comes back — so the settlement gap
// is allowed to be negative for as long as the protection is in force.
//
// Two things end a protection: its own months running out, and an extension
// option that is agreed to cancel it. Whichever comes first wins.

export type RevenueProtectionType = "none" | "refund_gap";

export type RevenueProtection = {
  type: RevenueProtectionType;
  months: number | null;   // from the lease start; null = the whole lease
  notes: string | null;
};

export function emptyRevenueProtection(): RevenueProtection {
  return { type: "none", months: null, notes: null };
}

export function revenueProtectionFromRow(c: any): RevenueProtection {
  return {
    type: c?.revenue_protection_type === "refund_gap" ? "refund_gap" : "none",
    months: c?.revenue_protection_months != null ? Number(c.revenue_protection_months) : null,
    notes: c?.revenue_protection_notes ?? null,
  };
}

export function revenueProtectionToRow(p: RevenueProtection | null | undefined): Record<string, any> {
  const v = p ?? emptyRevenueProtection();
  return {
    revenue_protection_type: v.type || "none",
    revenue_protection_months: v.type === "none" ? null : (v.months ?? null),
    revenue_protection_notes: v.notes || null,
  };
}

export function hasRevenueProtection(p: RevenueProtection): boolean {
  return p.type === "refund_gap";
}

function addMonths(dateStr: string, months: number): Date {
  const d = new Date(dateStr);
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
}): { date: Date | null; reason: "months" | "option" | "lease" } {
  const { contract, protection } = params;
  if (!hasRevenueProtection(protection) || !contract?.start_date) return { date: null, reason: "lease" };

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
    const d = new Date(o.start_date);
    d.setDate(d.getDate() - 1);
    if (!byOption || d < byOption) byOption = d;
  }

  if (byMonths && byOption) return byOption < byMonths ? { date: byOption, reason: "option" } : { date: byMonths, reason: "months" };
  if (byOption) return { date: byOption, reason: "option" };
  if (byMonths) return { date: byMonths, reason: "months" };
  return { date: null, reason: "lease" };
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
  return new Date(params.periodEnd) <= date;
}

export function describeRevenueProtection(p: RevenueProtection, contract?: any, options?: any[]): string {
  if (!hasRevenueProtection(p)) return "";
  const parts: string[] = ["הגנה על שכ\"ד — פער שלילי מוחזר לשוכר"];
  if (p.months) parts.push(p.months + " חודשי שכירות");
  if (contract) {
    const { date, reason } = protectionEndsOn({ contract, protection: p, options });
    if (date) {
      parts.push("עד " + date.toLocaleDateString("he-IL") + (reason === "option" ? " (בוטלה במימוש אופציה)" : ""));
    } else {
      parts.push("לכל תקופת ההסכם");
    }
  }
  return parts.join(" · ");
}
