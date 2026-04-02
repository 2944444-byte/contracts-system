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

          optPreviews.forEach(function(tier) {
            const tierStart = new Date(optStart);
            tierStart.setFullYear(tierStart.getFullYear() + tier.from_year);
            const tierEnd = new Date(optStart);
            tierEnd.setFullYear(tierEnd.getFullYear() + tier.to_year);
            const yearLabel = (tier.to_year - tier.from_year === 1)
              ? `${optLabel} — שנה ${tier.to_year}`
              : `${optLabel} — שנים ${tier.from_year + 1}-${tier.to_year}`;
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
