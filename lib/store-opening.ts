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

export type GraceEndReason = "opened" | "grace_expired" | "open_ended" | "none";

export type GraceWindow = {
  applies: boolean;
  start: Date | null;        // handover — when fit-out may begin
  end: Date | null;          // the day grace stops covering
  reason: GraceEndReason;
  days: number;              // length of the grace actually used
  openedLate: boolean;       // grace ran out before the store opened
  lateDays: number;          // days beyond the grace (0 when opened in time)
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

// The grace window for a contract. `today` only matters for a store that is
// still shut — the lateness is measured against it.
export function graceWindow(params: { contract: any; today?: Date }): GraceWindow {
  const c = params.contract || {};
  const none: GraceWindow = { applies: false, start: null, end: null, reason: "none", days: 0, openedLate: false, lateDays: 0 };

  const months = Number(c.grace_months) || 0;
  const graceDays = Number(c.grace_days) || 0;
  if (months <= 0 && graceDays <= 0) return none;
  if (!c.grace_type || c.grace_type === "none") return none;

  // Fit-out starts at handover; without one, at the lease start.
  const start = d(c.actual_handover_date) || d(c.planned_handover_date) || d(c.start_date);
  if (!start) return none;

  const byTerm = months > 0 ? addMonths(start, months) : new Date(start.getTime() + graceDays * 86400000);
  const opening = d(c.actual_opening_date);

  // Does opening cut the grace short? Usually yes. Some leases grant the full
  // grace regardless — the store trades while the rent holiday runs to its
  // agreed end. `false` says so explicitly; null/undefined keeps the behaviour
  // every contract had before this existed (grace runs its term), and only a
  // contract that actually records an opening date is affected at all.
  const endsOnOpening = c.grace_ends_on_opening !== false;

  // Opened inside the window → grace stops on the opening day.
  if (endsOnOpening && opening && opening <= byTerm) {
    return {
      applies: true, start, end: opening, reason: "opened",
      days: Math.max(0, daysBetween(start, opening)),
      openedLate: false, lateDays: 0,
    };
  }

  // Grace running its full term: either it was agreed to (endsOnOpening=false),
  // or the store opened late / has not opened at all.
  // Lateness only means something for a lease that HAS an opening milestone.
  // Without one (every contract that predates this) the grace simply ran its
  // term — calling it "late" would invent an issue that does not exist.
  const hasOpeningMilestone = !!(opening || d(c.planned_opening_date));
  const ref = opening || (params.today ? new Date(params.today) : new Date());
  const late = hasOpeningMilestone && (opening ? opening > byTerm : ref > byTerm);
  return {
    applies: true, start, end: byTerm,
    reason: (!endsOnOpening && opening && opening <= byTerm) ? "open_ended" : "grace_expired",
    days: Math.max(0, daysBetween(start, byTerm)),
    openedLate: late,
    lateDays: late ? Math.max(0, daysBetween(byTerm, opening || ref)) : 0,
  };
}

// The date the lease term and rent billing really begin: the store opening when
// there is one, otherwise the day the grace ran out — a tenant who does not
// open cannot postpone the contract indefinitely.
export function rentStartDate(params: { contract: any; today?: Date }): Date | null {
  const c = params.contract || {};
  const opening = d(c.actual_opening_date);
  const g = graceWindow(params);
  if (g.applies) return g.end;
  return opening || d(c.actual_handover_date) || d(c.start_date);
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

  // Compare on day boundaries only — a stray hour must not turn a fully-free
  // month into 99.7% free.
  const pS = new Date(params.periodStart.getFullYear(), params.periodStart.getMonth(), params.periodStart.getDate());
  const pE = new Date(params.periodEnd.getFullYear(), params.periodEnd.getMonth(), params.periodEnd.getDate());
  const total = pE.getTime() - pS.getTime();
  if (total <= 0) return plain;
  // The grace covers from the START of the period: fit-out that began earlier
  // still covers this period, and the old behaviour never clipped at g.start.
  const covered = Math.min(g.end.getTime(), pE.getTime()) - pS.getTime();
  if (covered <= 0) return plain;

  const graceRatio = Math.min(1, covered / total);
  const normal = 1 - graceRatio;

  const rentDiscount = 1 - (Number(c.grace_discount_pct) || 0) / 100;   // 0 = rent free
  const mgmtDiscount = 1 - (Number(c.grace_mgmt_discount_pct) || 0) / 100;

  if (c.grace_type === "full") {
    // Rent and management both waived during fit-out, unless a management
    // discount says otherwise (50% rather than free).
    return {
      rentFactor: normal,
      mgmtFactor: c.grace_mgmt_discount_pct != null ? normal + graceRatio * mgmtDiscount : normal,
      graceRatio,
    };
  }
  if (c.grace_type === "rent_only") {
    return {
      rentFactor: normal,
      mgmtFactor: c.grace_mgmt_discount_pct != null ? normal + graceRatio * mgmtDiscount : 1,
      graceRatio,
    };
  }
  if (c.grace_type === "partial") {
    return {
      rentFactor: normal + graceRatio * rentDiscount,
      mgmtFactor: c.grace_mgmt_discount_pct != null ? normal + graceRatio * mgmtDiscount : 1,
      graceRatio,
    };
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
  const dateStr = g.end.toLocaleDateString("he-IL");
  if (g.reason === "opened") return "הגרייס הסתיים בפתיחת המושכר — " + dateStr + " (" + g.days + " ימים)";
  if (g.reason === "open_ended") return "הגרייס נמשך לתקופתו המלאה גם לאחר הפתיחה — עד " + dateStr + " (" + g.days + " ימים)";
  return "הגרייס הסתיים בתום התקופה — " + dateStr + " (" + g.days + " ימים)" +
    (g.openedLate ? " · המושכר נפתח באיחור של " + g.lateDays + " ימים" : "");
}
