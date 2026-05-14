"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit-log";
import { fetchCpiAdjusted } from "@/lib/cpi-server";

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
  const [results, setResults] = useState<CpiDiffRow[]>([]);
  const [actualPaidInputs, setActualPaidInputs] = useState<Record<string, Record<string, string>>>({});
  const [creatingCharges, setCreatingCharges] = useState(false);
  const [creatingLetters, setCreatingLetters] = useState(false);

  async function compute() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    setComputing(true);
    setResults([]);
    try {
      var { data: contracts } = await supabase.from("contracts")
        .select("id, rent_per_sqm, charged_area, investment_addition, payment_method, payment_frequency, vat_type, indexation_method, index_base_date, index_base_value, start_date, end_date, is_amendment, grace_months, grace_type, grace_discount_pct, rent_type, minimum_rent, mgmt_included_in_revenue, tenants(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))")
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

      var rows: CpiDiffRow[] = [];

      for (var c of contracts) {
        // Base rent at contract start (before any tiers)
        var startMonthly = 0;
        (c.contract_spaces || []).forEach(function(cs: any) {
          var area = cs.spaces?.area || 0;
          if (cs.charge_method === "fixed" && cs.fixed_rent) startMonthly += Number(cs.fixed_rent);
          else startMonthly += (Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0) * area;
        });
        if (startMonthly === 0) startMonthly = (Number(c.rent_per_sqm) || 0) * (Number(c.charged_area) || 0);

        // Compute step-rent: walk year by year from contract start, applying tiers
        var contractStartDate = new Date(c.start_date);
        var contractYearsFromStart = year - contractStartDate.getFullYear();
        var contractTiers = (allTiers ?? []).filter(function(t: any) { return t.contract_id === c.id && !t.space_id; });
        // Compute rents BEFORE and AFTER anniversary in target year
        var rentBeforeAnniversary = startMonthly;
        var rentAfterAnniversary = startMonthly;
        if (contractTiers.length > 0 && contractYearsFromStart > 0) {
          var currentRent = startMonthly;
          for (var ty = 1; ty <= contractYearsFromStart; ty++) {
            var tier = contractTiers.find(function(t: any) {
              if (t.is_recurring) {
                var every = t.recurring_every_years || 1;
                return ty % every === 0;
              }
              return ty >= t.from_year && ty <= t.to_year;
            });
            if (tier) {
              if (tier.increase_type === "pct") currentRent = currentRent * (1 + (Number(tier.increase_value) || 0) / 100);
              else if (tier.increase_type === "fixed_sqm") {
                var totalArea = (c.contract_spaces || []).reduce(function(s: number, cs: any) { return s + (cs.spaces?.area || 0); }, 0);
                currentRent = currentRent + (Number(tier.increase_value) || 0) * totalArea;
              } else if (tier.increase_type === "fixed_total") currentRent = currentRent + (Number(tier.increase_value) || 0);
            }
            if (ty === contractYearsFromStart - 1) rentBeforeAnniversary = currentRent;
            if (ty === contractYearsFromStart) rentAfterAnniversary = currentRent;
          }
          if (contractYearsFromStart === 1) rentBeforeAnniversary = startMonthly;
        }

        // Anniversary date in target year
        var anniversaryInYear = new Date(year, contractStartDate.getMonth(), contractStartDate.getDate());
        var hasRentChange = Math.abs(rentAfterAnniversary - rentBeforeAnniversary) > 0.01
          && anniversaryInYear > new Date(year, 0, 1)
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
                var ratio = Number(cpiData.adjustedRentPerSqm) / 10000;
                indexedRent = periodBaseRent * ratio * (isVat ? 1 + vatPct : 1);
                cpiMonth = cpiData.toDate || "";
                cpiValue = Number(cpiData.toIndexValue) || 0;
                if (!cpiBaseValue) cpiBaseValue = Number(cpiData.fromIndexValue) || 0;
              }
            } catch (e) { /* keep base */ }
          }

          // Apply grace period factors (zero rent during grace; mgmt depends on type)
          var gf = graceFactors(periodStart, periodEnd);
          indexedRent = indexedRent * gf.rentFactor;
          var mgmtAfterGrace = mgmtPeriodWithVat * gf.mgmtFactor;

          var shouldPay = indexedRent + mgmtAfterGrace;

          // Pre-fill actual paid:
          // 1. User input (if edited in this session)
          // 2. Saved actual_paid from advance_payments (if user previously confirmed payment)
          // 3. Saved total_with_vat from advance_payments (= the check amount that was written)
          // 4. Fallback: computed base rent + mgmt (if no saved advances exist)
          var matchingAdvances = (savedAdvances ?? []).filter(function(a: any) { return a.contract_id === c.id && a.period === label; });
          var savedTotalForPeriod = matchingAdvances.reduce(function(s: number, a: any) { return s + (Number(a.actual_paid) || Number(a.total_with_vat) || 0); }, 0);
          var userInput = actualPaidInputs[c.id]?.[label];
          var actualPaid = userInput ? Number(userInput) : (savedTotalForPeriod > 0 ? savedTotalForPeriod : baseRentPeriodWithVat + mgmtPeriodWithVat);

          periods.push({
            label: label,
            baseRentQuarter: baseRentPeriodWithVat * gf.rentFactor,
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
    finally { setComputing(false); }
  }

  function updateActualPaid(contractId: string, period: string, value: string) {
    setActualPaidInputs(function(prev) {
      var copy = { ...prev };
      if (!copy[contractId]) copy[contractId] = {};
      copy[contractId][period] = value;
      return copy;
    });
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
      var count = 0;
      for (var r of results) {
        if (Math.abs(r.totalDifference) < 1) continue;
        var body = "שוכר/ת נכבד/ה,\n\nלהלן חישוב הפרשי הצמדה בגין שכ\"ד ששולם בשנת " + year + ":\n\n";
        for (var p of r.periods) {
          body += p.label + " (תשלום " + fmtDate(p.paymentDate) + "):\n";
          body += "  שכ\"ד צמוד: " + fmtMoney(p.indexedRent) + " | מקדמת ד.נ.: " + fmtMoney(p.mgmtAdvance) + "\n";
          body += "  סה\"כ לשלם: " + fmtMoney(p.shouldPay) + " | ששולם: " + fmtMoney(p.actualPaid) + "\n";
          body += "  הפרש: " + fmtMoney(p.difference) + "\n\n";
        }
        body += "סך הפרשי הצמדה לשנת " + year + ": " + fmtMoney(r.totalDifference) + "\n";
        body += r.totalDifference > 0 ? "\nנודה לתשלום ההפרש בהקדם.\n" : "\nההפרש יקוזז מהתשלום הבא.\n";
        body += "\nבברכה,\nהנהלת הנכס";

        await supabase.from("letters").insert({
          contract_id: r.contractId,
          letter_type: "demand",
          subject: r.totalDifference > 0 ? "חיוב הפרשי הצמדה שנת " + year : "זיכוי הפרשי הצמדה שנת " + year,
          body: body,
          status: "draft",
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_cpi_diff_letters", notes: count + " מכתבים" });
      alert("✅ נוצרו " + count + " מכתבי הפרשי הצמדה");
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

        <button onClick={compute} disabled={computing || !propId}
          className="rounded-lg bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50">
          {computing ? "מחשב..." : "חשב הפרשי הצמדה"}
        </button>

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
                                  onChange={function(e) { updateActualPaid(r.contractId, p.label, e.target.value); }}
                                  className="w-28 rounded border border-slate-300 px-2 py-1 text-sm text-right" />
                              </td>
                              <td className={"px-3 py-2 rounded " + diffColor}>{fmtMoney(p.difference)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className={"border-t-2 border-slate-200 " + (r.totalDifference > 0 ? "bg-red-50" : r.totalDifference < 0 ? "bg-green-50" : "bg-slate-50")}>
                        <tr>
                          <td className="px-3 py-2 font-bold text-slate-700" colSpan={9}>סך הפרשי הצמדה בגין שכ&quot;ד ששולם ב-{year}</td>
                          <td className={"px-3 py-2 font-black " + (r.totalDifference > 0 ? "text-red-700" : "text-green-700")}>{fmtMoney(r.totalDifference)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* Grand total */}
            <div className={"rounded-xl border-2 p-4 text-center " + (grandTotalDiff > 0 ? "border-red-300 bg-red-50" : "border-green-300 bg-green-50")}>
              <div className={"text-2xl font-black " + (grandTotalDiff > 0 ? "text-red-800" : "text-green-800")}>{fmtMoney(grandTotalDiff)}</div>
              <div className="text-sm text-slate-600">סה&quot;כ הפרשי הצמדה לכל השוכרים — שנת {year}</div>
            </div>

            <div className="flex gap-3">
              <button onClick={createCharges} disabled={creatingCharges}
                className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {creatingCharges ? "יוצר..." : "💾 צור חיובי הפרשים"}
              </button>
              <button onClick={createLetters} disabled={creatingLetters}
                className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                {creatingLetters ? "יוצר..." : "📄 צור מכתבי הפרשי הצמדה"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
