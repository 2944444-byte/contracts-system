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

/**
 * Chain-calculate option start/end dates.
 * Option[0] starts at contractEndDate, option[1] starts at option[0] end, etc.
 */
export function calculateOptionDates(
  contractEndDate: string,
  options: ExtensionOption[]
): ExtensionOption[] {
  if (!contractEndDate || options.length === 0) return options;
  let prevEnd = contractEndDate;
  return options.map((opt) => {
    const start = prevEnd;
    const end = opt.duration_months > 0
      ? format(addMonths(new Date(start), opt.duration_months), "yyyy-MM-dd")
      : start;
    prevEnd = end;
    return { ...opt, start_date: start, end_date: end };
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
