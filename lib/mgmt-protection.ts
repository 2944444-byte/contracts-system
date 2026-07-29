// Management-fee protection: for a defined period the tenant's management cost
// is either fixed or capped ("management fees for the first 84 months shall not
// exceed 15 ₪/sqm, linked to the base index"). The protected rate is charged
// during the period; at the end it is reconciled against the property's ACTUAL
// cost, and any overpayment is refunded — the tenant never pays above the
// ceiling, so the landlord absorbs an overrun.

export type MgmtProtectionType = "none" | "fixed" | "cap";

export type MgmtProtection = {
  type: MgmtProtectionType;
  value: number | null;    // ₪ per sqm per month
  months: number | null;   // protection period, from contract start
  indexed: boolean;        // linked to the contract's base index
  notes: string | null;
};

export function emptyMgmtProtection(): MgmtProtection {
  return { type: "none", value: null, months: null, indexed: true, notes: null };
}

export function mgmtProtectionFromRow(c: any): MgmtProtection {
  const t = c?.mgmt_protection_type;
  return {
    type: (t === "fixed" || t === "cap") ? t : "none",
    value: c?.mgmt_protection_value != null ? Number(c.mgmt_protection_value) : null,
    months: c?.mgmt_protection_months != null ? Number(c.mgmt_protection_months) : null,
    indexed: c?.mgmt_protection_indexed !== false,
    notes: c?.mgmt_protection_notes ?? null,
  };
}

export function mgmtProtectionToRow(p: MgmtProtection | null | undefined): Record<string, any> {
  const v = p ?? emptyMgmtProtection();
  return {
    mgmt_protection_type: v.type || "none",
    mgmt_protection_value: v.type === "none" ? null : (v.value ?? null),
    mgmt_protection_months: v.type === "none" ? null : (v.months ?? null),
    mgmt_protection_indexed: v.indexed !== false,
    mgmt_protection_notes: v.notes || null,
  };
}

export function hasMgmtProtection(p: MgmtProtection): boolean {
  return p.type !== "none" && Number(p.value) > 0;
}

// Last day the protection applies (contract start + N months − 1 day).
export function protectionEndDate(contract: any, p: MgmtProtection): Date | null {
  if (!hasMgmtProtection(p) || !p.months || !contract?.start_date) return null;
  const s = new Date(contract.start_date);
  if (isNaN(s.getTime())) return null;
  const e = new Date(s.getFullYear(), s.getMonth() + p.months, s.getDate());
  e.setDate(e.getDate() - 1);
  return e;
}

// How many months of a calendar year fall inside the protection window — a
// protection that expires mid-year only caps that part of the year.
export function protectedMonthsInYear(contract: any, p: MgmtProtection, year: number): number {
  if (!hasMgmtProtection(p) || !contract?.start_date) return 0;
  const start = new Date(contract.start_date);
  const end = protectionEndDate(contract, p);
  if (!end) return 0;
  var months = 0;
  for (var m = 0; m < 12; m++) {
    const monthStart = new Date(year, m, 1);
    const monthEnd = new Date(year, m + 1, 0);
    // Count a month when the protection covers any part of it.
    if (monthEnd >= start && monthStart <= end) months++;
  }
  return months;
}

export type MgmtCeiling = {
  applies: boolean;
  months: number;        // protected months counted in the year
  ratePerSqm: number;    // after linkage
  amount: number;        // ceiling for the year: rate × area × months
  cpiRatio: number;
};

// The most the tenant may be charged for management in a given year.
// `cpiRatio` is the ratio from the contract's base index to the period —
// supplied by the caller, so this stays a pure function.
export function mgmtCeilingForYear(params: {
  contract: any;
  protection: MgmtProtection;
  area: number;
  year: number;
  cpiRatio?: number | null;
}): MgmtCeiling {
  const { contract, protection, area, year } = params;
  const none: MgmtCeiling = { applies: false, months: 0, ratePerSqm: 0, amount: 0, cpiRatio: 1 };
  if (!hasMgmtProtection(protection)) return none;

  const months = protectedMonthsInYear(contract, protection, year);
  if (months <= 0) return none;

  const ratio = protection.indexed && params.cpiRatio && params.cpiRatio > 0 ? params.cpiRatio : 1;
  const rate = Math.round((Number(protection.value) || 0) * ratio * 100) / 100;
  return {
    applies: true,
    months,
    ratePerSqm: rate,
    amount: Math.round(rate * (Number(area) || 0) * months * 100) / 100,
    cpiRatio: ratio,
  };
}

// Apply the protection to a year's reconciliation.
//   advance     — what the tenant already paid during the year
//   actualShare — the tenant's share of the property's real management cost
// Returns the share the tenant may actually be charged, and the amount the
// landlord absorbs because of the ceiling.
export function applyMgmtProtection(params: {
  advance: number;
  actualShare: number;
  ceiling: MgmtCeiling;
  type: MgmtProtectionType;
}): { chargeableShare: number; absorbed: number; capped: boolean } {
  const { advance, actualShare, ceiling, type } = params;
  if (!ceiling.applies) return { chargeableShare: actualShare, absorbed: 0, capped: false };

  // 'fixed' — the tenant owes exactly the protected amount, whatever the
  // property actually spent. 'cap' — the lower of actual and the ceiling.
  const chargeable = type === "fixed" ? ceiling.amount : Math.min(actualShare, ceiling.amount);
  const absorbed = Math.max(0, Math.round((actualShare - chargeable) * 100) / 100);
  return {
    chargeableShare: Math.round(chargeable * 100) / 100,
    absorbed,
    capped: absorbed > 0.009,
  };
}

export function describeMgmtProtection(p: MgmtProtection, contract?: any): string {
  if (!hasMgmtProtection(p)) return "";
  const parts: string[] = [];
  parts.push(p.type === "fixed"
    ? "דמי ניהול קבועים " + p.value + " ₪ למ\"ר"
    : "תקרת דמי ניהול " + p.value + " ₪ למ\"ר");
  if (p.months) parts.push(p.months + " חודשי שכירות ראשונים");
  // State the linkage either way — "no linkage" is a real term of the deal, not
  // an absence, and it changes what the tenant owes at reconciliation.
  parts.push(p.indexed ? "צמוד למדד הבסיס" : "ללא הצמדה (נומינלי)");
  if (contract) {
    const end = protectionEndDate(contract, p);
    if (end) parts.push("עד " + end.toLocaleDateString("he-IL"));
  }
  return parts.join(" · ");
}
