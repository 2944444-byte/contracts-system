// Retail leases run on four milestones, not two.
//
//   חתימה → מסירה (יעד / בפועל) → תקופת עבודות (גרייס) → פתיחת המושכר
//
// The premises are handed over as a shell; the tenant fits out; the LEASE clock
// starts when the store actually opens. The fit-out window is the grace period,
// and it ends at whichever comes FIRST:
//
//   · the store opening — a lease with 90 days' grace whose store opens on day
//     65 stops the grace on day 65 and starts charging rent
//   · the grace running out — if day 90 passes with the store still shut, rent
//     and the lease term start anyway, and a late-opening penalty may apply
//
// Everything here is derived from dates on the contract; a lease with no
// opening milestone behaves exactly as before.

import { effectiveOpeningDate } from "@/lib/lease-term";

export type GraceEndReason = "opened" | "grace_expired" | "open_ended" | "none";

export type GraceWindow = {
  applies: boolean;
  start: Date | null;        // handover — when fit-out may begin
  end: Date | null;          // the day the FIT-OUT window stops (phase 1)
  reason: GraceEndReason;
  days: number;              // length of phase 1 actually used
  openedLate: boolean;       // phase 1 ran out before the store opened
  lateDays: number;          // days beyond phase 1 (0 when opened in time)
  // Some leases grant a SECOND grace counted from the opening itself:
  //   שלב 1: עד 60 יום ממסירה או עד הפתיחה, המוקדם — שלב 2: עוד 60 יום מהפתיחה
  // Phase 2 runs from wherever phase 1 ended, so opening on day 30 gives
  // 30 + 60 = 90 rent-free days and never opening gives the full maximum
  // (60 + 60 = 120) — it can never grow past phase1 + phase2.
  // `end` stays the fit-out boundary (works-end anchors, the late-opening
  // penalty and the opening target all measure against it); `rentFreeEnd`
  // is what rent billing covers, and equals `end` when there is no phase 2.
  phase2Days: number;
  rentFreeEnd: Date | null;
};

// A date-only value must land on LOCAL midnight. `new Date("2025-01-01")`
// parses as UTC, which in Israel is 02:00/03:00 local — enough to make a full
// grace month come out as 99.7% and shift day counts by one.
function d(v: any): Date | null {
  if (!v) return null;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const x = new Date(v);
  if (isNaN(x.getTime())) return null;
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

function addMonths(base: Date, months: number): Date {
  const day = base.getDate();
  const shifted = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const last = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, last));
  return shifted;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Adding days by MILLISECONDS is wrong across a daylight-saving change: 1.7.2026
// plus 180 × 86,400,000 ms lands on 27.12 at 23:00, so a 180-day fit-out window
// looked like it ended a day early. Days are a calendar unit — advance the date
// field and let the clock stay at local midnight.
export function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

// The grace window for a contract. `today` only matters for a store that is
// still shut — the lateness is measured against it.
export function graceWindow(params: { contract: any; today?: Date }): GraceWindow {
  const c = params.contract || {};
  const none: GraceWindow = { applies: false, start: null, end: null, reason: "none", days: 0, openedLate: false, lateDays: 0, phase2Days: 0, rentFreeEnd: null };

  const months = Number(c.grace_months) || 0;
  const graceDays = Number(c.grace_days) || 0;
  if (months <= 0 && graceDays <= 0) return none;
  if (!c.grace_type || c.grace_type === "none") return none;

  // Fit-out starts at handover; without one, at the lease start.
  const start = d(c.actual_handover_date) || d(c.planned_handover_date) || d(c.start_date);
  if (!start) return none;

  const byTerm = months > 0 ? addMonths(start, months) : addDays(start, graceDays);

  // The opening that ends the fit-out window. A lease whose opening date is
  // DEFINED — "המוקדם מבין הפתיחה בפועל לבין 60 ימים ממועד המסירה" — reaches
  // its opening on the deemed date even if the shop never opened, and the lease
  // term starts there. Without this the grace kept running past the term start
  // and handed the tenant rent-free months it was never owed.
  //
  // Only 'actual' and 'deemed' count. A merely PLANNED opening must not cut the
  // grace short — that was never the behaviour and a target is not an event.
  // וגם פתיחה רעיונית ("X ימים מהמסירה") נספרת רק כשהיא נגזרת ממסירה
  // בפועל: הכלל החוזי מודד מהמסירה שקרתה, ומסירה מתוכננת שנדחתה אינה
  // עילה לקצר את הגרייס ולהקדים חיוב (אותו עיקרון כמו תנאי תחילת החיוב).
  const eo = effectiveOpeningDate(c);
  const deemedFromActual = eo.kind === "deemed" && !!d(c.actual_handover_date);
  const opening = (eo.kind === "actual" || deemedFromActual) ? eo.date : d(c.actual_opening_date);

  // Does opening cut the grace short? Usually yes. Some leases grant the full
  // grace regardless — the store trades while the rent holiday runs to its
  // agreed end. `false` says so explicitly; null/undefined keeps the behaviour
  // every contract had before this existed (grace runs its term), and only a
  // contract that actually records an opening date is affected at all.
  const endsOnOpening = c.grace_ends_on_opening !== false;
  const phase2Days = Number(c.grace_phase2_days) || 0;
  const withPhase2 = function (w: GraceWindow): GraceWindow {
    w.phase2Days = phase2Days;
    w.rentFreeEnd = w.end && phase2Days > 0 ? addDays(w.end, phase2Days) : w.end;
    return w;
  };

  // Opened inside the window → grace stops on the opening day.
  if (endsOnOpening && opening && opening <= byTerm) {
    return withPhase2({
      applies: true, start, end: opening, reason: "opened",
      days: Math.max(0, daysBetween(start, opening)),
      openedLate: false, lateDays: 0, phase2Days: 0, rentFreeEnd: null,
    });
  }

  // Grace running its full term: either it was agreed to (endsOnOpening=false),
  // or the store opened late / has not opened at all.
  // Lateness only means something for a lease that HAS an opening milestone.
  // Without one (every contract that predates this) the grace simply ran its
  // term — calling it "late" would invent an issue that does not exist.
  const hasOpeningMilestone = !!(opening || d(c.planned_opening_date));
  const ref = opening || (params.today ? new Date(params.today) : new Date());
  const late = hasOpeningMilestone && (opening ? opening > byTerm : ref > byTerm);
  return withPhase2({
    applies: true, start, end: byTerm,
    reason: (!endsOnOpening && opening && opening <= byTerm) ? "open_ended" : "grace_expired",
    days: Math.max(0, daysBetween(start, byTerm)),
    openedLate: late,
    lateDays: late ? Math.max(0, daysBetween(byTerm, opening || ref)) : 0,
    phase2Days: 0, rentFreeEnd: null,
  });
}

// From when does this contract occupy the premises for COST-ALLOCATION purposes
// — building insurance, waste, and any other m²-days split?
//
// Not the rent clock. A retail tenant holds the shop from handover and fits it
// out for months; the shell is insured and serviced throughout, so their share
// of those costs runs from the handover, not from the day rent starts. Falls
// back to the lease start, which is what every contract without a handover date
// has always used.
export function occupancyStartDate(contract: any): Date | null {
  const c = contract || {};
  return d(c.actual_handover_date) || d(c.planned_handover_date) || d(c.start_date);
}

// The date the lease term and rent billing really begin: the store opening when
// there is one, otherwise the day the grace ran out — a tenant who does not
// open cannot postpone the contract indefinitely.
export function rentStartDate(params: { contract: any; today?: Date }): Date | null {
  const c = params.contract || {};
  const opening = d(c.actual_opening_date);
  const g = graceWindow(params);
  if (g.applies) return g.rentFreeEnd || g.end;
  return opening || d(c.actual_handover_date) || d(c.start_date);
}

// The management discount during fit-out often has its own starting point:
//
//   "בתקופת 180 הימים של עבודות השוכר ישולמו דמי ניהול בגובה 50% וגם זאת, רק
//    לאחר תחילת עבודות השוכר בפועל, או לאחר 90 יום המוקדם מבינם."
//
// So the fit-out window splits in two for management: a FREE stretch from
// handover until the tenant actually begins works, and the discounted stretch
// after it. The free stretch is capped in days, which is what stops a tenant
// from holding an empty shop and paying nothing — whichever comes first wins.
//
// Left off (mgmt_charge_starts null / 'grace_start') this returns applies:false
// and management behaves exactly as it did before.
export type MgmtFreeWindow = {
  applies: boolean;
  start: Date | null;     // handover — the fit-out window's own start
  end: Date | null;       // the day management starts being charged
  reason: string;         // which of the two came first
  days: number;
};

export function mgmtFreeWindow(params: { contract: any; today?: Date }): MgmtFreeWindow {
  const c = params.contract || {};
  const none: MgmtFreeWindow = { applies: false, start: null, end: null, reason: "", days: 0 };
  if (c.mgmt_charge_starts !== "works_start_or_days") return none;

  const g = graceWindow({ contract: c, today: params.today });
  if (!g.applies || !g.start) return none;

  const cap = Number(c.mgmt_free_max_days) || 0;
  const byDays = cap > 0 ? addDays(g.start, cap) : null;
  const works = d(c.works_start_date);

  var end: Date | null = null;
  var reason = "";
  if (works && byDays) {
    // "המוקדם מביניהם" — literally the earlier of the two.
    if (works.getTime() <= byDays.getTime()) { end = works; reason = "תחילת עבודות השוכר בפועל"; }
    else { end = byDays; reason = cap + " יום מהמסירה"; }
  } else if (works) {
    end = works; reason = "תחילת עבודות השוכר בפועל";
  } else if (byDays) {
    // Works not yet reported: the cap is the only thing that can end the
    // exemption, and it does so on its own.
    end = byDays; reason = cap + " יום מהמסירה";
  } else {
    return none;
  }

  // Management can never start later than the fit-out window itself ends.
  if (g.end && end.getTime() > g.end.getTime()) { end = g.end; reason = "תום תקופת העבודות"; }

  return {
    applies: true, start: g.start, end, reason,
    days: Math.max(0, daysBetween(g.start, end)),
  };
}

// The share of a date range for which management is actually chargeable — the
// figure the yearly management reconciliation needs.
//
// Deliberately opt-in: a contract that says nothing about management during
// fit-out returns 1, so every contract that predates this bills exactly as it
// did. Only `grace_mgmt_discount_pct` or `mgmt_charge_starts` turns it on.
export function mgmtChargeFactorForRange(params: {
  contract: any;
  from: Date;
  to: Date;
  today?: Date;
}): { factor: number; opted: boolean; note: string } {
  const c = params.contract || {};
  const opted = c.grace_mgmt_discount_pct != null || c.mgmt_charge_starts === "works_start_or_days";
  if (!opted) return { factor: 1, opted: false, note: "" };

  const g = graceWindow({ contract: c, today: params.today });
  if (!g.applies || !g.start || !g.end) return { factor: 1, opted: true, note: "" };

  // Whole-day integers, not raw milliseconds: a range spanning the October
  // daylight-saving change is an hour long, which would put a stray 0.04 of a
  // day into a money figure. dayNum is a DST-free calendar day index.
  const dayNum = function (x: Date): number {
    return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86400000;
  };
  const from = dayNum(params.from);
  const to = dayNum(params.to);
  const total = to - from;
  if (total <= 0) return { factor: 1, opted: true, note: "" };

  const overlap = function (aS: number, aE: number, bS: number, bE: number): number {
    return Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));
  };

  // Management stops being discounted at the fit-out end — phase 2 is a rent
  // holiday for a trading store, not a management one.
  const graceDays = overlap(from, to, dayNum(g.start), dayNum(g.end));
  if (graceDays <= 0) return { factor: 1, opted: true, note: "" };

  const free = mgmtFreeWindow({ contract: c, today: params.today });
  const freeDays = free.applies && free.end
    ? overlap(from, to, dayNum(g.start), Math.min(dayNum(free.end), dayNum(g.end)))
    : 0;
  const discDays = Math.max(0, graceDays - freeDays);
  const normalDays = Math.max(0, total - graceDays);

  const mgmtInGrace = c.grace_mgmt_discount_pct != null
    ? 1 - (Number(c.grace_mgmt_discount_pct) || 0) / 100
    : (c.grace_type === "full" ? 0 : 1);

  const factor = (normalDays + discDays * mgmtInGrace) / total;
  const bits: string[] = [];
  if (freeDays > 0) bits.push("פטור מלא " + freeDays + " ימים");
  if (discDays > 0) bits.push(Math.round(mgmtInGrace * 100) + "% על " + discDays + " ימים");
  if (normalDays > 0) bits.push("מלא " + normalDays + " ימים");
  return { factor: Math.max(0, Math.min(1, factor)), opted: true, note: bits.join(" · ") };
}

export function describeMgmtFree(w: MgmtFreeWindow): string {
  if (!w.applies || !w.end) return "";
  return "פטור מלא מדמי ניהול עד " + w.end.toLocaleDateString("he-IL") +
    " (" + w.reason + ", " + w.days + " ימים) — ומשם לפי ההנחה";
}

// How much of a period the grace covers, and what that means for rent and
// management. A discount of 50% on management during fit-out is common, so it
// is a percentage rather than a yes/no.
export function graceFactorsFor(params: {
  contract: any;
  periodStart: Date;
  periodEnd: Date;
  today?: Date;
}): { rentFactor: number; mgmtFactor: number; graceRatio: number } {
  const c = params.contract || {};
  const g = graceWindow({ contract: c, today: params.today });
  const plain = { rentFactor: 1, mgmtFactor: 1, graceRatio: 0 };
  if (!g.applies || !g.end) return plain;
  // Phase 2 (extra grace from the opening) extends RENT coverage only — it is
  // a rent holiday for a store that is already trading, and management is
  // charged from the opening on. Rent measures against rentFreeEnd; the
  // management stretch stops at the fit-out end.
  const coverEnd = g.rentFreeEnd || g.end;
  const mgmtEnd = g.end;

  // Compare on day boundaries only — a stray hour must not turn a fully-free
  // month into 99.7% free.
  const pS = new Date(params.periodStart.getFullYear(), params.periodStart.getMonth(), params.periodStart.getDate());
  const pE = new Date(params.periodEnd.getFullYear(), params.periodEnd.getMonth(), params.periodEnd.getDate());
  const total = pE.getTime() - pS.getTime();
  if (total <= 0) return plain;
  // The grace covers from the START of the period: fit-out that began earlier
  // still covers this period, and the old behaviour never clipped at g.start.
  const covered = Math.min(coverEnd.getTime(), pE.getTime()) - pS.getTime();
  if (covered <= 0) return plain;

  const graceRatio = Math.min(1, covered / total);
  const normal = 1 - graceRatio;
  // Management's own window (phase 1 only) and its normal remainder.
  const mgmtCovered = Math.max(0, Math.min(mgmtEnd.getTime(), pE.getTime()) - pS.getTime());
  const mgmtGraceRatio = Math.min(1, mgmtCovered / total);
  const mgmtNormal = 1 - mgmtGraceRatio;

  const rentDiscount = 1 - (Number(c.grace_discount_pct) || 0) / 100;   // 0 = rent free
  const mgmtDiscount = 1 - (Number(c.grace_mgmt_discount_pct) || 0) / 100;

  // The fit-out window splits in two for management: free until works begin (or
  // the day cap runs out), discounted after. Measured from the period start the
  // same way `covered` is, so the two ratios stay consistent.
  const free = mgmtFreeWindow({ contract: c, today: params.today });
  const freeCovered = free.applies && free.end
    ? Math.max(0, Math.min(free.end.getTime(), pE.getTime()) - pS.getTime())
    : 0;
  const freeRatio = Math.min(mgmtGraceRatio, freeCovered / total);
  const discRatio = Math.max(0, mgmtGraceRatio - freeRatio);

  // What management costs DURING the fit-out window, once it is chargeable at
  // all: the stated discount, or — with no discount recorded — free on a full
  // grace and full price on a rent-only/partial one. With no free window this
  // reduces to the original formulas exactly (freeRatio = 0, discRatio = graceRatio).
  const mgmtInGrace = c.grace_mgmt_discount_pct != null
    ? mgmtDiscount
    : (c.grace_type === "full" ? 0 : 1);
  const mgmtFactor = mgmtNormal + discRatio * mgmtInGrace;   // the free stretch contributes 0

  if (c.grace_type === "full") {
    return { rentFactor: normal, mgmtFactor, graceRatio };
  }
  if (c.grace_type === "rent_only") {
    return { rentFactor: normal, mgmtFactor, graceRatio };
  }
  if (c.grace_type === "partial") {
    return { rentFactor: normal + graceRatio * rentDiscount, mgmtFactor, graceRatio };
  }
  return plain;
}

export type LateOpeningPenalty = {
  applies: boolean;
  lateDays: number;
  chargeableDays: number;    // after any contractual days of leeway
  amount: number;
  basis: string;             // human-readable derivation
};

// Penalty for opening late. Optional by design — most contracts carry none, and
// `type` empty/none returns nothing rather than inventing a charge.
export function lateOpeningPenalty(params: {
  contract: any;
  monthlyRent?: number;      // for a penalty expressed as a % of rent
  today?: Date;
}): LateOpeningPenalty {
  const c = params.contract || {};
  const nothing: LateOpeningPenalty = { applies: false, lateDays: 0, chargeableDays: 0, amount: 0, basis: "" };
  const type = c.late_opening_penalty_type;
  if (!type || type === "none") return nothing;

  const g = graceWindow({ contract: c, today: params.today });
  if (!g.applies || !g.openedLate) return nothing;

  const leeway = Number(c.late_opening_grace_days) || 0;
  const chargeable = Math.max(0, g.lateDays - leeway);
  if (chargeable <= 0) return { ...nothing, lateDays: g.lateDays };

  const value = Number(c.late_opening_penalty_value) || 0;
  const rent = Number(params.monthlyRent) || 0;
  var amount = 0;
  var basis = "";

  if (type === "daily_amount") {
    amount = value * chargeable;
    basis = chargeable + " ימים × ₪" + value.toLocaleString("he-IL");
  } else if (type === "daily_pct_rent") {
    const daily = rent / 30;
    amount = daily * (value / 100) * chargeable;
    basis = chargeable + " ימים × " + value + "% משכ\"ד יומי (₪" + Math.round(daily).toLocaleString("he-IL") + ")";
  } else if (type === "fixed") {
    amount = value;
    basis = "סכום קבוע";
  }

  return {
    applies: amount > 0,
    lateDays: g.lateDays,
    chargeableDays: chargeable,
    amount: Math.round(amount * 100) / 100,
    basis: basis + (leeway > 0 ? " (לאחר " + leeway + " ימי חסד)" : ""),
  };
}

export function describeGrace(g: GraceWindow): string {
  if (!g.applies || !g.end) return "";
  const phase2 = g.phase2Days > 0 && g.rentFreeEnd
    ? " · ועוד " + g.phase2Days + " ימי גרייס מהפתיחה — חיוב שכ\"ד מ-" + g.rentFreeEnd.toLocaleDateString("he-IL")
    : "";
  const dateStr = g.end.toLocaleDateString("he-IL");
  if (g.reason === "opened") return "שלב 1 הסתיים בפתיחת המושכר — " + dateStr + " (" + g.days + " ימים)" + phase2;
  if (g.reason === "open_ended") return "הגרייס נמשך לתקופתו המלאה גם לאחר הפתיחה — עד " + dateStr + " (" + g.days + " ימים)" + phase2;
  return (g.phase2Days > 0 ? "שלב 1" : "הגרייס") + " הסתיים בתום התקופה — " + dateStr + " (" + g.days + " ימים)" +
    (g.openedLate ? " · המושכר נפתח באיחור של " + g.lateDays + " ימים" : "") + phase2;
}
