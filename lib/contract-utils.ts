import { addMonths, addYears, format } from "date-fns";
import { emptyPenaltyTerms, type PenaltyTerms } from "@/lib/option-penalty";

/**
 * Calculate contract end date from start date + period.
 * הסיום הוא היום האחרון של התקופה (כלול), לא יום השנה עצמו: 10 שנים
 * מ-1.9.2026 מסתיימות ב-31.8.2036 בסוף היום — לא ב-1.9.2036, שהיה
 * מוסיף יום שכירות מלא מעבר לתקופה החוזית.
 */
export function calculateEndDate(
  startDate: string,
  periodValue: number,
  periodUnit: "months" | "years"
): string {
  if (!startDate || !periodValue || periodValue <= 0) return "";
  try {
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return "";
    const plus =
      periodUnit === "months"
        ? addMonths(start, periodValue)
        : addYears(start, periodValue);
    const end = new Date(plus.getFullYear(), plus.getMonth(), plus.getDate() - 1);
    return format(end, "yyyy-MM-dd");
  } catch {
    return "";
  }
}

// ── Dynamic Price Tier for Step-Rent Builder ──
export type PriceTier = {
  increase_type: "pct" | "fixed_sqm" | "fixed_total" | "none";
  increase_value: number;
  from_year: number;
  to_year: number;
  is_recurring: boolean;
  recurring_every_years: number | null;
  calculated_rent_per_sqm: number | null;
  notes: string;
};

export type ExtensionOption = {
  duration_months: number;
  duration_years: number;
  notice_type: "exercise" | "non_renewal" | "auto";
  notice_days_before_end: number;
  rent_mechanism: "no_change" | "increase_pct" | "new_value";
  new_rent_value: number | null;
  rent_increase_pct: number | null;
  auto_renewal: boolean;
  start_date: string;
  end_date: string;
  notes: string;
  // Price schedule within the option period
  price_schedule_type: "inherit" | "custom";
  price_tiers: PriceTier[];
  // Revenue leases: the turnover percentage can have its own schedule inside
  // the option period (year 1 = the option's first year). Empty = unchanged.
  revenue_pct_tiers?: Array<{ from_year: number; to_year: number; pct: number; notes?: string | null }>;
  // Alternative options: same group = choose one (A or B)
  option_group: string | null; // null = sequential, "A"/"B" = alternatives
  // Exit points: tenant can exit early at specific years
  exit_points: Array<{ year: number; notice_days: number; penalty_months: number }>;
  // Compensation owed if the option is NOT exercised
  non_exercise_penalty: PenaltyTerms;
};

export type IncreaseStep = {
  type: "pct" | "fixed" | "none";
  value: number;
  from_year: number;
  to_year: number;
};

export function emptyPriceTier(fromYear: number = 1): PriceTier {
  return {
    increase_type: "pct",
    increase_value: 0,
    from_year: fromYear,
    // from == to → the step fires exactly once, at the end of lease year
    // `fromYear`. This is the common contract shape; a multi-year range means
    // "an increase in EVERY year of the range" and is chosen explicitly.
    to_year: fromYear,
    is_recurring: false,
    recurring_every_years: null,
    calculated_rent_per_sqm: null,
    notes: "",
  };
}

/**
 * Validate price tiers: no year overlaps, within contract duration.
 * Returns array of error strings (empty = valid).
 */
export function validatePriceTiers(
  tiers: PriceTier[],
  contractYears: number
): string[] {
  const errors: string[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (t.from_year > t.to_year) {
      errors.push(`שלב ${i + 1}: שנת התחלה גדולה משנת סיום`);
    }
    if (t.to_year > contractYears && contractYears > 0) {
      errors.push(`שלב ${i + 1}: חורג מתקופת החוזה (${contractYears} שנים)`);
    }
    if (t.increase_type !== "none" && (!t.increase_value || t.increase_value <= 0)) {
      errors.push(`שלב ${i + 1}: חסר ערך עלייה`);
    }
    // Check overlaps with other tiers by ACTUAL FIRING YEARS — a recurring
    // "every 5 years, years 1-10" fires only in years 1 and 6, so a one-off
    // step at year 7 is a valid schedule, not an overlap.
    for (let j = i + 1; j < tiers.length; j++) {
      const o = tiers[j];
      const horizon = Math.max(t.to_year || 0, o.to_year || 0, contractYears || 0, 1);
      const clash: number[] = [];
      for (let y = 1; y <= horizon; y++) {
        if (tierAppliesAtYear(t, y) && tierAppliesAtYear(o, y)) clash.push(y);
      }
      if (clash.length > 0) {
        const oS = clash[0], oE = clash[clash.length - 1];
        errors.push(
          `שלבים ${i + 1} ו-${j + 1}: שניהם מגדירים עלייה בתום שנה ${oS === oE ? String(oS) : oS + "–" + oE}` +
          ` — שתי עליות באותה שנה. למדרגה חד-פעמית קבע רק "בתום שנת שכירות", בלי טווח.`);
      }
    }
  }
  return errors;
}

/**
 * Single source of truth for "does this tier apply at contract year N?"
 *
 * Used everywhere a year-by-year tier walk happens (AdvancesTab,
 * CpiDiffTab fallback, anywhere else that iterates tiers per contract year).
 *
 * Semantics — matched against `expandRecurringTiers` below so the rate
 * timeline shown in the contract details page agrees with what advances /
 * CPI-diff compute:
 *
 * - Recurring tier (from_year=F, to_year=T, every=E):
 *     fires when `F ≤ ty < T` AND `(ty - F) % E === 0`
 *     i.e. firings produce (T − F) / E increments by year T.
 *     The year-T rent IS the result of all firings; ty=T does NOT fire.
 *
 * - Non-recurring tier (from_year=F, to_year=T):
 *     fires inclusively across [F, T]. Existing behaviour preserved.
 *
 * Pass any tier-shaped object — tests like `t.is_recurring`,
 * `t.from_year`, `t.to_year`, `t.recurring_every_years` are duck-typed
 * so DB rows and PriceTier objects both work.
 */
export function tierAppliesAtYear(
  tier: { is_recurring?: boolean | null; from_year?: number | null; to_year?: number | null; recurring_every_years?: number | null; },
  contractYear: number,
): boolean {
  if (tier.is_recurring) {
    const every = Number(tier.recurring_every_years) || 1;
    const fromY = Number(tier.from_year) || 1;
    const toY = Number(tier.to_year) || 999;
    return contractYear >= fromY && contractYear < toY && (contractYear - fromY) % every === 0;
  }
  const fromY = Number(tier.from_year) || 1;
  const toY = Number(tier.to_year) || fromY;
  return contractYear >= fromY && contractYear <= toY;
}

/**
 * SINGLE SOURCE OF TRUTH for "what rent does the contract require at date X"
 * for one specific space.
 *
 * Returns a chronological schedule of rent changes (one entry per change
 * point). To find the rent at any date: take the last entry whose
 * `date <= queryDate`.
 *
 * Handles every escalation mechanism the system supports:
 *   • Base rent at contract start (per-sqm × area or fixed)
 *   • Per-space tiers (override contract-level when present)
 *   • Contract-level tiers (used when no per-space tiers)
 *   • Exercised options with rent_mechanism = new_value / increase_pct / no_change
 *   • Each option's internal price_tiers (the JSONB array on contract_options)
 *
 * Both AdvancesTab and CpiDiffTab's fallback call this — so the rent
 * timeline shown in the contract details page (which already uses
 * buildPriceTimeline correctly) STAYS IN AGREEMENT with what advances
 * and CPI-diff produce.
 */
export type RentScheduleEntry = { date: Date; rentMonthly: number; source: string };

export function buildSpaceRentSchedule(params: {
  contractStartDate: string;
  spaceArea: number;
  isFixed: boolean;
  spaceBaseRent: number;
  spaceTiers: any[];
  contractTiers: any[];
  exercisedOptions: any[];
}): RentScheduleEntry[] {
  const { contractStartDate, spaceArea, isFixed, spaceBaseRent, spaceTiers, contractTiers, exercisedOptions } = params;
  const schedule: RentScheduleEntry[] = [];
  const contractStart = new Date(contractStartDate);

  function applyTier(rent: number, tier: any): number {
    const v = Number(tier.increase_value) || 0;
    if (tier.increase_type === "pct") return rent * (1 + v / 100);
    if (tier.increase_type === "fixed_sqm") return rent + v * spaceArea;
    if (tier.increase_type === "fixed_total") return rent + v;
    return rent;
  }

  let currentRent = spaceBaseRent;
  schedule.push({ date: contractStart, rentMonthly: currentRent, source: "base" });

  // Phase 1 — apply contract-level / per-space tiers up to some horizon
  // (use max to_year of any tier so we cover them all).
  const activeTiers = spaceTiers.length > 0 ? spaceTiers : contractTiers;
  const maxTierYear = activeTiers.reduce((m: number, t: any) => Math.max(m, Number(t.to_year) || 1), 0);
  for (let ty = 1; ty <= maxTierYear; ty++) {
    const tier = activeTiers.find((t: any) => tierAppliesAtYear(t, ty));
    if (tier) {
      const annDate = new Date(contractStart);
      annDate.setFullYear(annDate.getFullYear() + ty);
      const newRent = applyTier(currentRent, tier);
      if (Math.abs(newRent - currentRent) > 0.005) {
        schedule.push({ date: annDate, rentMonthly: newRent, source: `tier_y${ty}` });
        currentRent = newRent;
      }
    }
  }

  // Phase 2 — apply exercised options (chronologically by start_date)
  const opts = [...(exercisedOptions || [])]
    .filter((o: any) => o && o.is_exercised && o.start_date)
    .sort((a: any, b: any) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

  for (const opt of opts) {
    const optStart = new Date(opt.start_date);

    // Option's base rate change
    let rentAtOpt = currentRent;
    if (opt.rent_mechanism === "new_value" && opt.new_rent_value) {
      rentAtOpt = isFixed ? Number(opt.new_rent_value) : Number(opt.new_rent_value) * spaceArea;
    } else if (opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct) {
      rentAtOpt = currentRent * (1 + Number(opt.rent_increase_pct) / 100);
    }
    // "no_change" → keep currentRent
    if (Math.abs(rentAtOpt - currentRent) > 0.005) {
      schedule.push({ date: optStart, rentMonthly: rentAtOpt, source: `opt_${opt.option_number || "?"}_base` });
      currentRent = rentAtOpt;
    }

    // Option's internal price_tiers (JSONB on contract_options)
    const optTiers = Array.isArray(opt.price_tiers) ? opt.price_tiers : [];
    const optMaxYear = optTiers.reduce((m: number, t: any) => Math.max(m, Number(t.to_year) || 1), 0);
    for (let oy = 1; oy <= optMaxYear; oy++) {
      const tier = optTiers.find((t: any) => tierAppliesAtYear(t, oy));
      if (tier) {
        const optAnnDate = new Date(optStart);
        optAnnDate.setFullYear(optAnnDate.getFullYear() + oy - 1);
        const newRent = applyTier(currentRent, tier);
        if (Math.abs(newRent - currentRent) > 0.005) {
          schedule.push({ date: optAnnDate, rentMonthly: newRent, source: `opt_${opt.option_number || "?"}_y${oy}` });
          currentRent = newRent;
        }
      }
    }
  }

  schedule.sort((a, b) => a.date.getTime() - b.date.getTime());
  return schedule;
}

/**
 * Pick the rent applicable at a specific date from a schedule.
 * Returns the last entry whose `date <= queryDate`.
 */
export function rentAtDate(schedule: RentScheduleEntry[], queryDate: Date): number {
  let r = schedule[0]?.rentMonthly ?? 0;
  for (const e of schedule) {
    if (e.date.getTime() <= queryDate.getTime()) r = e.rentMonthly;
    else break;
  }
  return r;
}

export type RentPeriodChange = { date: Date; from: number; to: number };

/**
 * Rent owed for an arbitrary period [periodStart, periodEnd] (both inclusive),
 * computed by walking the ACTUAL schedule segments — not a single
 * before/after pair. Handles any number of rent changes inside the period
 * (e.g. a tier anniversary in March AND an exercised option in October of the
 * same year), and prorates the entry/exit months by days-in-month, so a unit
 * entering mid-month is never billed a full month just because the month also
 * contains a rent change.
 *
 * Month-by-month walk: each calendar month overlapping the period contributes
 * Σ over rent segments of  monthlyRate × (segment days in month ∩ period) / daysInMonth.
 * A change effective on day D bills days 1..D-1 at the old rate and D..end at
 * the new rate — same convention as the historical mid-month split.
 *
 * `monthlyAddend` is added to every segment's monthly rate (e.g. an
 * investment rent addition that is part of the rent but not in the schedule);
 * `rateMultiplier` scales every rate (e.g. the CPI ratio).
 *
 * Returns the period total plus the list of change points that fall inside
 * the period (for labelling), with from/to already addend+multiplier adjusted.
 */
export function rentForPeriod(params: {
  schedule: RentScheduleEntry[];
  periodStart: Date;
  periodEnd: Date;
  monthlyAddend?: number;
  rateMultiplier?: number;
}): { total: number; changes: RentPeriodChange[] } {
  const { schedule, periodStart, periodEnd } = params;
  const addend = params.monthlyAddend ?? 0;
  const mult = params.rateMultiplier ?? 1;
  if (periodEnd < periodStart || schedule.length === 0) return { total: 0, changes: [] };

  // Normalize to local-midnight day granularity: schedule dates parsed from
  // ISO strings are UTC midnight, period bounds are local-midnight Dates.
  const toDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const pStart = toDay(periodStart);
  const pEnd = toDay(periodEnd);
  const rateAt = (d: Date) => (rentAtDate(schedule, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)) + addend) * mult;

  // Change points strictly inside the period (a change ON pStart just sets
  // the opening rate — it is not a mid-period split).
  const changes: RentPeriodChange[] = [];
  let prevRate = rateAt(pStart);
  for (const e of schedule) {
    const d = toDay(e.date);
    if (d <= pStart || d > pEnd) continue;
    const newRate = (e.rentMonthly + addend) * mult;
    if (Math.abs(newRate - prevRate) > 0.005) {
      changes.push({ date: d, from: prevRate, to: newRate });
      prevRate = newRate;
    }
  }

  let total = 0;
  const cursor = new Date(pStart.getFullYear(), pStart.getMonth(), 1);
  while (cursor <= pEnd) {
    const mStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const mEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const dim = mEnd.getDate();
    const clipStart = mStart < pStart ? pStart : mStart;
    const clipEnd = mEnd > pEnd ? pEnd : mEnd;
    if (clipStart <= clipEnd) {
      // Segment boundaries inside this month's clipped window
      const bounds = [clipStart];
      for (const ch of changes) {
        if (ch.date > clipStart && ch.date <= clipEnd) bounds.push(ch.date);
      }
      for (let i = 0; i < bounds.length; i++) {
        const segStart = bounds[i];
        const segEnd = i + 1 < bounds.length
          ? new Date(bounds[i + 1].getFullYear(), bounds[i + 1].getMonth(), bounds[i + 1].getDate() - 1)
          : clipEnd;
        const days = Math.round((segEnd.getTime() - segStart.getTime()) / 86400000) + 1;
        total += rateAt(segStart) * days / dim;
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return { total, changes };
}

/**
 * Expand recurring tiers into individual year-by-year tiers.
 * Example: { is_recurring: true, recurring_every_years: 1, from_year: 1, to_year: 10 }
 * → 9 individual firings (years 1..9; year 10 does not fire — the year-10 rent
 *   IS the result of the 9 increases, matching tierAppliesAtYear)
 */
export function expandRecurringTiers(tiers: PriceTier[]): PriceTier[] {
  const expanded: PriceTier[] = [];
  for (const tier of tiers) {
    if (tier.is_recurring) {
      const step = tier.recurring_every_years || 1;
      for (let y = tier.from_year; y < tier.to_year; y += step) {
        expanded.push({
          ...tier,
          from_year: y,
          to_year: Math.min(y + step, tier.to_year),
          is_recurring: false,
          recurring_every_years: null,
        });
      }
    } else if ((Number(tier.to_year) || tier.from_year) > tier.from_year) {
      // An annual-increase range: fires at the end of every year in [from, to],
      // exactly as tierAppliesAtYear bills it. Shown unexpanded it looked like
      // a single increase, so the preview/timeline understated the rent while
      // the cheques compounded it.
      for (let y = tier.from_year; y <= tier.to_year; y++) {
        expanded.push({ ...tier, from_year: y, to_year: y });
      }
    } else {
      expanded.push(tier);
    }
  }
  return expanded;
}

/**
 * Calculate preview rent for each tier based on base rent.
 * Expands recurring tiers first, then calculates sequential increases.
 * Returns tiers with calculated_rent_per_sqm filled in.
 */
export function calculateTierPreviews(
  tiers: PriceTier[],
  baseRentPerSqm: number
): PriceTier[] {
  const expanded = expandRecurringTiers(tiers);
  const sorted = [...expanded].sort((a, b) => a.from_year - b.from_year);
  let currentRent = baseRentPerSqm;

  return sorted.map((tier) => {
    let calcRent: number;
    switch (tier.increase_type) {
      case "pct":
        calcRent = currentRent * (1 + (tier.increase_value || 0) / 100);
        break;
      case "fixed_sqm":
        calcRent = currentRent + (tier.increase_value || 0);
        break;
      case "fixed_total":
        calcRent = currentRent + (tier.increase_value || 0);
        break;
      case "none":
        calcRent = currentRent;
        break;
      default:
        calcRent = currentRent;
    }
    currentRent = calcRent;
    return { ...tier, calculated_rent_per_sqm: Math.round(calcRent * 100) / 100 };
  });
}

/**
 * Chain-calculate option start/end dates.
 * Option[0] starts at contractEndDate, option[1] starts at option[0] end, etc.
 */
/**
 * Chain-calculate option start/end dates.
 * Sequential options chain after previous. Alternative options (same group)
 * start from the same point (contract end or previous sequential option end).
 */
export function calculateOptionDates(
  contractEndDate: string,
  options: ExtensionOption[]
): ExtensionOption[] {
  if (!contractEndDate || options.length === 0) return options;

  // Track the "anchor" point for each group level
  let sequentialEnd = contractEndDate; // end of last sequential or first-in-group option
  let groupAnchor = contractEndDate;   // start point for alternatives in current group
  let lastGroup: string | null = null;

  return options.map((opt, idx) => {
    let start: string;

    if (opt.option_group) {
      // Alternative option: check if this is a NEW group or same group as previous
      const prevOpt = idx > 0 ? options[idx - 1] : null;
      if (prevOpt?.option_group && prevOpt.option_group !== opt.option_group && lastGroup === prevOpt.option_group) {
        // Different group letter but same "family" — start from same anchor
        start = groupAnchor;
      } else if (!prevOpt?.option_group || prevOpt.option_group !== opt.option_group) {
        // First option in a new alternative group — anchor = contract end or last sequential end
        groupAnchor = sequentialEnd;
        start = groupAnchor;
      } else {
        // Same group as previous — start from same anchor
        start = groupAnchor;
      }
      lastGroup = opt.option_group;
    } else {
      // Sequential option
      start = sequentialEnd;
      lastGroup = null;
    }

    let end = start;
    if (opt.duration_years > 0) {
      end = format(addYears(new Date(start), opt.duration_years), "yyyy-MM-dd");
    } else if (opt.duration_months > 0) {
      end = format(addMonths(new Date(start), opt.duration_months), "yyyy-MM-dd");
    }

    // Only advance sequentialEnd for non-alternative options (or first in group)
    if (!opt.option_group) {
      sequentialEnd = end;
    }

    return { ...opt, start_date: start, end_date: end, duration_months: Math.round((opt.duration_years || 0) * 12) || opt.duration_months };
  });
}

/**
 * Calculate deposit/guarantee amount.
 * Ported from BS44 LeaseForm.jsx lines 260-300.
 */
export function calculateDepositAmount(params: {
  depositMethod: "months_based" | "fixed_amount";
  depositMonths: number;
  fixedAmount: number;
  monthlyRent: number;
  managementFee: number;
  includesManagement: boolean;
  vatPct: number;
}): number {
  const {
    depositMethod,
    depositMonths,
    fixedAmount,
    monthlyRent,
    managementFee,
    includesManagement,
    vatPct,
  } = params;

  if (depositMethod === "fixed_amount") {
    return Math.round(fixedAmount);
  }

  const mgmt = includesManagement ? managementFee : 0;
  const vatMultiplier = 1 + vatPct / 100;
  return Math.round((monthlyRent + mgmt) * depositMonths * vatMultiplier);
}

export function emptyOption(group: string | null = null): ExtensionOption {
  return {
    duration_months: 12,
    duration_years: 1,
    notice_type: "exercise",
    notice_days_before_end: 90,
    rent_mechanism: "no_change",
    new_rent_value: null,
    rent_increase_pct: null,
    auto_renewal: false,
    start_date: "",
    end_date: "",
    notes: "",
    price_schedule_type: "inherit",
    price_tiers: [],
    option_group: group,
    exit_points: [],
    non_exercise_penalty: emptyPenaltyTerms(),
  };
}

export function emptyIncreaseStep(fromYear: number = 1): IncreaseStep {
  return {
    type: "pct",
    value: 0,
    from_year: fromYear,
    to_year: fromYear + 2,
  };
}

/**
 * Build a unified price timeline combining main contract tiers + option tiers.
 * Each entry has: period label, date range, rent/sqm, source (main / option N).
 */
export type TimelineEntry = {
  label: string;
  startDate: string;
  endDate: string;
  rentPerSqm: number | null;
  fixedAmount: number | null;
  source: string;
  type: string;
};

export function buildPriceTimeline(params: {
  contractStart: string;
  contractEnd: string;
  baseRentPerSqm: number;
  mainTiers: PriceTier[];
  options: ExtensionOption[];
}): TimelineEntry[] {
  const { contractStart, contractEnd, baseRentPerSqm, mainTiers, options } = params;
  const timeline: TimelineEntry[] = [];

  // ── Main-period effective end ──────────────────────────────────────
  // When an option is exercised, the system extends contract.end_date to
  // reflect the new "active until" date. That loses the original "where
  // the main period actually ends" information — except it's still
  // recoverable from the first exercised sequential option's start_date,
  // because that's exactly when the main rate transitions to the option
  // rate.
  // Without this cap the timeline shows the main period overlapping with
  // the option (e.g. main "2025-2028" + option 1 "2026-2028" — both
  // displayed as separate stripes even though the rent really transitions
  // on the option's start date). Functional calculations (advances /
  // CPI-diff) already pick the later-starting period, but the display
  // misled users into thinking the main period ran until contractEnd.
  const firstExercisedSeqOption = options.find(o =>
    o && (o as any).is_exercised && !o.option_group && o.start_date
  );
  const mainEffectiveEnd = firstExercisedSeqOption?.start_date
    && new Date(firstExercisedSeqOption.start_date) < new Date(contractEnd)
      ? firstExercisedSeqOption.start_date
      : contractEnd;

  // Base period (year 0 = before any tier kicks in)
  const mainPreviews = calculateTierPreviews(mainTiers, baseRentPerSqm);

  if (mainTiers.length === 0) {
    timeline.push({
      label: "תקופה ראשית",
      startDate: contractStart,
      endDate: mainEffectiveEnd,
      rentPerSqm: baseRentPerSqm,
      fixedAmount: null,
      source: "main",
      type: "base",
    });
  } else {
    // Base period — runs at base rent from contract start UNTIL the first
    // tier kicks in. Previously this was hardcoded to a fixed 1-year base
    // entry ("שנה 1"), which left a visible gap whenever the first tier
    // started at year 2+ (e.g. recurring "+4% every 5 years starting year 5"
    // showed `שנה 1 (2021-2022)` then jumped to `שנים 6-10 (2026-2031)` —
    // years 2-5 invisible). Functionally calculations were correct because
    // buildSpaceRentSchedule only emits change points, not gap fills; this
    // is a display-only fix to make the timeline match the contract terms.
    const firstPreviewYear = mainPreviews[0]?.from_year ?? 1;
    const mainEndObj = new Date(mainEffectiveEnd);
    const baseEnd = new Date(contractStart);
    baseEnd.setFullYear(baseEnd.getFullYear() + firstPreviewYear);
    const clippedBaseEnd = baseEnd < mainEndObj ? baseEnd : mainEndObj;
    if (clippedBaseEnd > new Date(contractStart)) {
      const baseLabel = firstPreviewYear === 1 ? "שנה 1" : `שנים 1-${firstPreviewYear}`;
      timeline.push({
        label: baseLabel,
        startDate: contractStart,
        endDate: format(clippedBaseEnd, "yyyy-MM-dd"),
        rentPerSqm: baseRentPerSqm,
        fixedAmount: null,
        source: "main",
        type: "base",
      });
    }
    // Add each expanded tier as individual year, clipping at mainEffectiveEnd
    mainPreviews.forEach((tier, ti) => {
      const tStart = new Date(contractStart);
      tStart.setFullYear(tStart.getFullYear() + tier.from_year);
      if (tStart >= mainEndObj) return; // tier starts after main period — skip
      // A firing at the end of year N sets the price for years N+1 .. the next
      // firing (expandRecurringTiers emits single-year entries, from == to).
      const next = mainPreviews[ti + 1];
      const endYearNum = tier.to_year > tier.from_year ? tier.to_year : (next ? next.from_year : 0);
      const tEnd = new Date(contractStart);
      if (endYearNum > 0) tEnd.setFullYear(tEnd.getFullYear() + endYearNum);
      else tEnd.setTime(mainEndObj.getTime());
      const clippedEnd = tEnd < mainEndObj ? tEnd : mainEndObj;
      const firstYear = tier.from_year + 1;
      const yearLabel = endYearNum === 0
        ? (firstYear ? `משנה ${firstYear}` : "")
        : endYearNum <= firstYear ? `שנה ${firstYear}` : `שנים ${firstYear}-${endYearNum}`;
      timeline.push({
        label: yearLabel,
        startDate: format(tStart, "yyyy-MM-dd"),
        endDate: format(clippedEnd, "yyyy-MM-dd"),
        rentPerSqm: tier.calculated_rent_per_sqm,
        fixedAmount: null,
        source: "main",
        type: tier.increase_type,
      });
    });

    // הזנב שאחרי המדרגה האחרונה: המחיר האחרון ממשיך עד תום התקופה
    // הראשית. expandRecurringTiers פולט מדרגות עם to_year > from_year,
    // כך שהמדרגה האחרונה נחתכה בגבול השנה שלה — וחוזה 5 שנים עם עלייה
    // "עד שנה 4" הציג רק 4 שורות (שנה 5 נעלמה). החיוב תמיד המשיך נכון
    // (לוח המדרגות שומר את המחיר האחרון) — הפער היה בתצוגה בלבד.
    const lastMain = timeline[timeline.length - 1];
    if (lastMain && lastMain.source === "main") {
      const lastEnd = new Date(lastMain.endDate);
      if (lastEnd < mainEndObj) {
        const csMs = new Date(contractStart).getTime();
        const yrsDone = Math.round((lastEnd.getTime() - csMs) / (365.25 * 86400000));
        const totalYrs = Math.round((mainEndObj.getTime() - csMs) / (365.25 * 86400000));
        const firstYear = yrsDone + 1;
        timeline.push({
          label: totalYrs <= firstYear ? `שנה ${firstYear}` : `שנים ${firstYear}-${totalYrs}`,
          startDate: format(lastEnd, "yyyy-MM-dd"),
          endDate: format(mainEndObj, "yyyy-MM-dd"),
          rentPerSqm: lastMain.rentPerSqm,
          fixedAmount: lastMain.fixedAmount,
          source: "main",
          type: "continuation",
        });
      }
    }
  }

  // Options
  let lastMainRent = mainPreviews.length > 0
    ? (mainPreviews[mainPreviews.length - 1].calculated_rent_per_sqm ?? baseRentPerSqm)
    : baseRentPerSqm;
  const contractLastRent = lastMainRent; // save for alternatives

  // Track option numbering per group for naming (1A, 1B instead of 1, 2)
  var optionGroupCount: Record<string, number> = {};
  var sequentialNum = 0;

  options.forEach((opt, i) => {
    if (!opt.start_date || !opt.end_date) return;

    // Generate label: "אופציה 1" for sequential, "אופציה 1A" / "אופציה 1B" for alternatives
    var optLabel: string;
    if (opt.option_group) {
      // All alternatives share the same number, differentiated by letter
      if (Object.keys(optionGroupCount).length === 0) sequentialNum++;
      if (!optionGroupCount[opt.option_group]) {
        optionGroupCount[opt.option_group] = sequentialNum;
      }
      optLabel = `אופציה ${optionGroupCount[opt.option_group]}${opt.option_group}`;
    } else {
      sequentialNum++;
      optionGroupCount = {}; // reset for next group
      optLabel = `אופציה ${sequentialNum}`;
    }

    // Alternatives start from contract end rent, not from previous option
    let optionBaseRent = opt.option_group ? contractLastRent : lastMainRent;
    if (opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct) {
      optionBaseRent = optionBaseRent * (1 + opt.rent_increase_pct / 100);
    } else if (opt.rent_mechanism === "new_value" && opt.new_rent_value) {
      optionBaseRent = opt.new_rent_value;
    }

    if (opt.price_schedule_type === "custom" && opt.price_tiers.length > 0) {
      const optPreviews = calculateTierPreviews(opt.price_tiers, optionBaseRent);
      const optStart = new Date(opt.start_date);
      const sortedTiers = [...optPreviews].sort((a, b) => a.from_year - b.from_year);

      // Add base period before first custom tier (e.g. years 1-4 at exercise price)
      if (sortedTiers[0]?.from_year > 1) {
        const baseEnd = new Date(optStart);
        baseEnd.setFullYear(baseEnd.getFullYear() + sortedTiers[0].from_year - 1);
        timeline.push({
          label: `${optLabel} — שנים 1-${sortedTiers[0].from_year - 1}`,
          startDate: opt.start_date,
          endDate: format(baseEnd, "yyyy-MM-dd"),
          rentPerSqm: optionBaseRent,
          fixedAmount: null,
          source: `option_${i + 1}`,
          type: "base",
        });
      }

      sortedTiers.forEach((tier) => {
        const tierStart = new Date(optStart);
        tierStart.setFullYear(tierStart.getFullYear() + tier.from_year - 1);
        const tierEnd = new Date(optStart);
        tierEnd.setFullYear(tierEnd.getFullYear() + tier.to_year);
        timeline.push({
          label: `${optLabel} — שנים ${tier.from_year}-${tier.to_year}`,
          startDate: format(tierStart, "yyyy-MM-dd"),
          endDate: format(tierEnd, "yyyy-MM-dd"),
          rentPerSqm: tier.increase_type === "fixed_total" ? null : tier.calculated_rent_per_sqm,
          fixedAmount: tier.increase_type === "fixed_total" ? tier.increase_value : null,
          source: `option_${i + 1}`,
          type: tier.increase_type,
        });
      });
      lastMainRent = sortedTiers[sortedTiers.length - 1]?.calculated_rent_per_sqm ?? optionBaseRent;
    } else {
      // "Inherit from main contract" — continue main contract's recurring increase pattern
      const optYears = opt.duration_years || (opt.duration_months ? opt.duration_months / 12 : 0);
      const roundedYears = Math.ceil(optYears);

      if (mainTiers.length > 0 && roundedYears > 1) {
        // For each recurring mainTier, generate tiers covering the option period
        // E.g. mainTier "every 5 years 4%" → option of 14 years gets: year 5, year 10 increases
        const virtualTiers: PriceTier[] = [];
        mainTiers.forEach(function(mt) {
          if (mt.is_recurring && mt.recurring_every_years) {
            // Recurring: generate for entire option period
            var step = mt.recurring_every_years;
            for (var y = step; y < roundedYears; y += step) {
              virtualTiers.push({
                ...mt,
                from_year: y,
                to_year: Math.min(y + step, roundedYears),
                is_recurring: false,
                recurring_every_years: null,
              });
            }
          } else {
            // Non-recurring: apply if within option period
            if (mt.from_year < roundedYears) {
              virtualTiers.push({
                ...mt,
                to_year: Math.min(mt.to_year, roundedYears),
              });
            }
          }
        });

        if (virtualTiers.length > 0) {
          const optPreviews = calculateTierPreviews(virtualTiers, optionBaseRent);
          const optStart = new Date(opt.start_date);

          // Base year 1 at option exercise price
          const baseEnd = new Date(optStart);
          baseEnd.setFullYear(baseEnd.getFullYear() + 1);
          timeline.push({
            label: `${optLabel} — שנה 1`,
            startDate: opt.start_date,
            endDate: format(baseEnd, "yyyy-MM-dd"),
            rentPerSqm: optionBaseRent,
            fixedAmount: null,
            source: `option_${i + 1}`,
            type: "base",
          });

          optPreviews.forEach(function(tier, tIdx) {
            const tierStart = new Date(optStart);
            tierStart.setFullYear(tierStart.getFullYear() + tier.from_year);
            const nextT: any = optPreviews[tIdx + 1];
            const endYearNum = tier.to_year > tier.from_year ? tier.to_year : (nextT ? nextT.from_year : tier.from_year + 1);
            const tierEnd = new Date(optStart);
            tierEnd.setFullYear(tierEnd.getFullYear() + endYearNum);
            const firstYear = tier.from_year + 1;
            const yearLabel = endYearNum <= firstYear
              ? `${optLabel} — שנה ${firstYear}`
              : `${optLabel} — שנים ${firstYear}-${endYearNum}`;
            timeline.push({
              label: yearLabel,
              startDate: format(tierStart, "yyyy-MM-dd"),
              endDate: format(tierEnd, "yyyy-MM-dd"),
              rentPerSqm: tier.increase_type === "fixed_total" ? null : tier.calculated_rent_per_sqm,
              fixedAmount: tier.increase_type === "fixed_total" ? tier.increase_value : null,
              source: `option_${i + 1}`,
              type: tier.increase_type,
            });
          });
          lastMainRent = optPreviews[optPreviews.length - 1]?.calculated_rent_per_sqm ?? optionBaseRent;
        } else {
          // No applicable tiers — show single entry
          timeline.push({
            label: `${optLabel}`,
            startDate: opt.start_date,
            endDate: opt.end_date,
            rentPerSqm: optionBaseRent,
            fixedAmount: null,
            source: `option_${i + 1}`,
            type: opt.rent_mechanism === "no_change" ? "none" : "jump",
          });
          lastMainRent = optionBaseRent;
        }
      } else {
        // No main tiers or single year option — show single entry
        timeline.push({
          label: `${optLabel}`,
          startDate: opt.start_date,
          endDate: opt.end_date,
          rentPerSqm: optionBaseRent,
          fixedAmount: null,
          source: `option_${i + 1}`,
          type: opt.rent_mechanism === "no_change" ? "none" : "jump",
        });
        lastMainRent = optionBaseRent;
      }
    }
  });

  return timeline;
}
