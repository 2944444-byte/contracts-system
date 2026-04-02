import { addMonths, addYears, format } from "date-fns";

/**
 * Calculate contract end date from start date + period.
 * Ported from BS44 LeaseForm.jsx lines 153-178.
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
    const end =
      periodUnit === "months"
        ? addMonths(start, periodValue)
        : addYears(start, periodValue);
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
  // Alternative options: same group = choose one (A or B)
  option_group: string | null; // null = sequential, "A"/"B" = alternatives
  // Exit points: tenant can exit early at specific years
  exit_points: Array<{ year: number; notice_days: number; penalty_months: number }>;
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
    to_year: fromYear + 2,
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
    // Check overlaps with other tiers
    for (let j = i + 1; j < tiers.length; j++) {
      const o = tiers[j];
      if (t.from_year <= o.to_year && t.to_year >= o.from_year) {
        errors.push(`שלבים ${i + 1} ו-${j + 1}: חפיפה בשנים`);
      }
    }
  }
  return errors;
}

/**
 * Expand recurring tiers into individual year-by-year tiers.
 * Example: { is_recurring: true, recurring_every_years: 1, from_year: 1, to_year: 10 }
 * → 10 individual tiers: year 1-2, 2-3, 3-4, ..., 9-10
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
        calcRent = tier.increase_value || currentRent;
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
 * Uses duration_years as primary (falls back to duration_months for legacy).
 */
export function calculateOptionDates(
  contractEndDate: string,
  options: ExtensionOption[]
): ExtensionOption[] {
  if (!contractEndDate || options.length === 0) return options;
  let prevEnd = contractEndDate;
  return options.map((opt) => {
    const start = prevEnd;
    let end = start;
    if (opt.duration_years > 0) {
      end = format(addYears(new Date(start), opt.duration_years), "yyyy-MM-dd");
    } else if (opt.duration_months > 0) {
      end = format(addMonths(new Date(start), opt.duration_months), "yyyy-MM-dd");
    }
    prevEnd = end;
    return { ...opt, start_date: start, end_date: end, duration_months: (opt.duration_years || 0) * 12 || opt.duration_months };
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

  // Base period (year 0 = before any tier kicks in)
  const mainPreviews = calculateTierPreviews(mainTiers, baseRentPerSqm);

  if (mainTiers.length === 0) {
    timeline.push({
      label: "תקופה ראשית",
      startDate: contractStart,
      endDate: contractEnd,
      rentPerSqm: baseRentPerSqm,
      fixedAmount: null,
      source: "main",
      type: "base",
    });
  } else {
    // Always add base year (year 1) at base price
    const firstPreviewYear = mainPreviews[0]?.from_year ?? 2;
    if (firstPreviewYear >= 1) {
      const baseEnd = new Date(contractStart);
      baseEnd.setFullYear(baseEnd.getFullYear() + 1);
      timeline.push({
        label: "שנה 1",
        startDate: contractStart,
        endDate: format(baseEnd, "yyyy-MM-dd"),
        rentPerSqm: baseRentPerSqm,
        fixedAmount: null,
        source: "main",
        type: "base",
      });
    }
    // Add each expanded tier as individual year
    mainPreviews.forEach((tier) => {
      const tStart = new Date(contractStart);
      tStart.setFullYear(tStart.getFullYear() + tier.from_year);
      const tEnd = new Date(contractStart);
      tEnd.setFullYear(tEnd.getFullYear() + tier.to_year);
      const yearLabel = (tier.to_year - tier.from_year === 1)
        ? `שנה ${tier.to_year}`
        : `שנים ${tier.from_year + 1}-${tier.to_year}`;
      timeline.push({
        label: yearLabel,
        startDate: format(tStart, "yyyy-MM-dd"),
        endDate: format(tEnd, "yyyy-MM-dd"),
        rentPerSqm: tier.increase_type === "fixed_total" ? null : tier.calculated_rent_per_sqm,
        fixedAmount: tier.increase_type === "fixed_total" ? tier.increase_value : null,
        source: "main",
        type: tier.increase_type,
      });
    });
  }

  // Options
  let lastMainRent = mainPreviews.length > 0
    ? (mainPreviews[mainPreviews.length - 1].calculated_rent_per_sqm ?? baseRentPerSqm)
    : baseRentPerSqm;

  options.forEach((opt, i) => {
    if (!opt.start_date || !opt.end_date) return;

    // Exercise jump
    let optionBaseRent = lastMainRent;
    if (opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct) {
      optionBaseRent = lastMainRent * (1 + opt.rent_increase_pct / 100);
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
          label: `אופציה ${i + 1} — שנים 1-${sortedTiers[0].from_year - 1}`,
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
          label: `אופציה ${i + 1} — שנים ${tier.from_year}-${tier.to_year}`,
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
      timeline.push({
        label: `אופציה ${i + 1}`,
        startDate: opt.start_date,
        endDate: opt.end_date,
        rentPerSqm: optionBaseRent,
        fixedAmount: null,
        source: `option_${i + 1}`,
        type: opt.rent_mechanism === "no_change" ? "none" : "jump",
      });
      lastMainRent = optionBaseRent;
    }
  });

  return timeline;
}
