// "The contract requires a guarantee" and "the guarantee is in our hands" are
// two different facts, and the system treated them as one.
//
// A row created when the contract was drafted records what the tenant OWES:
// a ₪424,913 bank guarantee, a ₪849,827 promissory note. Until the paper
// actually arrives there is no security — no issuing bank, no expiry, no
// scanned document, and nothing collected. Marking such a row `active` made the
// screen show a valid guarantee for a contract that has none.
//
// This decides, per security, what is still missing.

export type GuaranteeGapCode =
  | "not_received"      // no amount actually in place
  | "shortfall"         // received less than required
  | "no_expiry"         // an instrument that must have one, without one
  | "expired"           // its expiry has passed
  | "no_document"       // nothing scanned/linked
  | "no_issuer";        // no bank / maker recorded

export type GuaranteeGap = { code: GuaranteeGapCode; label: string; blocking: boolean };

// Instruments that carry an expiry date. A promissory note and a cash deposit
// are open-ended by nature, so a missing date is not a gap for them.
export const TYPES_WITH_EXPIRY = ["bank", "insurance", "check"];

const TYPE_LABELS: Record<string, string> = {
  bank: "ערבות בנקאית", promissory_note: "שטר חוב", check: "שיקים",
  cash: "פיקדון מזומן", insurance: "ביטוח", personal: "ערבות אישית",
};

export function guaranteeTypeLabel(t: string): string { return TYPE_LABELS[t] || t || "ביטחון"; }

function hasDocument(g: any): boolean {
  if (g?.document_url) return true;
  const docs = g?.documents;
  return Array.isArray(docs) && docs.some(function (d: any) { return d && d.url; });
}

export function guaranteeGaps(g: any, today?: Date): GuaranteeGap[] {
  const out: GuaranteeGap[] = [];
  if (!g) return out;
  if (g.status && g.status !== "active") return out;      // returned/forfeited — not chased

  const required = Number(g.amount_required) || 0;
  const actual = Number(g.amount_actual) || 0;
  const label = guaranteeTypeLabel(g.guarantee_type);

  // Nothing required and nothing received → an empty row, not a gap.
  if (required <= 0 && actual <= 0) return out;

  if (actual <= 0) {
    out.push({ code: "not_received", label: label + " טרם התקבל", blocking: true });
  } else if (required > 0 && actual + 0.005 < required) {
    out.push({ code: "shortfall", label: "התקבל ₪" + actual.toLocaleString("he-IL") + " מתוך ₪" + required.toLocaleString("he-IL"), blocking: true });
  }

  if (TYPES_WITH_EXPIRY.indexOf(g.guarantee_type) !== -1) {
    if (!g.end_date) {
      out.push({ code: "no_expiry", label: "ללא תאריך תוקף", blocking: true });
    } else {
      const d = new Date(g.end_date);
      const t = today ? new Date(today) : new Date();
      d.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
      if (d < t) out.push({ code: "expired", label: "פג תוקף", blocking: true });
    }
    if (!g.bank) out.push({ code: "no_issuer", label: "לא הוזן בנק מוציא", blocking: false });
  }

  if (!hasDocument(g)) {
    out.push({ code: "no_document", label: "לא צורף מסמך", blocking: false });
  }

  return out;
}

// In our hands and valid — nothing blocking is missing.
export function guaranteeInPlace(g: any, today?: Date): boolean {
  return !guaranteeGaps(g, today).some(function (x) { return x.blocking; });
}

export function describeGaps(gaps: GuaranteeGap[]): string {
  return gaps.map(function (x) { return x.label; }).join(" · ");
}
