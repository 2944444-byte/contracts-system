// ויתורים והסדרים — waiving part or all of what a tenant owes.
//
// The rule that shapes everything here: a concession NEVER edits the charge it
// applies to. The original demand stays intact and the balance is derived —
//
//     יתרה = סה"כ − שולם − ויתור
//
// so the file always shows both what was demanded and what was given up, and a
// report can answer "how much did we waive in 2026, to whom, and why".
//
// Two shapes:
//   · item     — one existing row: a charge, a rent advance, a settlement gap
//   · standing — a contract-level discount over a period, applied to billing as
//                it is produced (50% off rent for three months of war), covering
//                fixed rent, a turnover share, management fees, or all of them.

export type ConcessionScope = "charge" | "advance" | "settlement" | "standing";
export type ConcessionMethod = "full" | "amount" | "percent";
export type ConcessionApplies = "rent" | "mgmt" | "revenue_share" | "all";
export type ConcessionReason =
  | "war" | "covid" | "compensation" | "goodwill" | "billing_error" | "dispute" | "other";

export const REASON_LABELS: Record<ConcessionReason, string> = {
  war: "מלחמה / מצב חירום",
  covid: "קורונה",
  compensation: "פיצוי לשוכר",
  goodwill: "מחווה מסחרית",
  billing_error: "טעות בחיוב",
  dispute: "פשרה במחלוקת",
  other: "אחר",
};

export const APPLIES_LABELS: Record<ConcessionApplies, string> = {
  rent: 'שכ"ד',
  mgmt: "דמי ניהול",
  revenue_share: "אחוז מהפדיון",
  all: "כל החיובים",
};

export type Concession = {
  id?: string;
  scope: ConcessionScope;
  charge_id?: string | null;
  advance_id?: string | null;
  contract_id: string;
  property_id?: string | null;
  applies_to?: ConcessionApplies | null;
  period_start?: string | null;
  period_end?: string | null;
  method: ConcessionMethod;
  percent?: number | null;
  base_amount?: number | null;
  vat_amount?: number | null;
  total_amount?: number | null;
  reason_code: ConcessionReason;
  reason_notes: string;
  document_url?: string | null;
  installments?: number | null;
  installment_first_date?: string | null;
  installment_notes?: string | null;
  status?: "active" | "cancelled";
};

function num(v: any): number { return Number(v) || 0; }

// What a concession gives up on a single item, split so VAT stays correct even
// though the invoice itself is handled outside the system.
export function concessionValue(params: {
  method: ConcessionMethod;
  percent?: number | null;
  amount?: number | null;      // before VAT, when method = 'amount'
  itemBase: number;            // the item's amount before VAT
  itemVat: number;             // the item's VAT
}): { base: number; vat: number; total: number } {
  const itemBase = num(params.itemBase);
  const itemVat = num(params.itemVat);

  if (params.method === "full") {
    return { base: itemBase, vat: itemVat, total: r2(itemBase + itemVat) };
  }
  if (params.method === "percent") {
    const p = Math.max(0, Math.min(100, num(params.percent))) / 100;
    return { base: r2(itemBase * p), vat: r2(itemVat * p), total: r2((itemBase + itemVat) * p) };
  }
  // A fixed sum off the net amount; VAT follows in proportion so the two stay
  // consistent with the item's own VAT rate.
  const base = Math.min(itemBase, Math.max(0, num(params.amount)));
  const vatRate = itemBase > 0 ? itemVat / itemBase : 0;
  const vat = r2(base * vatRate);
  return { base: r2(base), vat, total: r2(base + vat) };
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

// Total waived on one item — several concessions may stack (a partial waiver
// now, another later), and cancelled ones never count.
export function waivedTotalFor(concessions: any[] | null | undefined): number {
  var sum = 0;
  for (const c of (concessions || [])) {
    if (!c || c.status === "cancelled") continue;
    sum += num(c.total_amount);
  }
  return r2(sum);
}

// The balance a tenant actually owes on a charge. This is the figure every
// screen must use instead of total_amount.
export function chargeBalance(charge: any, concessions?: any[]): number {
  const total = num(charge?.total_amount);
  const paid = charge?.status === "paid" ? total : num(charge?.paid_amount);
  const waived = waivedTotalFor(concessions);
  return r2(Math.max(0, total - paid - waived));
}

// Is this charge fully settled — paid, waived, or a mix of both?
export function isSettled(charge: any, concessions?: any[]): boolean {
  return chargeBalance(charge, concessions) <= 0.005;
}

// ── Standing concessions ────────────────────────────────────────────────
// A period discount applied to billing as it is produced. Returns the factor to
// multiply by (0.5 = half price) and the flat amount to deduct, so both a
// percentage discount and a fixed monthly reduction are expressible.

export function standingConcessionsFor(params: {
  concessions: any[] | null | undefined;
  date: string | Date;
  kind: "rent" | "mgmt" | "revenue_share";
}): any[] {
  const t = new Date(params.date).getTime();
  return (params.concessions || []).filter(function (c: any) {
    if (!c || c.scope !== "standing" || c.status === "cancelled") return false;
    if (c.applies_to !== "all" && c.applies_to !== params.kind) return false;
    if (c.period_start && new Date(c.period_start).getTime() > t) return false;
    if (c.period_end && new Date(c.period_end).getTime() < t) return false;
    return true;
  });
}

// The discount in force on a date. `factor` multiplies the amount; `deduct` is a
// flat sum taken off afterwards. A 'full' concession returns factor 0.
export function standingDiscount(params: {
  concessions: any[] | null | undefined;
  date: string | Date;
  kind: "rent" | "mgmt" | "revenue_share";
}): { factor: number; deduct: number; applied: any[] } {
  const active = standingConcessionsFor(params);
  var factor = 1;
  var deduct = 0;
  for (const c of active) {
    if (c.method === "full") { factor = 0; }
    else if (c.method === "percent") { factor = factor * (1 - Math.max(0, Math.min(100, num(c.percent))) / 100); }
    else if (c.method === "amount") { deduct += num(c.base_amount); }
  }
  return { factor: Math.max(0, factor), deduct: r2(deduct), applied: active };
}

// Apply the standing discount to a monthly figure.
export function applyStanding(amount: number, disc: { factor: number; deduct: number }): number {
  return r2(Math.max(0, num(amount) * disc.factor - disc.deduct));
}

export function describeConcession(c: any): string {
  if (!c) return "";
  const parts: string[] = [];
  parts.push(c.method === "full" ? "ויתור מלא"
    : c.method === "percent" ? "ויתור " + num(c.percent) + "%"
    : "ויתור ₪" + num(c.base_amount).toLocaleString("he-IL"));
  if (num(c.total_amount) > 0) parts.push("₪" + num(c.total_amount).toLocaleString("he-IL") + ' כולל מע"מ');
  parts.push(REASON_LABELS[c.reason_code as ConcessionReason] || c.reason_code);
  if (c.scope === "standing") {
    parts.push(APPLIES_LABELS[c.applies_to as ConcessionApplies] || "");
    if (c.period_start || c.period_end) {
      parts.push((c.period_start ? new Date(c.period_start).toLocaleDateString("he-IL") : "") +
        " – " + (c.period_end ? new Date(c.period_end).toLocaleDateString("he-IL") : "ללא סיום"));
    }
  }
  if (num(c.installments) > 1) parts.push("היתרה ב-" + num(c.installments) + " תשלומים");
  if (c.status === "cancelled") parts.push("(בוטל)");
  return parts.filter(Boolean).join(" · ");
}

// Permission to grant concessions. Admins always may; anyone else needs the
// flag switched on for them in settings.
export function canGrantConcessions(perm: { role?: string; permissions?: any } | null | undefined): boolean {
  if (!perm) return false;
  if (perm.role === "admin") return true;
  return !!(perm.permissions && perm.permissions.can_grant_concessions);
}
