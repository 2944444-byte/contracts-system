import { expandRecurringTiers, type PriceTier } from "@/lib/contract-utils";

// Revenue-share leases carry a floor: the tenant pays the higher of (a) the
// agreed % of turnover and (b) a minimum rent. The floor is not frozen — the
// contract's rent steps raise it too, and it stays linked to the ORIGINAL base
// index (never re-based at each step).
//
// Everything here is data-driven: the same tier rows that drive the rent drive
// the floor, so a contract with no tiers simply keeps its entered minimum.

// Which contract year a date falls in (year 1 = the first 12 months).
export function contractYearAt(contractStart: string | Date, date: string | Date): number {
  const s = new Date(contractStart), d = new Date(date);
  if (isNaN(s.getTime()) || isNaN(d.getTime())) return 1;
  var years = d.getFullYear() - s.getFullYear();
  const beforeAnniversary = (d.getMonth() < s.getMonth()) ||
    (d.getMonth() === s.getMonth() && d.getDate() < s.getDate());
  if (beforeAnniversary) years -= 1;
  return Math.max(1, years + 1);
}

// The minimum rent per sqm in force on a given date, after applying every rent
// step that has already kicked in. Steps are applied in order, exactly as they
// are for the rent itself.
export function minRentPerSqmAtDate(params: {
  baseMinPerSqm: number;
  tiers: PriceTier[] | any[];
  contractStart: string | Date;
  date: string | Date;
}): number {
  const base = Number(params.baseMinPerSqm) || 0;
  if (base <= 0) return 0;
  const tiers = Array.isArray(params.tiers) ? params.tiers : [];
  if (tiers.length === 0) return base;

  const year = contractYearAt(params.contractStart, params.date);
  const expanded = expandRecurringTiers(tiers as PriceTier[])
    .slice()
    .sort(function(a, b) { return (Number(a.from_year) || 0) - (Number(b.from_year) || 0); });

  var v = base;
  for (const t of expanded) {
    // from_year is the number of COMPLETED lease years before the step — the
    // convention the fixed-rent engine uses and the one verified against real
    // billing (תים נטקום: from_year 5, start 15.2.2021 → the 4% landed on
    // 15.2.2026, and the split quarter came out at exactly +2%). So a tier with
    // from_year N first applies in lease year N+1; reading it as "from year N"
    // stepped the floor a full year early.
    if ((Number(t.from_year) || 1) >= year) break;
    const inc = Number(t.increase_value) || 0;
    if (t.increase_type === "pct") v = v * (1 + inc / 100);
    else if (t.increase_type === "fixed_sqm") v = v + inc;
    // fixed_total / none don't translate to a per-sqm floor step.
  }
  return Math.round(v * 100) / 100;
}

export type MinRentBreakdown = {
  perSqm: number;        // after steps, before linkage
  perSqmIndexed: number; // after linkage
  amount: number;        // × area (+ investment addition)
  cpiRatio: number;      // 1 when not linked / unavailable
  indexed: boolean;
  contractYear: number;
};

// Full floor for a period. `cpiRatio` is supplied by the caller (ratio from the
// contract's ORIGINAL base index to the period) — pass 1, or omit, when the
// contract isn't linked or the index for that month isn't published yet, and
// `indexed` will report that the figure is un-linked rather than silently
// pretending it is.
export function minRentForPeriod(params: {
  baseMinPerSqm: number;
  tiers: PriceTier[] | any[];
  contractStart: string | Date;
  date: string | Date;
  area: number;
  investmentAddition?: number;
  cpiRatio?: number | null;
}): MinRentBreakdown {
  const perSqm = minRentPerSqmAtDate(params);
  const ratio = params.cpiRatio && params.cpiRatio > 0 ? params.cpiRatio : 1;
  const perSqmIndexed = Math.round(perSqm * ratio * 100) / 100;
  const amount = Math.round((perSqmIndexed * (Number(params.area) || 0) + (Number(params.investmentAddition) || 0)) * 100) / 100;
  return {
    perSqm, perSqmIndexed, amount,
    cpiRatio: ratio,
    indexed: ratio !== 1,
    contractYear: contractYearAt(params.contractStart, params.date),
  };
}
