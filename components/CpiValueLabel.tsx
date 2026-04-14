"use client";

import { formatPeriod } from "@/lib/cpi-utils";

interface Props {
  value: number | null | undefined;
  date?: string | Date | null;
  year?: number | null;
  month?: number | null;
  variant?: "inline" | "stacked";
  className?: string;
  valueClassName?: string;
  labelClassName?: string;
}

export function CpiValueLabel({
  value,
  date,
  year,
  month,
  variant = "stacked",
  className,
  valueClassName,
  labelClassName,
}: Props) {
  if (value == null || value === 0 || Number.isNaN(Number(value))) return null;

  let periodStr: string | null = null;
  if (year && month) {
    periodStr = formatPeriod(year, month);
  } else if (date) {
    const d = new Date(date as any);
    if (!isNaN(d.getTime())) {
      periodStr = formatPeriod(d.getFullYear(), d.getMonth() + 1);
    }
  }

  const label = periodStr ? `📊 מדד ${periodStr} = ${value}` : `📊 מדד = ${value}`;

  if (variant === "inline") {
    return (
      <span className={"text-xs text-blue-600 font-semibold " + (className || "")}>
        {label}
      </span>
    );
  }

  return (
    <div className={className || ""}>
      <div className={valueClassName || "font-semibold text-slate-700"}>{value}</div>
      <div className={labelClassName || "text-xs text-blue-600 mt-1 font-semibold"}>
        📊 מדד {periodStr ?? ""}
      </div>
    </div>
  );
}

export default CpiValueLabel;
