// When does the lease term actually begin?
//
// Most leases run from a date typed into start_date. A retail lease frequently
// does not — it runs from the opening of the shop, and the opening itself is
// DEFINED rather than merely recorded:
//
//   "פתיחת המושכר תהא כשהמושכר מוכן על ציודו ומתקניו … ולא יאוחר מתום שישים
//    (60) ימים ממועד מסירת החזקה במושכר."
//   "36 חודשים החל ממועד פתיחת המושכר לקהל הרחב בפועל או המועד המוגדר לעיל
//    כמועד פתיחת המושכר, לפי המוקדם מביניהם."
//
// Two things follow. First, the opening date is the EARLIER of the actual
// opening and a deadline counted from handover — a tenant who drags out the
// fit-out cannot postpone the lease, because the deemed date arrives anyway.
// Second, the term's length is counted FROM that date, so the end date is not
// known at signing and must be derived.
//
// A contract that says nothing about this behaves exactly as before: the term
// runs from start_date and the opening date is whatever was recorded.

export type OpeningKind = "actual" | "deemed" | "planned" | "none";

export type EffectiveOpening = {
  date: Date | null;
  kind: OpeningKind;
  reason: string;
  // The deadline the clause imposes, when there is one — useful on its own:
  // it is the date the term starts if the tenant never opens.
  deadline: Date | null;
  // True when the deadline decided it, i.e. the shop had not opened in time.
  byDeadline: boolean;
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

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

function addMonths(base: Date, months: number): Date {
  const day = base.getDate();
  const shifted = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const last = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, last));
  return shifted;
}

function handoverOf(c: any): Date | null {
  return d(c?.actual_handover_date) || d(c?.planned_handover_date);
}

// The opening date the contract's own definition produces.
export function effectiveOpeningDate(contract: any): EffectiveOpening {
  const c = contract || {};
  const actual = d(c.actual_opening_date);
  const planned = d(c.planned_opening_date);

  // No definition recorded → the old behaviour: whatever date is on file.
  if (c.opening_rule !== "actual_or_days_from_handover") {
    if (actual) return { date: actual, kind: "actual", reason: "פתיחה בפועל", deadline: null, byDeadline: false };
    if (planned) return { date: planned, kind: "planned", reason: "יעד פתיחה", deadline: null, byDeadline: false };
    return { date: null, kind: "none", reason: "מועד הפתיחה טרם נקבע", deadline: null, byDeadline: false };
  }

  const days = Number(c.opening_max_days_from_handover) || 0;
  const handover = handoverOf(c);
  const deadline = handover && days > 0 ? addDays(handover, days) : null;

  // "לפי המוקדם מביניהם" — literally the earlier of the two.
  if (actual && deadline) {
    return actual.getTime() <= deadline.getTime()
      ? { date: actual, kind: "actual", reason: "פתיחה בפועל לקהל הרחב", deadline, byDeadline: false }
      : { date: deadline, kind: "deemed", reason: days + " ימים ממועד המסירה", deadline, byDeadline: true };
  }
  if (actual) return { date: actual, kind: "actual", reason: "פתיחה בפועל לקהל הרחב", deadline: null, byDeadline: false };
  // Not opened yet: the deemed date is the answer, and it is already known.
  if (deadline) return { date: deadline, kind: "deemed", reason: days + " ימים ממועד המסירה", deadline, byDeadline: true };
  return { date: null, kind: "none", reason: "טרם נקבע מועד מסירה — לא ניתן לגזור את מועד הפתיחה", deadline: null, byDeadline: false };
}

export type LeaseTerm = {
  start: Date | null;
  end: Date | null;
  basis: string;              // what the start was derived from
  derived: boolean;           // true when the dates come from a rule, not from start_date
  months: number;
};

// The term, derived when the contract says it runs from a milestone.
export function leaseTerm(params: {
  contract: any;
  // The wizard passes the length being typed, before anything is saved.
  months?: number;
}): LeaseTerm {
  const c = params.contract || {};
  const unit = c.lease_period_unit || "months";
  const raw = params.months != null ? params.months : Number(c.lease_period_value) || 0;
  const months = unit === "years" ? raw * 12 : raw;

  const startsAt = c.term_starts_at;
  var start: Date | null = null;
  var basis = "";
  var derived = false;

  if (startsAt === "opening") {
    const op = effectiveOpeningDate(c);
    start = op.date;
    basis = "מועד פתיחת המושכר — " + op.reason;
    derived = true;
  } else if (startsAt === "handover") {
    start = handoverOf(c);
    basis = "מועד מסירת החזקה";
    derived = true;
  } else {
    start = d(c.start_date);
    basis = "תאריך תחילה שהוזן";
  }

  // Falling back to start_date keeps a half-filled contract usable rather than
  // showing an empty term.
  if (!start) { start = d(c.start_date); if (start) basis += " (עד לקביעת המועד — תאריך התחילה)"; }

  const end = start && months > 0 ? addDays(addMonths(start, months), -1) : d(c.end_date);
  return { start, end, basis, derived, months };
}

export function describeLeaseTerm(t: LeaseTerm): string {
  if (!t.start) return "תקופת השכירות טרם ניתנת לחישוב — " + t.basis;
  const f = function (x: Date) { return x.toLocaleDateString("he-IL"); };
  return t.months + " חודשים · " + f(t.start) + (t.end ? " – " + f(t.end) : "") +
    (t.derived ? " · " + t.basis : "");
}

export function describeOpening(op: EffectiveOpening): string {
  if (!op.date) return op.reason;
  const s = op.date.toLocaleDateString("he-IL") + " · " + op.reason;
  if (op.deadline && !op.byDeadline) {
    const same = op.date.getTime() === op.deadline.getTime();
    return s + (same ? " (בדיוק במועד הקבוע)"
      : " (מוקדם מהמועד הקבוע " + op.deadline.toLocaleDateString("he-IL") + ")");
  }
  if (op.byDeadline) return s + " — המושכר טרם נפתח, המועד הקבוע קובע";
  return s;
}
