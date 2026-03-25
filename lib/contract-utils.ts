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
};

export type IncreaseStep = {
  type: "pct" | "fixed" | "none";
  value: number;
  from_year: number;
  to_year: number;
};

// ── New: Dynamic Price Tier for Step-Rent Builder ──
export type PriceTier = {
  increase_type: "pct" | "fixed_sqm" | "fixed_total" | "none";
  increase_value: number;
  from_year: number;
  to_year: number;
  is_recurring: boolean;
  recurring_every_years: number | null;
  calculated_rent_per_sqm: number | null; // preview only, computed client-side
  notes: string;
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
 * Calculate preview rent for each tier based on base rent.
 * Returns tiers with calculated_rent_per_sqm filled in.
 */
export function calculateTierPreviews(
  tiers: PriceTier[],
  baseRentPerSqm: number
): PriceTier[] {
  // Sort by from_year for sequential calculation
  const sorted = [...tiers].sort((a, b) => a.from_year - b.from_year);
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

export function emptyOption(): ExtensionOption {
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
