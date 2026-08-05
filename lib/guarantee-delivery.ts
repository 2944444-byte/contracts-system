// When is a security actually due?
//
// Almost no lease requires the guarantee at signing. The wording ties it to a
// milestone — "הערבות הבנקאית תמסר במועד הקבוע להשלמת עבודות השוכר, וכנגד תשלום
// השתתפות המשכיר" — or to handover, opening, a building permit, the start of
// works. Treating every security as due on day one produces a screen full of
// false breaches; treating none as due produces a security nobody chases.
//
// So each security carries a TRIGGER, which resolves against the contract's own
// milestone dates, plus the contractual condition in words. Until the trigger
// date arrives the security is simply "not due yet" — after it, it is missing.

import { graceWindow } from "@/lib/store-opening";

export type DeliveryTrigger =
  | "signing" | "handover" | "opening" | "permit"
  | "works_start" | "works_end" | "custom_date" | "other";

export const TRIGGER_LABELS: Record<DeliveryTrigger, string> = {
  signing: "במועד החתימה",
  handover: "במועד מסירת המושכר",
  opening: "במועד פתיחת המושכר",
  permit: "בקבלת היתר בנייה",
  works_start: "בתחילת עבודות ההתאמה",
  works_end: "בסיום עבודות השוכר",
  custom_date: "בתאריך מוגדר",
  other: "לפי תנאי בהסכם",
};

function d(v: any): Date | null {
  if (!v) return null;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const x = new Date(v);
  return isNaN(x.getTime()) ? null : new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

// The date a trigger resolves to, from the contract's own milestones. Returns
// null when the milestone hasn't been set yet — which is information, not an
// error: the security isn't due because the milestone hasn't happened.
function plusDays(x: Date | null, days: number): Date | null {
  if (!x || !days) return x;
  return new Date(x.getTime() + days * 86400000);
}

export function deliveryDueDate(params: { guarantee: any; contract: any }): { date: Date | null; reason: string } {
  const g = params.guarantee || {};
  const c = params.contract || {};
  const trigger: DeliveryTrigger = g.delivery_trigger || "signing";
  // A milestone is frequently the anchor, not the deadline: "30 יום ממועד
  // פתיחת המושכר". The offset is applied to whatever the trigger resolves to.
  const offset = Number(g.delivery_offset_days) || 0;
  // The labels read "במועד פתיחת המושכר"; with an offset the sentence becomes
  // "30 ימים ממועד פתיחת המושכר", so the label's own prefix is dropped.
  const withOffset = function (x: Date | null, why: string) {
    const anchor = offset > 0 ? offset + " ימים מ" + why.replace(/^ב/, "") : why;
    return { date: plusDays(x, offset), reason: anchor };
  };

  // An explicit date always wins — it is what the parties wrote down.
  const explicit = d(g.delivery_due_date);
  if (trigger === "works_start") {
    // The contract now records when works actually began; an estimate typed on
    // the security is only the fallback.
    const x = d(c.works_start_date) || explicit;
    return x ? withOffset(x, TRIGGER_LABELS.works_start)
             : { date: null, reason: TRIGGER_LABELS.works_start + " — המועד טרם נקבע" };
  }
  if (trigger === "custom_date" || trigger === "other" || trigger === "permit") {
    return explicit
      ? withOffset(explicit, TRIGGER_LABELS[trigger])
      : { date: null, reason: TRIGGER_LABELS[trigger] + " — המועד טרם נקבע" };
  }

  if (trigger === "signing") {
    const x = d(c.signing_date) || d(c.start_date);
    return withOffset(x, TRIGGER_LABELS.signing);
  }
  if (trigger === "handover") {
    const x = d(c.actual_handover_date) || d(c.planned_handover_date);
    return x ? withOffset(x, TRIGGER_LABELS.handover) : { date: null, reason: "מועד המסירה טרם נקבע" };
  }
  if (trigger === "opening") {
    const x = d(c.actual_opening_date) || d(c.planned_opening_date);
    return x ? withOffset(x, TRIGGER_LABELS.opening) : { date: null, reason: "מועד הפתיחה טרם נקבע" };
  }
  if (trigger === "works_end") {
    // End of the tenant's fit-out — the grace window's end is exactly that.
    const gw = graceWindow({ contract: c });
    if (gw.applies && gw.end) return withOffset(gw.end, TRIGGER_LABELS.works_end);
    const x = explicit || d(c.planned_opening_date);
    return x ? withOffset(x, TRIGGER_LABELS.works_end) : { date: null, reason: "מועד סיום העבודות טרם נקבע" };
  }
  return withOffset(explicit, TRIGGER_LABELS.other);
}

export type DeliveryStatus = {
  due: Date | null;
  reason: string;
  delivered: boolean;
  notYetDue: boolean;     // the milestone hasn't arrived — nothing to chase
  overdue: boolean;       // the milestone passed and it still isn't here
  daysLate: number;
  daysUntil: number;
};

export function deliveryStatus(params: { guarantee: any; contract: any; today?: Date }): DeliveryStatus {
  const g = params.guarantee || {};
  const { date, reason } = deliveryDueDate(params);
  const today = params.today ? new Date(params.today) : new Date();
  today.setHours(0, 0, 0, 0);

  // Delivered when it is recorded as such, or when the money is actually in
  // hand — a guarantee with an amount actually received has clearly arrived.
  const delivered = !!g.delivered_at || (Number(g.amount_actual) || 0) > 0;

  if (delivered) {
    return { due: date, reason, delivered: true, notYetDue: false, overdue: false, daysLate: 0, daysUntil: 0 };
  }
  if (!date) {
    return { due: null, reason, delivered: false, notYetDue: true, overdue: false, daysLate: 0, daysUntil: 0 };
  }
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
  return {
    due: date, reason, delivered: false,
    notYetDue: diff > 0,
    overdue: diff <= 0,
    daysLate: diff <= 0 ? Math.abs(diff) : 0,
    daysUntil: diff > 0 ? diff : 0,
  };
}

export function describeDelivery(st: DeliveryStatus, g?: any): string {
  const cond = g?.delivery_condition ? " · " + g.delivery_condition : "";
  if (st.delivered) return "התקבל" + cond;
  if (st.notYetDue && !st.due) return "טרם נדרש — " + st.reason + cond;
  if (st.notYetDue) return "יימסר " + st.reason + " (" + st.due!.toLocaleDateString("he-IL") + ", בעוד " + st.daysUntil + " ימים)" + cond;
  return "היה אמור להימסר " + st.reason + " (" + st.due!.toLocaleDateString("he-IL") + ") — באיחור " + st.daysLate + " ימים" + cond;
}
