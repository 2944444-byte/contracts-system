"use client";
import React from "react";
import { formatPeriod } from "@/lib/cpi-utils";

/**
 * "תראה לי איך חישבת" — drill-down of the full advance-check derivation.
 *
 * Given an AdvanceRow (with rentSchedule populated), renders every step
 * of how the check amount was reached: base rent → step-rent / option
 * escalations → CPI ratio (with peak month if highest_in_period) →
 * management + parking → VAT. Each step shows its formula AND its
 * result so the user can sanity-check without an external spreadsheet.
 *
 * Designed to replace the role Excel used to play during the migration:
 * once the user can see HOW each number was reached and verify the
 * inputs, they no longer need an external ground-truth file.
 */

function fmtMoney(n: number): string {
  return "₪" + (Math.round(n * 100) / 100).toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

function fmtMonthYear(s: string): string {
  if (!s) return "";
  // Accept "YYYY-M" / "YYYY-MM" / "YYYY-MM-DD"
  var parts = s.split("-");
  if (parts.length >= 2) {
    return formatPeriod(Number(parts[0]), Number(parts[1]));
  }
  return s;
}

function sourceLabel(source: string): string {
  if (source === "base") return "בסיס החוזה";
  if (source.startsWith("tier_y")) {
    var y = source.replace("tier_y", "");
    return `עליית מחיר — שנה ${y}`;
  }
  if (source.match(/^opt_(\w+)_base$/)) {
    var optN = source.match(/^opt_(\w+)_base$/)![1];
    return `אופציה ${optN} — מימוש`;
  }
  if (source.match(/^opt_(\w+)_y(\d+)$/)) {
    var m = source.match(/^opt_(\w+)_y(\d+)$/)!;
    return `אופציה ${m[1]} — שנה ${m[2]} בתוך האופציה`;
  }
  return source;
}

// One line in a breakdown section: label on the right, formula in middle,
// result on the left.
function Line({ label, formula, result, highlight }: {
  label: string;
  formula?: string;
  result?: string;
  highlight?: boolean;
}) {
  return (
    <div className={"flex items-center justify-between gap-3 py-1 text-xs " + (highlight ? "font-bold text-slate-900" : "text-slate-700")}>
      <span className="flex-shrink-0">{label}</span>
      {formula && <span className="text-slate-400 font-mono text-[11px] truncate">= {formula}</span>}
      {result && <span className={"font-mono " + (highlight ? "text-emerald-700 text-sm" : "text-slate-800")}>{result}</span>}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1.5">
        <span>{icon}</span>
        <span>{title}</span>
      </div>
      <div className="space-y-0.5 border-t border-slate-100 pt-1.5">
        {children}
      </div>
    </div>
  );
}

interface BreakdownRowShape {
  spaceArea: number;
  baseRentMonthly: number;
  indexedRentMonthly: number;
  rentBefore?: number;
  rentAfter?: number;
  rentChangeDate?: string;
  rentSchedule?: Array<{ date: string; rentMonthly: number; source: string }>;
  mgmtAdvanceMonthly: number;
  parkingMonthly: number;
  parkingSpots: number;
  cpiBaseValue: number;
  cpiBaseDate: string;
  cbsFromDate: string;
  cpiCurrentValue: number;
  cpiCurrentDate: string;
  cpiRatio: number;
  cpiPeakMonth?: string;
  indexationMethod: string;
  vatPct?: number;
  isQuarterly?: boolean;
}

export default function CalcBreakdown({ row, targetYear }: { row: BreakdownRowShape; targetYear: number }) {
  var area = row.spaceArea || 0;
  var schedule = row.rentSchedule || [];
  var vatMult = 1 + (row.vatPct || 0.18);
  var periodMonths = row.isQuarterly ? 3 : 1;
  var periodLabel = row.isQuarterly ? "רבעון" : "חודש";

  // Effective rent for the year (post-anniversary if there's a change)
  var rentInTargetYear = row.rentAfter ?? row.baseRentMonthly;

  // CPI display
  var baseMonthLabel = row.cbsFromDate ? fmtMonthYear(row.cbsFromDate)
    : (row.cpiBaseDate ? fmtMonthYear(row.cpiBaseDate) : "—");
  var currMonthLabel = row.cpiCurrentDate ? fmtMonthYear(row.cpiCurrentDate) : "—";
  var isHighest = row.indexationMethod === "highest_in_period" || row.indexationMethod === "no_drop";
  var peakLabel = row.cpiPeakMonth ? fmtMonthYear(row.cpiPeakMonth) : "";

  // Period totals
  var indexedPeriod = rentInTargetYear * row.cpiRatio * periodMonths;
  var mgmtPeriod = row.mgmtAdvanceMonthly * periodMonths;
  var parkingPeriod = row.parkingMonthly * periodMonths;
  var totalBeforeVat = indexedPeriod + mgmtPeriod + parkingPeriod;
  var totalWithVat = totalBeforeVat * vatMult;

  return (
    <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 space-y-2">
      <div className="text-xs font-bold text-slate-500 mb-1">🔍 תראה לי איך חישבת — {periodLabel} בודד</div>

      {/* Step 1: Base rent */}
      <Section title="1. שכ&quot;ד בסיס" icon="🏠">
        <Line
          label="שכ״ד תחילת החוזה"
          formula={area > 0 ? `${(schedule[0]?.rentMonthly / area || 0).toFixed(2)}/מ&quot;ר × ${area} מ&quot;ר` : undefined}
          result={fmtMoney(schedule[0]?.rentMonthly || row.baseRentMonthly) + "/חודש"}
        />
      </Section>

      {/* Step 2: Rent escalations (only if schedule has more than just base) */}
      {schedule.length > 1 && (
        <Section title="2. שינויי שכ&quot;ד לאורך החוזה" icon="📈">
          {schedule.map(function(e, i) {
            var prev = i > 0 ? schedule[i - 1].rentMonthly : 0;
            var delta = i > 0 ? e.rentMonthly - prev : 0;
            return (
              <Line
                key={i}
                label={fmtDate(e.date) + " — " + sourceLabel(e.source)}
                formula={i > 0 ? (delta > 0 ? "+" : "") + fmtMoney(delta) : undefined}
                result={fmtMoney(e.rentMonthly) + "/חודש"}
              />
            );
          })}
          <Line
            label={`שכ״ד לחודש בשנת ${targetYear}`}
            result={fmtMoney(rentInTargetYear)}
            highlight
          />
          {row.rentChangeDate && row.rentBefore !== undefined && row.rentAfter !== undefined && (
            <Line
              label={`שינוי בתוך השנה: מ-${fmtDate(row.rentChangeDate)}`}
              formula={`${fmtMoney(row.rentBefore)} → ${fmtMoney(row.rentAfter)}`}
            />
          )}
        </Section>
      )}

      {/* Step 3: CPI indexation */}
      {row.cpiRatio !== 1 && (
        <Section title="3. הצמדה למדד" icon="📊">
          <Line
            label={`מדד בסיס (${baseMonthLabel})`}
            result={String(row.cpiBaseValue || "—")}
          />
          {isHighest && peakLabel ? (
            <>
              <Line
                label={`מדד נוכחי (${currMonthLabel})`}
                result={String(row.cpiCurrentValue || "—")}
              />
              <Line
                label={`🔝 שיא בתקופה (${peakLabel})`}
                result="נבחר כמדד לחישוב"
                highlight
              />
            </>
          ) : (
            <Line
              label={`מדד לחישוב (${currMonthLabel})`}
              result={String(row.cpiCurrentValue || "—")}
            />
          )}
          <Line
            label="יחס הצמדה (מתוקן בידי הלמ״ס)"
            result={row.cpiRatio.toFixed(6)}
          />
          <Line
            label="שכ״ד צמוד לחודש"
            formula={`${fmtMoney(rentInTargetYear)} × ${row.cpiRatio.toFixed(6)}`}
            result={fmtMoney(rentInTargetYear * row.cpiRatio) + "/חודש"}
            highlight
          />
        </Section>
      )}

      {/* Step 4: Period composition */}
      <Section title={`4. חישוב ה${periodLabel} (${periodMonths} חודשים)`} icon="🧾">
        <Line
          label="שכ״ד צמוד"
          formula={`${fmtMoney(rentInTargetYear * row.cpiRatio)} × ${periodMonths}`}
          result={fmtMoney(indexedPeriod)}
        />
        <Line
          label="מקדמת ניהול"
          formula={`${fmtMoney(row.mgmtAdvanceMonthly)} × ${periodMonths}`}
          result={fmtMoney(mgmtPeriod)}
        />
        {parkingPeriod > 0 && (
          <Line
            label={`חניה (${row.parkingSpots} מקומות)`}
            formula={`${fmtMoney(row.parkingMonthly)} × ${periodMonths}`}
            result={fmtMoney(parkingPeriod)}
          />
        )}
        <Line
          label="סה״כ לפני מע״מ"
          result={fmtMoney(totalBeforeVat)}
          highlight
        />
        <Line
          label={`מע״מ ${Math.round((row.vatPct || 0.18) * 100)}%`}
          formula={`${fmtMoney(totalBeforeVat)} × ${(row.vatPct || 0.18).toFixed(2)}`}
          result={fmtMoney(totalBeforeVat * (row.vatPct || 0.18))}
        />
        <Line
          label={`💰 סכום שיק ${periodLabel} בודד`}
          formula={`${fmtMoney(totalBeforeVat)} × ${vatMult.toFixed(2)}`}
          result={fmtMoney(totalWithVat)}
          highlight
        />
      </Section>

      <div className="text-[10px] text-slate-400 mt-2 px-1">
        💡 הסכומים בפועל בטבלת השיקים עשויים להיות שונים מעט עקב מע״מ במע״מ ועיגול לשקלים שלמים על השיק.
      </div>
    </div>
  );
}
