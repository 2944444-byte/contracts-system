"use client";
import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit-log";
import { fetchCpiAdjusted, fetchHighestChainedCpi } from "@/lib/cpi-server";
import CalcProgress, { CalcProgressState } from "./CalcProgress";
import { tierAppliesAtYear } from "@/lib/contract-utils";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function formatDateForCbs(dateStr: string): string | null {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  if (d.getDate() === 15) d.setDate(16);
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var dd = String(d.getDate()).padStart(2, "0");
  return mm + "-" + dd + "-" + d.getFullYear();
}

interface CpiDiffRow {
  contractId: string;
  tenantName: string;
  periods: Array<{
    label: string;
    baseRentQuarter: number;
    paymentDate: string;
    cpiMonth: string;
    cpiValue: number;
    cpiBaseMonth: string;
    cpiBaseValue: number;
    indexedRent: number;
    mgmtAdvance: number;
    shouldPay: number;
    actualPaid: number;
    difference: number;
  }>;
  totalDifference: number;
}

export default function CpiDiffTab({ properties }: { properties: any[] }) {
  const currentYear = new Date().getFullYear();
  const [propId, setPropId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState<CalcProgressState | null>(null);
  const [results, setResults] = useState<CpiDiffRow[]>([]);
  const [actualPaidInputs, setActualPaidInputs] = useState<Record<string, Record<string, string>>>({});
  const [creatingCharges, setCreatingCharges] = useState(false);
  const [creatingLetters, setCreatingLetters] = useState(false);
  const [savedMode, setSavedMode] = useState(false);
  const [savedInfo, setSavedInfo] = useState<{ count: number; savedAt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Option for combined letter
  const [includeAdvances, setIncludeAdvances] = useState(true);
  const [nextYear, setNextYear] = useState(currentYear + 1);

  // Auto-load saved on property/year change
  React.useEffect(function() {
    if (propId) checkSavedDiff();
  }, [propId, year]);

  async function checkSavedDiff() {
    var { data } = await supabase.from("cpi_diff_calculations")
      .select("*").eq("property_id", propId).eq("year", year);
    if (data && data.length > 0) {
      // Reconstruct CpiDiffRow[] from DB
      var byContract: Record<string, any> = {};
      data.forEach(function(d: any) {
        if (!byContract[d.contract_id]) byContract[d.contract_id] = {
          contractId: d.contract_id, tenantName: d.tenant_name, periods: [], totalDifference: 0
        };
        byContract[d.contract_id].periods.push({
          label: d.period,
          baseRentQuarter: Number(d.base_rent) || 0,
          paymentDate: d.payment_date,
          cpiMonth: d.cpi_current_month || "",
          cpiValue: Number(d.cpi_current_value) || 0,
          cpiBaseMonth: d.cpi_base_month || "",
          cpiBaseValue: Number(d.cpi_base_value) || 0,
          indexedRent: Number(d.indexed_rent) || 0,
          mgmtAdvance: Number(d.mgmt_advance) || 0,
          shouldPay: Number(d.should_pay) || 0,
          actualPaid: Number(d.actual_paid) || 0,
          difference: Number(d.difference) || 0,
        });
        byContract[d.contract_id].totalDifference += Number(d.total_diff || d.difference) || 0;
        if (d.interest_pct) {
          if (!interestRates[d.contract_id]) {
            interestRates[d.contract_id] = {};
          }
          interestRates[d.contract_id][d.period] = Number(d.interest_pct);
        }
      });
      setResults(Object.values(byContract));
      setSavedMode(true);
      var savedAt = data.reduce(function(latest: string, d: any) { return d.created_at > latest ? d.created_at : latest; }, "");
      setSavedInfo({ count: data.length, savedAt: savedAt });
    } else {
      setSavedInfo(null); setSavedMode(false); setResults([]);
    }
  }

  async function saveDiffCalculation() {
    if (savedMode && !confirm("המקדמות הנוכחיות נטענו מנתונים שמורים. שמירה תדרוס. האם להמשיך?")) return;
    setSaving(true);
    try {
      // Delete existing for this prop+year then insert new
      await supabase.from("cpi_diff_calculations").delete().eq("property_id", propId).eq("year", year);
      var rows: any[] = [];
      results.forEach(function(r) {
        r.periods.forEach(function(p) {
          var live = liveDifference(p, r.contractId);
          var rate = interestRates[r.contractId]?.[p.label] || null;
          rows.push({
            contract_id: r.contractId, property_id: propId, tenant_name: r.tenantName,
            year: year, period: p.label, payment_date: p.paymentDate,
            base_rent: p.baseRentQuarter, indexed_rent: p.indexedRent,
            mgmt_advance: p.mgmtAdvance, should_pay: p.shouldPay,
            actual_paid: actualPaidInputs[r.contractId]?.[p.label] ? Number(actualPaidInputs[r.contractId][p.label]) : p.actualPaid,
            difference: live.diff, interest_pct: rate, interest_amount: live.interest,
            total_diff: live.total,
            cpi_base_value: p.cpiBaseValue, cpi_base_month: p.cpiBaseMonth,
            cpi_current_value: p.cpiValue, cpi_current_month: p.cpiMonth,
          });
        });
      });
      if (rows.length > 0) {
        var { error } = await supabase.from("cpi_diff_calculations").insert(rows);
        if (error) throw error;
      }
      alert("✅ נשמרו " + rows.length + " חישובי הפרשי הצמדה");
      checkSavedDiff();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setSaving(false); }
  }

  async function compute() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    setComputing(true);
    setResults([]);
    var calcStart = Date.now();
    setProgress({ current: 0, total: 0, label: "טוען נתוני חוזים...", startedAt: calcStart });
    try {
      var { data: contracts } = await supabase.from("contracts")
        .select("id, rent_per_sqm, charged_area, investment_addition, payment_method, payment_frequency, vat_type, indexation_method, index_mechanism, index_base_date, index_base_value, start_date, end_date, is_amendment, grace_months, grace_type, grace_discount_pct, rent_type, minimum_rent, mgmt_included_in_revenue, tenants(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))")
        .eq("property_id", propId)
        .in("status", ["active", "extended"])
        .eq("is_amendment", false);

      contracts = (contracts ?? []).filter(function(c: any) {
        if (c.payment_method !== "checks_advance") return false;
        // Skip revenue-only with no minimum + mgmt included
        if (c.rent_type === "revenue_pct" && (!c.minimum_rent || Number(c.minimum_rent) === 0) && c.mgmt_included_in_revenue) return false;
        return true;
      });
      if (contracts.length === 0) { alert("אין חוזים עם שיקים מראש"); setComputing(false); return; }

      // Load saved advance payments — these are the baseline "what was calculated"
      var contractIds = contracts.map(function(c: any) { return c.id; });
      var { data: savedAdvances } = await supabase.from("advance_payments")
        .select("*").in("contract_id", contractIds).eq("year", year);

      // Load management rates
      var { data: mgmtGroups } = await supabase.from("billing_groups")
        .select("*,billing_group_spaces(space_id)")
        .eq("property_id", propId).eq("group_type", "management").eq("year", year);
      var { data: budget } = await supabase.from("property_budgets")
        .select("management_budget").eq("property_id", propId).eq("year", year).maybeSingle();
      var { data: propSpaces } = await supabase.from("spaces").select("id,area").eq("property_id", propId);
      var totalPropArea = (propSpaces ?? []).reduce(function(s: number, sp: any) { return s + (Number(sp.area) || 0); }, 0);
      var defaultMgmtRate = budget?.management_budget && totalPropArea > 0 ? Number(budget.management_budget) / totalPropArea / 12 : 0;

      var spaceMgmtRate: Record<string, number> = {};
      for (var g of mgmtGroups ?? []) {
        var sids = (g.billing_group_spaces || []).map(function(x: any) { return x.space_id; });
        var gArea = sids.reduce(function(s: number, sid: string) { var sp = (propSpaces ?? []).find(function(x: any) { return x.id === sid; }); return s + (Number(sp?.area) || 0); }, 0);
        var rate = Number(g.rate_per_sqm_monthly) || (Number(g.annual_amount) && gArea > 0 ? Number(g.annual_amount) / gArea / 12 : 0);
        for (var sid of sids) spaceMgmtRate[sid] = rate;
      }

      var { data: vatData } = await supabase.from("vat_rates").select("rate_pct").order("effective_from", { ascending: false }).limit(1);
      var vatPct = (vatData && vatData.length > 0 ? Number(vatData[0].rate_pct) : 18) / 100;

      // Load existing advance payment records (for pre-filling actual paid)
      var { data: existingAdvances } = await supabase.from("advance_payments")
        .select("*").in("contract_id", contracts.map(function(c: any) { return c.id; })).eq("year", year);

      // Load price tiers for step-rent computation
      var contractIds = contracts.map(function(c: any) { return c.id; });
      var { data: allTiers } = await supabase.from("contract_price_tiers")
        .select("*").in("contract_id", contractIds).order("tier_number");

      // Load exercised contract options (for mid-year price changes —
      // same source AdvancesTab uses, so both screens stay in sync).
      var { data: allOptions } = await supabase.from("contract_options")
        .select("*").in("contract_id", contractIds)
        .eq("is_exercised", true)
        .order("start_date", { ascending: true });

      var rows: CpiDiffRow[] = [];
      var totalContracts = contracts.length;
      var contractIdx = 0;

      for (var c of contracts) {
        contractIdx++;
        setProgress({
          current: contractIdx,
          total: totalContracts,
          label: "מחשב הפרשי הצמדה — " + ((c.tenants as any)?.name || "—"),
          startedAt: calcStart,
        });
        // Step-rent: walk EACH SPACE year by year, applying its own tiers
        // (per-space tiers take priority over contract-level tiers — same as
        // AdvancesTab). Sum across spaces to get the contract's monthly rent.
        // This is critical for contracts where tiers vary by unit (e.g. only
        // offices escalate but commercial stays flat).
        var contractStartDate = new Date(c.start_date);
        var contractYearsFromStart = year - contractStartDate.getFullYear();
        var contractTiers = (allTiers ?? []).filter(function(t: any) { return t.contract_id === c.id && !t.space_id; });

        var startMonthly = 0;
        var rentBeforeAnniversary = 0;
        var rentAfterAnniversary = 0;
        var contractOptions = (allOptions ?? []).filter(function(o: any) { return o.contract_id === c.id; });
        // Anniversary date in target year (may be overridden by an option that
        // starts mid-year — handled below per-space).
        var anniversaryInYear = new Date(year, contractStartDate.getMonth(), contractStartDate.getDate());

        (c.contract_spaces || []).forEach(function(cs: any) {
          var area = Number(cs.spaces?.area) || 0;
          var isFixed = cs.charge_method === "fixed";
          var baseRentPerSqm = Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0;
          var spaceStart = isFixed ? (Number(cs.fixed_rent) || 0) : baseRentPerSqm * area;
          startMonthly += spaceStart;

          var spaceTiers = (allTiers ?? []).filter(function(t: any) { return t.contract_id === c.id && t.space_id === cs.space_id; });
          var activeTiers = spaceTiers.length > 0 ? spaceTiers : contractTiers;

          var spaceBefore = spaceStart;
          var spaceAfter = spaceStart;

          if (activeTiers.length > 0 && contractYearsFromStart > 0) {
            var currentRent = spaceStart;
            for (var ty = 1; ty <= contractYearsFromStart; ty++) {
              // Single source of truth (lib/contract-utils.ts) — matches
              // expandRecurringTiers so the price timeline shown in the
              // contract details page agrees with what CpiDiff produces.
              var tier = activeTiers.find(function(t: any) { return tierAppliesAtYear(t, ty); });
              if (tier) {
                if (tier.increase_type === "pct") currentRent = currentRent * (1 + (Number(tier.increase_value) || 0) / 100);
                else if (tier.increase_type === "fixed_sqm") currentRent = currentRent + (Number(tier.increase_value) || 0) * area;
                else if (tier.increase_type === "fixed_total") currentRent = currentRent + (Number(tier.increase_value) || 0);
              }
              if (ty === contractYearsFromStart - 1) spaceBefore = currentRent;
              if (ty === contractYearsFromStart) spaceAfter = currentRent;
            }
            if (contractYearsFromStart === 1) spaceBefore = spaceStart;
          }

          // Apply exercised contract options (same logic as AdvancesTab):
          // - Option starting in target year → mid-year change at optStart
          // - Option starting before target year → entire year at option rate
          var spaceBaseAfterOpts = spaceStart; // for "before target year" path
          contractOptions.forEach(function(opt: any) {
            if (!opt.start_date) return;
            var optStart = new Date(opt.start_date);
            var optYear = optStart.getFullYear();
            if (optYear === year) {
              var newRent = 0;
              if (opt.rent_mechanism === "new_value" && opt.new_rent_value) {
                newRent = isFixed ? Number(opt.new_rent_value) : Number(opt.new_rent_value) * area;
              } else if (opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct) {
                newRent = spaceAfter * (1 + Number(opt.rent_increase_pct) / 100);
              } else return;
              if (newRent > 0) {
                spaceBefore = spaceAfter;  // current rate is "before option"
                spaceAfter = newRent;       // new rate is "after option"
                anniversaryInYear = optStart; // anniversary shifts to option date
              }
            } else if (optYear < year) {
              var optRent = 0;
              if (opt.rent_mechanism === "new_value" && opt.new_rent_value) {
                optRent = isFixed ? Number(opt.new_rent_value) : Number(opt.new_rent_value) * area;
              } else if (opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct) {
                optRent = spaceBaseAfterOpts * (1 + Number(opt.rent_increase_pct) / 100);
              }
              if (optRent > 0) {
                spaceBaseAfterOpts = optRent;
                spaceBefore = optRent;
                spaceAfter = optRent;
              }
            }
          });

          rentBeforeAnniversary += spaceBefore;
          rentAfterAnniversary += spaceAfter;
        });

        if (startMonthly === 0) {
          startMonthly = (Number(c.rent_per_sqm) || 0) * (Number(c.charged_area) || 0);
          rentBeforeAnniversary = startMonthly;
          rentAfterAnniversary = startMonthly;
        }
        // hasRentChange uses `>=` for the Jan 1 case: contracts starting on
        // Jan 1 have their anniversary on the FIRST day of the year, so the
        // entire year is at rentAfterAnniversary (not split).
        var hasRentChange = Math.abs(rentAfterAnniversary - rentBeforeAnniversary) > 0.01
          && anniversaryInYear >= new Date(year, 0, 1)
          && anniversaryInYear <= new Date(year, 11, 31);

        var mgmtMonthly = 0;
        (c.contract_spaces || []).forEach(function(cs: any) {
          var area = cs.spaces?.area || 0;
          var r = spaceMgmtRate[cs.space_id] ?? defaultMgmtRate;
          mgmtMonthly += r * area;
        });

        var cpiBaseDate = c.index_base_date || c.start_date;
        var fromCbs = formatDateForCbs(cpiBaseDate);
        var isVat = c.vat_type === "taxable";
        var isQuarterly = c.payment_frequency === "quarterly";
        var periodsCount = isQuarterly ? 4 : 12;
        var monthsPerPeriod = isQuarterly ? 3 : 1;
        var mgmtPeriod = mgmtMonthly * monthsPerPeriod;
        var mgmtPeriodWithVat = mgmtPeriod * (isVat ? 1 + vatPct : 1);

        // Grace period: compute end-date from contract start
        var graceEndDate: Date | null = null;
        if (c.grace_months && Number(c.grace_months) > 0 && c.grace_type) {
          graceEndDate = new Date(contractStartDate);
          graceEndDate.setMonth(graceEndDate.getMonth() + Number(c.grace_months));
        }
        var graceDiscountPct = Number(c.grace_discount_pct) || 0;

        var graceFactors = function(pStart: Date, pEnd: Date): { rentFactor: number; mgmtFactor: number } {
          if (!graceEndDate || pStart >= graceEndDate) return { rentFactor: 1, mgmtFactor: 1 };
          var totalMs = pEnd.getTime() - pStart.getTime();
          if (totalMs <= 0) return { rentFactor: 1, mgmtFactor: 1 };
          var graceMs = Math.min(graceEndDate.getTime(), pEnd.getTime()) - pStart.getTime();
          if (graceMs <= 0) return { rentFactor: 1, mgmtFactor: 1 };
          var graceRatio = graceMs / totalMs;
          var normalRatio = 1 - graceRatio;
          if (c.grace_type === "full") return { rentFactor: normalRatio, mgmtFactor: normalRatio };
          if (c.grace_type === "rent_only") return { rentFactor: normalRatio, mgmtFactor: 1 };
          if (c.grace_type === "partial") {
            var discountFactor = 1 - (graceDiscountPct / 100);
            return { rentFactor: normalRatio + graceRatio * discountFactor, mgmtFactor: 1 };
          }
          return { rentFactor: 1, mgmtFactor: 1 };
        };

        var periods: CpiDiffRow["periods"] = [];

        for (var pi = 0; pi < periodsCount; pi++) {
          var payMonth = isQuarterly ? pi * 3 + 1 : pi + 1;
          var paymentDate = year + "-" + String(payMonth).padStart(2, "0") + "-01";
          var label = isQuarterly ? "רבעון " + (pi + 1) : "חודש " + payMonth;

          // Period boundaries
          var periodStart = new Date(year, isQuarterly ? pi * 3 : pi, 1);
          var periodEnd = new Date(year, isQuarterly ? (pi + 1) * 3 : pi + 1, 0);
          var daysInPeriod = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;

          // Compute base rent for this period — split by anniversary if rent change mid-period
          var periodBaseRent = 0;
          if (hasRentChange && anniversaryInYear > periodStart && anniversaryInYear <= periodEnd) {
            // Split: days at old rate + days at new rate (month-by-month within period)
            for (var dm = 0; dm < monthsPerPeriod; dm++) {
              var mIdx = isQuarterly ? pi * 3 + dm : pi;
              var mStart = new Date(year, mIdx, 1);
              var mEnd = new Date(year, mIdx + 1, 0);
              var daysInMonth = mEnd.getDate();
              if (mStart < anniversaryInYear && mEnd >= anniversaryInYear) {
                // Split month
                var daysOld = anniversaryInYear.getDate() - 1;
                var daysNew = daysInMonth - daysOld;
                periodBaseRent += (rentBeforeAnniversary * daysOld / daysInMonth) + (rentAfterAnniversary * daysNew / daysInMonth);
              } else if (mEnd < anniversaryInYear) {
                periodBaseRent += rentBeforeAnniversary;
              } else {
                periodBaseRent += rentAfterAnniversary;
              }
            }
          } else if (hasRentChange && anniversaryInYear <= periodStart) {
            periodBaseRent = rentAfterAnniversary * monthsPerPeriod;
          } else {
            periodBaseRent = rentBeforeAnniversary * monthsPerPeriod;
          }

          var baseRentPeriodWithVat = periodBaseRent * (isVat ? 1 + vatPct : 1);

          // Get CPI at payment date (t-2 known index)
          var toCbs = formatDateForCbs(paymentDate);
          var indexedRent = baseRentPeriodWithVat;
          var cpiMonth = "";
          var cpiValue = 0;
          var cpiBaseValue = Number(c.index_base_value) || 0;
          var cpiBaseMonth = cpiBaseDate ? new Date(cpiBaseDate).toLocaleDateString("he-IL", { month: "short", year: "numeric" }) : "";

          if (c.indexation_method !== "none" && fromCbs && toCbs) {
            try {
              var cpiData = await fetchCpiAdjusted({ value: 10000, fromDate: fromCbs, toDate: toCbs });
              if (cpiData.success) {
                cpiMonth = cpiData.toDate || "";
                cpiValue = Number(cpiData.toIndexValue) || 0;
                if (!cpiBaseValue) cpiBaseValue = Number(cpiData.fromIndexValue) || 0;

                // Default ratio: precise chained value from CBS calculator
                // (uses the value=10000 trick so we get the chained ratio
                // straight from CBS — handles base-year changes correctly).
                var ratio = Number(cpiData.adjustedRentPerSqm) / 10000;
                // Treat "no_drop" the same as "highest_in_period": both mean
                // the indexed rent never decreases, so we look for the peak
                // CPI in the period.
                var isHighest = c.indexation_method === "highest_in_period"
                  || c.index_mechanism === "highest_in_period"
                  || c.indexation_method === "no_drop"
                  || c.index_mechanism === "no_drop";

                if (isHighest) {
                  // "מדד גבוה ביותר" — find the highest CHAINED CPI in
                  // [base_month .. payment_t2_month]. We must compare chained
                  // values (not raw published values) because Israeli CPI
                  // re-bases every 2 years and raw values are not comparable
                  // across bases. fetchHighestChainedCpi calls CBS calculator
                  // for each month and picks the peak by chained to_value.
                  var baseY = new Date(cpiBaseDate).getFullYear();
                  var baseM = new Date(cpiBaseDate).getMonth() + 1;
                  // Adjust payment date to "known index" month (t-2 logic)
                  var payDateObj = new Date(paymentDate);
                  if (payDateObj.getDate() < 16) {
                    payDateObj.setMonth(payDateObj.getMonth() - 2);
                  } else {
                    payDateObj.setMonth(payDateObj.getMonth() - 1);
                  }
                  var payY = payDateObj.getFullYear();
                  var payM = payDateObj.getMonth() + 1;
                  var peak = await fetchHighestChainedCpi({
                    baseFromDate: fromCbs!,
                    scanFromYear: baseY,
                    scanFromMonth: baseM,
                    scanToYear: payY,
                    scanToMonth: payM,
                  });
                  if (peak.success && peak.peakRatio && peak.peakRatio > ratio) {
                    ratio = peak.peakRatio;
                    // Update display fields so the UI shows the peak month
                    cpiMonth = `${peak.peakYear}-${String(peak.peakMonth).padStart(2, "0")}`;
                    // Note: cpiValue stays as the raw CBS toIndexValue for
                    // display reference; the ratio drives the calculation.
                  }
                }

                indexedRent = periodBaseRent * ratio * (isVat ? 1 + vatPct : 1);
              }
            } catch (e) { /* keep base */ }
          }

          // ─── GENERIC SOURCE-OF-TRUTH PATH ────────────────────────────
          // If AdvancesTab already saved checks for this period, USE THEM
          // as the rent base instead of recomputing rent from contract
          // fields. This automatically inherits every adjustment the
          // advances calc applies (per-space tiers, contract_options,
          // parking, amendments, mid-year unit add/remove, grace…) — so
          // CpiDiff stays in sync with AdvancesTab without duplicating
          // logic. We only swap in the CURRENT CPI ratio.
          //
          //   saved_total       = sum(total_with_vat)
          //   saved_indexed     = sum(indexed_rent)  (rent component, no VAT)
          //   saved_ratio       = cpi_ratio at save time
          //   rent_base         = saved_indexed / saved_ratio   ← contract rent at this period (no CPI)
          //   non_rent_with_vat = saved_total − saved_indexed × VAT  ← mgmt + parking + anything else
          //   new_indexed_vat   = rent_base × current_ratio × VAT
          //   shouldPay         = new_indexed_vat + non_rent_with_vat
          //   diff              = (current_ratio − saved_ratio) × rent_base × VAT
          //
          // Falls back to the fresh computation above when no saved data
          // exists (or cpi_ratio/indexed_rent are missing).
          var matchingAdvances = (savedAdvances ?? []).filter(function(a: any) { return a.contract_id === c.id && a.period === label; });
          var hasSavedRent = matchingAdvances.length > 0
            && matchingAdvances.every(function(a: any) {
              return Number(a.cpi_ratio) > 0 && Number(a.indexed_rent) > 0;
            });

          var mgmtAfterGrace: number;
          var actualPaid: number;
          var userInput = actualPaidInputs[c.id]?.[label];

          if (hasSavedRent) {
            var savedTotalSum = matchingAdvances.reduce(function(s: number, a: any) {
              return s + (Number(a.total_with_vat) || 0);
            }, 0);
            var savedRentIndexedSum = matchingAdvances.reduce(function(s: number, a: any) {
              return s + (Number(a.indexed_rent) || 0);
            }, 0);
            var savedRatio = Number(matchingAdvances[0].cpi_ratio);
            var savedRentBaseSum = savedRentIndexedSum / savedRatio;

            // Override fresh indexedRent with delta-based value
            indexedRent = savedRentBaseSum * ratio * (isVat ? 1 + vatPct : 1);
            // Non-rent (mgmt + parking + whatever) = saved_total minus saved rent
            var savedRentWithVat = savedRentIndexedSum * (isVat ? 1 + vatPct : 1);
            mgmtAfterGrace = savedTotalSum - savedRentWithVat;
            // actualPaid: user input > saved actual_paid > saved total_with_vat
            var savedActualPaid = matchingAdvances.reduce(function(s: number, a: any) {
              return s + (Number(a.actual_paid) || Number(a.total_with_vat) || 0);
            }, 0);
            actualPaid = userInput ? Number(userInput) : savedActualPaid;
          } else {
            // Fallback: apply grace to the fresh computation
            var gf = graceFactors(periodStart, periodEnd);
            indexedRent = indexedRent * gf.rentFactor;
            mgmtAfterGrace = mgmtPeriodWithVat * gf.mgmtFactor;
            var savedTotalForPeriod = matchingAdvances.reduce(function(s: number, a: any) {
              return s + (Number(a.actual_paid) || Number(a.total_with_vat) || 0);
            }, 0);
            actualPaid = userInput ? Number(userInput) : (savedTotalForPeriod > 0 ? savedTotalForPeriod : baseRentPeriodWithVat + mgmtPeriodWithVat);
          }

          var shouldPay = indexedRent + mgmtAfterGrace;
          var baseRentDisplay = hasSavedRent
            ? (matchingAdvances.reduce(function(s: number, a: any) { return s + (Number(a.indexed_rent) || 0) / Number(a.cpi_ratio); }, 0)) * (isVat ? 1 + vatPct : 1)
            : baseRentPeriodWithVat * graceFactors(periodStart, periodEnd).rentFactor;

          periods.push({
            label: label,
            baseRentQuarter: baseRentDisplay,
            paymentDate: paymentDate,
            cpiMonth: cpiMonth,
            cpiValue: cpiValue,
            cpiBaseMonth: cpiBaseMonth,
            cpiBaseValue: cpiBaseValue,
            indexedRent: indexedRent,
            mgmtAdvance: mgmtAfterGrace,
            shouldPay: shouldPay,
            actualPaid: actualPaid,
            difference: shouldPay - actualPaid,
          });
        }

        var totalDiff = periods.reduce(function(s, p) { return s + p.difference; }, 0);
        rows.push({
          contractId: c.id,
          tenantName: (c.tenants as any)?.name || "—",
          periods: periods,
          totalDifference: totalDiff,
        });
      }
      setResults(rows);
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setComputing(false); setProgress(null); }
  }

  // Per-check interest rates (set when user edits actual paid)
  const [interestRates, setInterestRates] = useState<Record<string, Record<string, number>>>({});

  function updateActualPaid(contractId: string, period: string, value: string, shouldPay: number, paymentDate: string) {
    setActualPaidInputs(function(prev) {
      var copy = { ...prev };
      if (!copy[contractId]) copy[contractId] = {};
      copy[contractId][period] = value;
      return copy;
    });
    // If user changed the amount AND it differs from shouldPay → ask about interest
    var numVal = Number(value);
    if (numVal > 0 && Math.abs(numVal - shouldPay) > 1) {
      var existingRate = interestRates[contractId]?.[period];
      if (existingRate === undefined) {
        var ans = prompt("השינוי שהזנת יוצר הפרש מהסכום הנדרש.\nהאם להוסיף ריבית פיגורים? הזן אחוז שנתי (לדוגמה: 5).\nהשאר ריק או 0 ללא ריבית:", "0");
        if (ans !== null) {
          var rate = Number(ans) || 0;
          setInterestRates(function(prev) {
            var copy = { ...prev };
            if (!copy[contractId]) copy[contractId] = {};
            copy[contractId][period] = rate;
            return copy;
          });
        }
      }
    }
  }

  // Compute live difference for a period (considering current input)
  function liveDifference(p: any, contractId: string): { diff: number; interest: number; total: number } {
    var input = actualPaidInputs[contractId]?.[p.label];
    var actualPaid = input !== undefined && input !== "" ? Number(input) : p.actualPaid;
    var diff = p.shouldPay - actualPaid;
    var rate = interestRates[contractId]?.[p.label] || 0;
    var interest = 0;
    if (rate > 0 && Math.abs(diff) > 1) {
      // Annual rate, prorated by days from period payment date to year end
      var payDate = new Date(p.paymentDate);
      var yearEnd = new Date(year, 11, 31);
      var days = Math.max(0, Math.round((yearEnd.getTime() - payDate.getTime()) / 86400000));
      interest = Math.abs(diff) * (rate / 100) * (days / 365);
      if (diff < 0) interest = -interest;
    }
    return { diff: diff, interest: interest, total: diff + interest };
  }

  async function createCharges() {
    setCreatingCharges(true);
    try {
      var count = 0;
      for (var r of results) {
        if (Math.abs(r.totalDifference) < 1) continue;
        await supabase.from("charges").insert({
          contract_id: r.contractId,
          charge_type: "other",
          base_amount: r.totalDifference > 0 ? r.totalDifference : -Math.abs(r.totalDifference),
          vat_amount: 0,
          total_amount: r.totalDifference,
          vat_type: "exempt",
          billing_period_start: year + "-01-01",
          billing_period_end: year + "-12-31",
          due_date: new Date().toISOString().slice(0, 10),
          status: "pending",
          notes: "הפרשי הצמדה שכ\"ד שנת " + year,
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_cpi_diff_charges", notes: count + " חיובים" });
      alert("✅ נוצרו " + count + " חיובי הפרשי הצמדה");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setCreatingCharges(false); }
  }

  async function createLetters() {
    setCreatingLetters(true);
    try {
      // Load company details
      var { data: propData } = await supabase.from("properties")
        .select("name, companies(company_name, address, city, phone, email, logo_url, bank_name, bank_branch, bank_account)")
        .eq("id", propId).single();
      var company = (propData?.companies as any) || {};
      var companyName = company.company_name || propData?.name || "";
      var companyAddress = [company.address, company.city].filter(Boolean).join(", ");
      var companyPhone = company.phone || "";
      var logoUrl = company.logo_url || "";
      var propName = propData?.name || "";
      var bankLine = "";
      if (company.bank_name && company.bank_account) {
        bankLine = "את ההמחאות יש לרשום לפקודת " + companyName + " חשבון " + company.bank_account + " סניף " + (company.bank_branch || "") + " " + company.bank_name + ".";
      }

      // If includeAdvances → load saved advances for nextYear per contract
      var savedAdvancesByContract: Record<string, any[]> = {};
      if (includeAdvances) {
        var { data: nextAdv } = await supabase.from("advance_payments")
          .select("*").eq("property_id", propId).eq("year", nextYear);
        (nextAdv || []).forEach(function(a: any) {
          if (!savedAdvancesByContract[a.contract_id]) savedAdvancesByContract[a.contract_id] = [];
          savedAdvancesByContract[a.contract_id].push(a);
        });
      }

      var count = 0;
      for (var r of results) {
        var liveTotal = r.periods.reduce(function(s: number, p: any) { return s + liveDifference(p, r.contractId).total; }, 0);
        var advChecks = savedAdvancesByContract[r.contractId] || [];
        if (Math.abs(liveTotal) < 1 && advChecks.length === 0) continue;

        var hebMonths = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

        // === BODY ===
        var body = "לכבוד\n" + r.tenantName + "\n\nשלום רב,\n\n";

        var titleParts = [];
        if (advChecks.length > 0) titleParts.push("המחאות מקדמות " + nextYear);
        if (Math.abs(liveTotal) >= 1) titleParts.push("הפרשי הצמדה " + year);
        var letterTitle = titleParts.join(" + ");

        body += "הנדון: " + letterTitle + "\n\n";

        // === Section 1: Advances (if included) ===
        if (advChecks.length > 0) {
          // Consolidate by check_date
          var byDate: Record<string, number> = {};
          var advTotal = 0;
          advChecks.forEach(function(a: any) {
            byDate[a.check_date] = (byDate[a.check_date] || 0) + Number(a.total_with_vat || 0);
            advTotal += Number(a.total_with_vat || 0);
          });
          var sortedDates = Object.keys(byDate).sort();
          body += "1. דרישת מקדמות שכ\"ד ודמי ניהול לשנת " + nextYear + ":\n";
          body += "בהתאם להסכם השכירות, נבקשכם להעביר אלינו " + sortedDates.length + " המחאות:\n\n";
          body += "המחאה\tלתאריך\tבסכום בש\"ח\n";
          sortedDates.forEach(function(d, i) {
            body += (i + 1) + "\t" + fmtDate(d) + "\t" + fmtMoney(byDate[d]) + "\n";
          });
          body += "\nסה\"כ מקדמות: " + fmtMoney(advTotal) + "\n\n";
        }

        // === Section 2: CPI diff (if applicable) ===
        if (Math.abs(liveTotal) >= 1) {
          var sectionNum = advChecks.length > 0 ? "2" : "1";
          body += sectionNum + ". דרישת תשלום הפרשי הצמדה לשנת " + year + ":\n";
          body += "בהתאם לחישוב המפורט בנספח א', נדרש " + (liveTotal > 0 ? "תשלום" : "זיכוי") + " הפרשי הצמדה בסכום של:\n\n";
          body += "סה\"כ: " + fmtMoney(Math.abs(liveTotal)) + " " + (liveTotal > 0 ? "(חוב)" : "(זכות)") + "\n\n";
          if (liveTotal > 0) {
            body += "אנא העבירו שיק מזומן בנפרד עבור סכום זה. תחשיב מלא מצורף בנספח א'.\n\n";
          } else {
            body += "הזיכוי יקוזז מהמקדמה הראשונה של השנה הבאה.\n\n";
          }
        }

        if (bankLine) body += bankLine + "\n\n";
        body += "בכבוד רב ובברכה,\n" + companyName;

        // === APPENDIX ===
        var appendix = "";
        if (Math.abs(liveTotal) >= 1) {
          r.periods.forEach(function(p: any) {
            var live = liveDifference(p, r.contractId);
            appendix += "UNIT_START|" + p.label + "|" + fmtDate(p.paymentDate) + "\n";
            appendix += "שכ\"ד צמוד: " + fmtMoney(p.indexedRent) + "\n";
            appendix += "מקדמת ד.נ.: " + fmtMoney(p.mgmtAdvance) + "\n";
            appendix += "סה\"כ נדרש: " + fmtMoney(p.shouldPay) + "\n";
            appendix += "ששולם בפועל: " + fmtMoney(actualPaidInputs[r.contractId]?.[p.label] ? Number(actualPaidInputs[r.contractId][p.label]) : p.actualPaid) + "\n";
            appendix += "הפרש: " + fmtMoney(live.diff) + "\n";
            if (p.cpiBaseValue && p.cpiValue) {
              appendix += "מדד בסיס: " + p.cpiBaseValue + " | מדד תשלום: " + p.cpiValue + "\n";
            }
            if (live.interest !== 0) {
              var rate = interestRates[r.contractId]?.[p.label] || 0;
              appendix += "ריבית פיגורים " + rate + "%: " + fmtMoney(live.interest) + "\n";
            }
            appendix += "סה\"כ כולל ריבית: " + fmtMoney(live.total) + "\n";
            appendix += "UNIT_END\n";
          });
        }

        await supabase.from("letters").insert({
          contract_id: r.contractId,
          property_id: propId,
          letter_type: "demand",
          title: letterTitle,
          billing_year: year,
          billing_type: advChecks.length > 0 ? "combined" : "cpi_diff",
          content_json: {
            body: body, appendix: appendix, year: year, tenant: r.tenantName,
            companyName: companyName, companyAddress: companyAddress,
            companyPhone: companyPhone, logoUrl: logoUrl, bankLine: bankLine,
          },
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_cpi_diff_letters", notes: count + " מכתבים" });
      alert("✅ נוצרו " + count + " מכתבים");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setCreatingLetters(false); }
  }

  var grandTotalDiff = results.reduce(function(s, r) { return s + r.totalDifference; }, 0);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">📊 הפרשי הצמדה — חישוב</h2>
        <p className="text-sm text-slate-500 mb-4">השוואת שכ&quot;ד ששולם בפועל לשכ&quot;ד שהיה צריך להיות לפי המדד ביום התשלום. ההפרש הוא חיוב/זיכוי הפרשי הצמדה.</p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
            <select value={propId} onChange={function(e) { setPropId(e.target.value); setResults([]); }} className={ic}>
              <option value="">— בחר נכס —</option>
              {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
            <input type="number" value={year} onChange={function(e) { setYear(Number(e.target.value)); setResults([]); }} className={ic} />
          </div>
        </div>

        {savedInfo && savedMode && (
          <div className="rounded-lg bg-green-50 border border-green-300 px-4 py-3 flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-green-600 text-xl">✅</span>
              <div>
                <div className="font-bold text-green-800 text-sm">נמצאו חישובי הפרשי הצמדה שמורים לשנת {year}</div>
                <div className="text-xs text-green-600">{savedInfo.count} שורות | נשמר ב-{fmtDate(savedInfo.savedAt)}</div>
              </div>
            </div>
            <button onClick={function() { setSavedMode(false); setResults([]); setSavedInfo(null); }}
              className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">
              🔄 חשב מחדש
            </button>
          </div>
        )}

        {!savedMode && (
          <button onClick={compute} disabled={computing || !propId}
            className="rounded-lg bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50">
            {computing ? "מחשב..." : "חשב הפרשי הצמדה"}
          </button>
        )}

        {progress && (
          <div className="mt-3">
            <CalcProgress {...progress} />
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-5 space-y-4">
            {results.map(function(r) {
              return (
                <div key={r.contractId} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div className="font-bold text-slate-800 text-sm">{r.tenantName}</div>
                    <div className={"text-sm font-bold " + (r.totalDifference > 0 ? "text-red-700" : r.totalDifference < 0 ? "text-green-700" : "text-slate-500")}>
                      סה&quot;כ הפרש: {fmtMoney(r.totalDifference)}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right min-w-[900px]">
                      <thead className="bg-slate-50 text-xs">
                        <tr>
                          <th className="px-3 py-2 font-semibold text-slate-700">תקופה</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">שכ&quot;ד בסיס</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">מועד תשלום</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">מדד</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">נקודות</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">שכ&quot;ד צמוד</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">מקדמת ד.נ.</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">סה&quot;כ לשלם</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">ששולם בפועל</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">הפרש</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.periods.map(function(p, pi) {
                          var diffColor = p.difference > 1 ? "text-red-700 bg-red-50 font-bold" : p.difference < -1 ? "text-green-700 bg-green-50 font-bold" : "text-slate-500";
                          return (
                            <tr key={pi} className="border-t border-slate-100 hover:bg-slate-50">
                              <td className="px-3 py-2 font-semibold text-slate-800">{p.label}</td>
                              <td className="px-3 py-2 text-slate-600">{fmtMoney(p.baseRentQuarter)}</td>
                              <td className="px-3 py-2 text-slate-600">{fmtDate(p.paymentDate)}</td>
                              <td className="px-3 py-2 text-xs text-slate-500">{p.cpiMonth}</td>
                              <td className="px-3 py-2 text-slate-600">{p.cpiValue ? p.cpiValue.toFixed(2) : "—"}</td>
                              <td className="px-3 py-2 text-green-700 font-semibold">{fmtMoney(p.indexedRent)}</td>
                              <td className="px-3 py-2 text-slate-600">{fmtMoney(p.mgmtAdvance)}</td>
                              <td className="px-3 py-2 font-bold text-slate-800">{fmtMoney(p.shouldPay)}</td>
                              <td className="px-3 py-2">
                                <input type="number" value={actualPaidInputs[r.contractId]?.[p.label] ?? String(p.actualPaid)}
                                  onChange={function(e) { updateActualPaid(r.contractId, p.label, e.target.value, p.shouldPay, p.paymentDate); }}
                                  className="w-28 rounded border border-slate-300 px-2 py-1 text-sm text-right" />
                              </td>
                              <td className={"px-3 py-2 rounded " + diffColor}>
                                {fmtMoney(liveDifference(p, r.contractId).total)}
                                {liveDifference(p, r.contractId).interest !== 0 && (
                                  <div className="text-[10px] text-amber-600">כולל ריבית {fmtMoney(liveDifference(p, r.contractId).interest)}</div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                        <tr>
                          <td className="px-3 py-2 font-bold text-slate-700" colSpan={9}>סך הפרשי הצמדה בגין שכ&quot;ד ששולם ב-{year}</td>
                          <td className="px-3 py-2 font-black">
                            {(function() {
                              var liveTotal = r.periods.reduce(function(s: number, p: any) { return s + liveDifference(p, r.contractId).total; }, 0);
                              return <span className={liveTotal > 0 ? "text-red-700" : liveTotal < 0 ? "text-green-700" : "text-slate-700"}>{fmtMoney(liveTotal)}</span>;
                            })()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* Grand total (live) */}
            {(function() {
              var liveGrand = results.reduce(function(s, r) {
                return s + r.periods.reduce(function(ss: number, p: any) { return ss + liveDifference(p, r.contractId).total; }, 0);
              }, 0);
              return (
                <div className={"rounded-xl border-2 p-4 text-center " + (liveGrand > 0 ? "border-red-300 bg-red-50" : "border-green-300 bg-green-50")}>
                  <div className={"text-2xl font-black " + (liveGrand > 0 ? "text-red-800" : "text-green-800")}>{fmtMoney(liveGrand)}</div>
                  <div className="text-sm text-slate-600">סה&quot;כ הפרשי הצמדה לכל השוכרים — שנת {year}</div>
                </div>
              );
            })()}

            {/* Combined letter options */}
            <div className="rounded-lg border border-purple-200 bg-purple-50/30 p-4 space-y-3">
              <div className="text-xs font-bold text-purple-700">📄 אפשרויות מכתב</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includeAdvances} onChange={function(e) { setIncludeAdvances(e.target.checked); }} className="rounded" />
                <span className="text-xs text-slate-700">צרף למכתב גם דרישת מקדמות לשנה הבאה</span>
              </label>
              {includeAdvances && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600">שנת המקדמות:</label>
                  <input type="number" value={nextYear} onChange={function(e) { setNextYear(Number(e.target.value)); }}
                    className="w-24 rounded border border-slate-300 px-2 py-1 text-sm" />
                  <span className="text-xs text-slate-400">(תיקח שייקים שמורים מטאב המקדמות)</span>
                </div>
              )}
            </div>

            <div className="flex gap-3 flex-wrap">
              <button onClick={saveDiffCalculation} disabled={saving}
                className={"rounded-lg px-5 py-2.5 text-sm font-bold disabled:opacity-50 " + (savedMode ? "border-2 border-green-500 bg-green-50 text-green-700 hover:bg-green-100" : "bg-blue-700 text-white hover:bg-blue-800")}>
                {saving ? "שומר..." : savedMode ? "✅ נשמר — לחץ לשמור מחדש" : "💾 שמור חישוב"}
              </button>
              <button onClick={createCharges} disabled={creatingCharges}
                className="rounded-lg bg-slate-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50">
                {creatingCharges ? "יוצר..." : "📊 צור חיובי הפרשים"}
              </button>
              <button onClick={createLetters} disabled={creatingLetters}
                className="rounded-lg border-2 border-purple-500 bg-purple-50 px-5 py-2.5 text-sm font-bold text-purple-700 hover:bg-purple-100 disabled:opacity-50">
                {creatingLetters ? "יוצר..." : (includeAdvances ? "📄 צור מכתבים משולבים (מקדמות + הפרשים)" : "📄 צור מכתבי הפרשי הצמדה")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
