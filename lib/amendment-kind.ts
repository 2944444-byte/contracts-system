// What did an amendment actually change?
//
// An amendment is just another contract row, so the system treated them all
// alike — and a parking amendment looked exactly like a unit amendment. That
// matters: adding six parking spaces does NOT change the leased area, and the
// insurance, waste and management splits are all m²-based. Reading "תוספת" and
// assuming square metres moved is how a parking deal ends up shifting a
// property-wide cost allocation.
//
// Nothing new is stored. The kind is DERIVED by comparing the amendment with
// the snapshot before it, so it stays true even for amendments entered long
// before this existed.

import { contractArea } from "@/lib/contract-area";

export type AmendmentChange = "units" | "area" | "parking" | "rent" | "term" | "payment" | "other";

export const CHANGE_LABELS: Record<AmendmentChange, string> = {
  units: "שינוי יחידות",
  area: "שינוי שטח",
  parking: "תוספת/שינוי חניה",
  rent: 'שינוי שכ"ד',
  term: "שינוי תקופה",
  payment: "שינוי שיטת תשלום",
  other: "שינוי תנאים",
};

export const CHANGE_ICONS: Record<AmendmentChange, string> = {
  units: "🏢", area: "📐", parking: "🅿️", rent: "💰", term: "📅", payment: "💳", other: "📝",
};

function spaceIds(row: any): string[] {
  return ((row?.contract_spaces || []) as any[])
    .map(function (x: any) { return x?.space_id || x?.spaces?.id; })
    .filter(Boolean)
    .sort();
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type AmendmentKind = {
  changes: AmendmentChange[];
  // The headline: what a manager would call this amendment.
  primary: AmendmentChange;
  label: string;
  areaDelta: number;          // m² added (+) or removed (−)
  parkingDelta: number;       // monthly parking money added (+) or removed (−)
  addsAreaOnly: boolean;      // true only when square metres really moved
};

// `prev` is the snapshot the amendment replaces — the base contract, or the
// amendment before it. `parking` are the parking rows attached to each.
export function classifyAmendment(params: {
  amendment: any;
  prev: any;
  amendmentParking?: any[];
  prevParking?: any[];
}): AmendmentKind {
  const am = params.amendment || {};
  const prev = params.prev || {};

  const changes: AmendmentChange[] = [];

  // Units: a different SET of spaces, not merely a different count.
  const amIds = spaceIds(am);
  const prevIds = spaceIds(prev);
  // An amendment that lists no spaces inherits the previous set — that is the
  // convention the billing timelines use, so it is not a unit change.
  const unitsChanged = amIds.length > 0 && !sameIds(amIds, prevIds);

  const amArea = amIds.length > 0 ? contractArea(am) : contractArea(prev);
  const prevArea = contractArea(prev);
  const areaDelta = Math.round((amArea - prevArea) * 100) / 100;

  if (unitsChanged) changes.push("units");
  if (Math.abs(areaDelta) > 0.5) changes.push("area");

  const monthlyParking = function (rows: any[] | undefined): number {
    return (rows || []).reduce(function (s: number, p: any) {
      if (p?.is_included_in_rent) return s;
      if (p?.subscription_type === "visitor") return s;
      return s + (Number(p?.monthly_fee) || 0) * (Number(p?.quantity) || 1);
    }, 0);
  };
  const parkingDelta = Math.round((monthlyParking(params.amendmentParking) - monthlyParking(params.prevParking)) * 100) / 100;
  if (Math.abs(parkingDelta) > 0.005) changes.push("parking");

  const rentChanged =
    (Number(am.rent_per_sqm) || 0) !== (Number(prev.rent_per_sqm) || 0) ||
    (Number(am.revenue_pct) || 0) !== (Number(prev.revenue_pct) || 0) ||
    (Number(am.min_rent_per_sqm) || 0) !== (Number(prev.min_rent_per_sqm) || 0);
  if (rentChanged) changes.push("rent");

  const termChanged = String(am.end_date || "").slice(0, 10) !== String(prev.end_date || "").slice(0, 10);
  if (termChanged) changes.push("term");

  // Payment change: the base row is updated when the amendment is saved, so
  // comparing against `prev` sees nothing — the amendment's own pre-change
  // snapshot (amendment_prev) is the reliable witness.
  const ap = am.amendment_prev;
  const paymentChanged = !!ap && (
    (ap.payment_method != null && ap.payment_method !== am.payment_method) ||
    (ap.payment_frequency != null && ap.payment_frequency !== am.payment_frequency) ||
    (ap.payment_day != null && Number(ap.payment_day) !== Number(am.payment_day))
  );
  if (paymentChanged) changes.push("payment");

  if (changes.length === 0) changes.push("other");

  // Headline: square metres first (it drives every allocation), then parking,
  // then money, then dates.
  const primary: AmendmentChange =
    changes.indexOf("units") !== -1 ? "units"
    : changes.indexOf("area") !== -1 ? "area"
    : changes.indexOf("parking") !== -1 ? "parking"
    : changes.indexOf("rent") !== -1 ? "rent"
    : changes.indexOf("term") !== -1 ? "term"
    : changes.indexOf("payment") !== -1 ? "payment" : "other";

  return {
    changes,
    primary,
    label: changes.map(function (c) { return CHANGE_LABELS[c]; }).join(" · "),
    areaDelta,
    parkingDelta,
    // The question every m²-based allocation needs answered.
    addsAreaOnly: Math.abs(areaDelta) > 0.5,
  };
}

export function describeAmendment(k: AmendmentKind): string {
  const bits: string[] = [CHANGE_ICONS[k.primary] + " " + k.label];
  if (Math.abs(k.areaDelta) > 0.5) {
    bits.push((k.areaDelta > 0 ? "+" : "") + k.areaDelta.toLocaleString("he-IL") + ' מ"ר');
  } else {
    bits.push('ללא שינוי בשטח המושכר');
  }
  if (Math.abs(k.parkingDelta) > 0.005) {
    bits.push("חניה " + (k.parkingDelta > 0 ? "+" : "") + "₪" + k.parkingDelta.toLocaleString("he-IL") + "/חודש");
  }
  return bits.join(" · ");
}
