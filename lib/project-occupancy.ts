// How full is the project, and when did it cross a threshold?
//
// A tenant opening into a half-empty centre often negotiates:
//
//   "עד לאיכלוס 60% משטחי הפרויקט ישלם השוכר דמי שכירות חליפיים בלבד"
//
// — until 60% of the project's area is occupied they pay the turnover
// percentage with NO minimum floor. So the system has to answer two questions:
// what is the occupancy on a given date, and on which date did it first reach
// the agreed level.
//
// "Occupied" means an area that is let and live: a contract covering it is in
// force on that date and the shop is trading (or, on a lease with no opening
// milestone, simply that the term has begun). An area handed over but still
// being fitted out is NOT occupied — that is precisely the situation the clause
// is protecting the tenant from.
//
// The crossing date, once found, should be RECORDED on the contract
// (min_rent_condition_met_at). Occupancy moves as tenants come and go, and past
// billing must not move with it.

export type OccupancySnapshot = {
  totalArea: number;
  occupiedArea: number;
  pct: number;
  openUnits: number;
  totalUnits: number;
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

// Is this contract's area live on `date`?
//
// `openingResolver` lets the caller supply the contract's effective opening
// date (lib/lease-term knows how to derive a deemed one); without it, the
// recorded opening is used, and a contract with no opening milestone at all
// counts from its start date — which is the only sensible reading for the
// offices and warehouses that have no such milestone.
export function contractIsLive(params: {
  contract: any;
  date: Date;
  openingDate?: Date | null;
}): boolean {
  const c = params.contract || {};
  const t = params.date.getTime();

  const status = c.status;
  if (status && ["cancelled", "draft", "future"].indexOf(status) !== -1) return false;

  const end = d(c.end_date);
  if (end && end.getTime() < t) return false;

  // A contract with an opening milestone is live from the opening; without one,
  // from the term start.
  const opening = params.openingDate !== undefined
    ? params.openingDate
    : (d(c.actual_opening_date) || null);

  const hasOpeningMilestone = !!(opening || d(c.planned_opening_date));
  const from = hasOpeningMilestone ? opening : d(c.start_date);
  if (!from) return false;
  return from.getTime() <= t;
}

// Occupancy of a property on a date. `spaces` are the property's own units —
// the denominator is the project's area, not the sum of what happens to be let.
export function occupancyAt(params: {
  spaces: any[];                       // { id, area }
  contracts: any[];                    // with contract_spaces
  date: Date;
  openingDates?: Record<string, Date | null>;   // contract id → effective opening
}): OccupancySnapshot {
  const spaces = params.spaces || [];
  const areaById: Record<string, number> = {};
  var totalArea = 0;
  for (const sp of spaces) {
    const a = Number(sp?.area) || 0;
    if (sp?.id) areaById[sp.id] = a;
    totalArea += a;
  }

  // A unit counts once even if two contract rows reference it (a base contract
  // and its amendment both list the same space).
  const liveSpaceIds: Record<string, boolean> = {};
  for (const c of (params.contracts || [])) {
    const opening = params.openingDates ? params.openingDates[c?.id] : undefined;
    if (!contractIsLive({ contract: c, date: params.date, openingDate: opening })) continue;
    for (const cs of (c?.contract_spaces || [])) {
      const sid = cs?.space_id || cs?.spaces?.id;
      if (sid) liveSpaceIds[sid] = true;
    }
  }

  var occupiedArea = 0;
  var openUnits = 0;
  for (const sid of Object.keys(liveSpaceIds)) {
    if (areaById[sid] != null) { occupiedArea += areaById[sid]; openUnits++; }
  }

  return {
    totalArea: Math.round(totalArea * 100) / 100,
    occupiedArea: Math.round(occupiedArea * 100) / 100,
    pct: totalArea > 0 ? Math.round((occupiedArea / totalArea) * 10000) / 100 : 0,
    openUnits,
    totalUnits: spaces.length,
  };
}

// The first date the property reached `thresholdPct`. Scans day by day between
// two bounds — the crossing is caused by a lease starting or a shop opening, so
// a daily scan lands on the exact day rather than rounding to a month.
export function thresholdCrossedOn(params: {
  spaces: any[];
  contracts: any[];
  thresholdPct: number;
  from: Date;
  to: Date;
  openingDates?: Record<string, Date | null>;
}): { date: Date | null; snapshot: OccupancySnapshot | null } {
  const threshold = Number(params.thresholdPct) || 0;
  if (threshold <= 0) return { date: null, snapshot: null };

  // Only the dates on which something can change are worth testing: a term
  // start, an opening, an end. A year-long daily scan would give the same
  // answer far more slowly.
  const candidates: number[] = [];
  const push = function (x: Date | null) {
    if (!x) return;
    const t = x.getTime();
    if (t >= params.from.getTime() && t <= params.to.getTime() && candidates.indexOf(t) === -1) candidates.push(t);
  };
  push(params.from);
  for (const c of (params.contracts || [])) {
    const opening = params.openingDates ? params.openingDates[c?.id] : undefined;
    push(opening !== undefined ? opening : d(c?.actual_opening_date));
    push(d(c?.start_date));
    const end = d(c?.end_date);
    if (end) push(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1));
  }
  candidates.sort(function (a, b) { return a - b; });

  for (const t of candidates) {
    const date = new Date(t);
    const snap = occupancyAt({ spaces: params.spaces, contracts: params.contracts, date, openingDates: params.openingDates });
    if (snap.pct >= threshold) return { date, snapshot: snap };
  }
  return { date: null, snapshot: null };
}

// Does the minimum rent apply on this date?
//
// The recorded crossing date wins — it is a fact about the project that was
// established once, and re-deriving it every month would let today's occupancy
// rewrite last year's bills. Without a recorded date the condition is treated
// as NOT yet met, which is the reading that favours the tenant and matches the
// clause: the floor applies only once the project has filled up.
export function minimumApplies(params: {
  contract: any;
  date: Date | string;
}): { applies: boolean; reason: string } {
  const c = params.contract || {};
  if (c.min_rent_condition_type !== "project_occupancy_pct") {
    return { applies: true, reason: "" };
  }
  const pct = Number(c.min_rent_condition_pct) || 0;
  const met = d(c.min_rent_condition_met_at);
  const on = d(params.date) || new Date();

  if (!met) {
    return { applies: false, reason: "טרם אושר מועד שבו הפרויקט הגיע ל-" + pct + "% איכלוס — אחוז מפדיון בלבד" };
  }
  if (on.getTime() < met.getTime()) {
    return { applies: false, reason: "עד " + met.toLocaleDateString("he-IL") + " (" + pct + "% איכלוס) — אחוז מפדיון בלבד" };
  }
  return { applies: true, reason: "המינימום חל מ-" + met.toLocaleDateString("he-IL") + " (" + pct + "% איכלוס)" };
}

// YYYY-MM-DD in LOCAL time. toISOString() on a local-midnight Date shifts back
// to the previous day in Israel — the crossing date must be stored as the day
// that was actually computed.
export function toDateString(x: Date): string {
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}

export function describeOccupancy(s: OccupancySnapshot): string {
  return s.pct.toFixed(2) + "% איכלוס · " + s.occupiedArea.toLocaleString("he-IL") + " מ\"ר מתוך " +
    s.totalArea.toLocaleString("he-IL") + " · " + s.openUnits + "/" + s.totalUnits + " יחידות";
}
