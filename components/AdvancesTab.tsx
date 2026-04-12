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

// Days in a month
function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }

interface CheckRow {
  label: string;
  months: number;       // full months count
  partialDays: number;  // if partial month, how many days
  totalDaysInMonth: number; // for pro-rata
  checkDate: string;
  rentBeforeVat: number;
  mgmtBeforeVat: number;
  totalBeforeVat: number;
  vat: number;
  totalWithVat: number;
}

interface AdvanceRow {
  contractId: string;
  tenantName: string;
  spaceName: string;
  spaceArea: number;
  baseRentMonthly: number;
  indexedRentMonthly: number;
  mgmtAdvanceMonthly: number;
  totalMonthly: number;
  cpiBaseValue: number;
  cpiBaseDate: string;
  cpiCurrentValue: number;
  cpiCurrentDate: string;
  indexationMethod: string;
  startDate: string;  // when this unit starts in the year (could be mid-year)
  checks: CheckRow[];
}

export default function AdvancesTab({ properties }: { properties: any[] }) {
  const currentYear = new Date().getFullYear();
  const [propId, setPropId] = useState("");
  const [year, setYear] = useState(currentYear + 1);
  // User-specified CPI calculation date (e.g. Nov 15 = use Oct CPI)
  const [cpiCalcDate, setCpiCalcDate] = useState(currentYear + "-11-15");
  const [computing, setComputing] = useState(false);
  const [results, setResults] = useState<AdvanceRow[]>([]);
  const [creatingCharges, setCreatingCharges] = useState(false);
  const [creatingLetters, setCreatingLetters] = useState(false);

  async function compute() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    setComputing(true);
    setResults([]);
    try {
      // Load contracts
      var { data: contracts } = await supabase.from("contracts")
        .select("id, rent_per_sqm, charged_area, investment_addition, payment_method, payment_frequency, vat_type, indexation_method, index_base_date, index_base_value, start_date, end_date, is_amendment, tenants(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,index_base_date,index_base_value,use_original_index,spaces(space_name,area))")
        .eq("property_id", propId)
        .in("status", ["active", "extended"])
        .eq("is_amendment", false);

      contracts = (contracts ?? []).filter(function(c: any) { return c.payment_method === "checks_advance"; });
      if (contracts.length === 0) { alert("אין חוזים עם שיקים מראש"); setComputing(false); return; }

      // Management rates
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

      // VAT
      var { data: vatData } = await supabase.from("vat_rates").select("rate_pct").order("effective_from", { ascending: false }).limit(1);
      var vatPct = (vatData && vatData.length > 0 ? Number(vatData[0].rate_pct) : 18) / 100;

      // CPI date: use user-specified date (not today)
      var toCbs = formatDateForCbs(cpiCalcDate);

      var rows: AdvanceRow[] = [];

      for (var c of contracts) {
        var isVat = c.vat_type === "taxable";
        var isQuarterly = c.payment_frequency === "quarterly";

        // Process EACH space separately (per-unit view)
        for (var cs of (c.contract_spaces || [])) {
          var area = cs.spaces?.area || 0;
          var spaceName = cs.spaces?.space_name || "—";

          // Base monthly rent for this space
          var baseMonthly = 0;
          if (cs.charge_method === "fixed" && cs.fixed_rent) baseMonthly = Number(cs.fixed_rent);
          else baseMonthly = (Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0) * area;

          // Management advance for this space
          var mgmtMonthly = (spaceMgmtRate[cs.space_id] ?? defaultMgmtRate) * area;

          // CPI: use space-specific base or contract base
          var useCustomCpi = cs.use_original_index === false && cs.index_base_date;
          var cpiBaseDate = useCustomCpi ? cs.index_base_date : (c.index_base_date || c.start_date);
          var fromCbs = formatDateForCbs(cpiBaseDate);

          var cpiRatio = 1;
          var cpiBaseValue = useCustomCpi ? Number(cs.index_base_value) : (Number(c.index_base_value) || 0);
          var cpiCurrentValue = 0;
          var cpiCurrentDate = "";

          if (c.indexation_method !== "none" && fromCbs && toCbs) {
            try {
              var cpiData = await fetchCpiAdjusted({ value: 10000, fromDate: fromCbs, toDate: toCbs });
              if (cpiData.success) {
                cpiRatio = Number(cpiData.adjustedRentPerSqm) / 10000;
                cpiCurrentValue = Number(cpiData.toIndexValue) || 0;
                cpiCurrentDate = cpiData.toDate || "";
                if (!cpiBaseValue) cpiBaseValue = Number(cpiData.fromIndexValue) || 0;
              }
            } catch (e) { /* keep ratio 1 */ }
          }

          var indexedMonthly = baseMonthly * cpiRatio;
          var totalMonthly = indexedMonthly + mgmtMonthly;

          // Determine start date for this unit in the target year
          // Could be Jan 1 if contract started before, or mid-year if started this year
          var contractStart = new Date(c.start_date);
          var yearStart = new Date(year, 0, 1);
          var yearEnd = new Date(year, 11, 31);
          var effectiveStart = contractStart > yearStart ? contractStart : yearStart;

          // If contract ends before year end, use contract end
          var contractEnd = c.end_date ? new Date(c.end_date) : yearEnd;
          var effectiveEnd = contractEnd < yearEnd ? contractEnd : yearEnd;

          if (effectiveStart > effectiveEnd) continue; // Not active in this year

          // Generate checks based on payment frequency
          var checks: CheckRow[] = [];

          if (isQuarterly) {
            for (var q = 0; q < 4; q++) {
              var qStart = new Date(year, q * 3, 1);
              var qEnd = new Date(year, (q + 1) * 3, 0); // last day of quarter

              // Skip quarters before effective start
              if (qEnd < effectiveStart) continue;
              // Skip quarters after effective end
              if (qStart > effectiveEnd) continue;

              // Calculate actual days/months in this quarter for this unit
              var periodStart = qStart < effectiveStart ? effectiveStart : qStart;
              var periodEnd = qEnd > effectiveEnd ? effectiveEnd : qEnd;

              // Pro-rata calculation
              var totalDaysInQuarter = Math.round((qEnd.getTime() - qStart.getTime()) / 86400000) + 1;
              var actualDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;
              var ratio = actualDays / totalDaysInQuarter;

              var rentBV = indexedMonthly * 3 * ratio;
              var mgmtBV = mgmtMonthly * 3 * ratio;
              var totalBV = rentBV + mgmtBV;
              var vat = isVat ? totalBV * vatPct : 0;

              var checkDate = year + "-" + String(q * 3 + 1).padStart(2, "0") + "-01";

              checks.push({
                label: "רבעון " + (q + 1) + (ratio < 0.99 ? " (חלקי — " + actualDays + " ימים)" : ""),
                months: 3,
                partialDays: ratio < 0.99 ? actualDays : 0,
                totalDaysInMonth: totalDaysInQuarter,
                checkDate: checkDate,
                rentBeforeVat: rentBV,
                mgmtBeforeVat: mgmtBV,
                totalBeforeVat: totalBV,
                vat: vat,
                totalWithVat: totalBV + vat,
              });
            }
          } else {
            // Monthly
            for (var m = 0; m < 12; m++) {
              var mStart = new Date(year, m, 1);
              var mEnd = new Date(year, m + 1, 0);

              if (mEnd < effectiveStart) continue;
              if (mStart > effectiveEnd) continue;

              var periodStartM = mStart < effectiveStart ? effectiveStart : mStart;
              var periodEndM = mEnd > effectiveEnd ? effectiveEnd : mEnd;

              var totalDaysMonth = daysInMonth(year, m + 1);
              var actualDaysM = Math.round((periodEndM.getTime() - periodStartM.getTime()) / 86400000) + 1;
              var ratioM = actualDaysM / totalDaysMonth;

              var rentBVM = indexedMonthly * ratioM;
              var mgmtBVM = mgmtMonthly * ratioM;
              var totalBVM = rentBVM + mgmtBVM;
              var vatM = isVat ? totalBVM * vatPct : 0;

              var checkDateM = year + "-" + String(m + 1).padStart(2, "0") + "-01";

              checks.push({
                label: "חודש " + (m + 1) + (ratioM < 0.99 ? " (חלקי — " + actualDaysM + " ימים)" : ""),
                months: 1,
                partialDays: ratioM < 0.99 ? actualDaysM : 0,
                totalDaysInMonth: totalDaysMonth,
                checkDate: checkDateM,
                rentBeforeVat: rentBVM,
                mgmtBeforeVat: mgmtBVM,
                totalBeforeVat: totalBVM,
                vat: vatM,
                totalWithVat: totalBVM + vatM,
              });
            }
          }

          if (checks.length > 0) {
            rows.push({
              contractId: c.id,
              tenantName: (c.tenants as any)?.name || "—",
              spaceName: spaceName,
              spaceArea: area,
              baseRentMonthly: baseMonthly,
              indexedRentMonthly: indexedMonthly,
              mgmtAdvanceMonthly: mgmtMonthly,
              totalMonthly: totalMonthly,
              cpiBaseValue: cpiBaseValue,
              cpiBaseDate: cpiBaseDate,
              cpiCurrentValue: cpiCurrentValue,
              cpiCurrentDate: cpiCurrentDate,
              indexationMethod: c.indexation_method || "standard",
              startDate: effectiveStart.toISOString().split("T")[0],
              checks: checks,
            });
          }
        }
      }
      setResults(rows);
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setComputing(false); }
  }

  async function createCharges() {
    setCreatingCharges(true);
    try {
      var count = 0;
      for (var r of results) {
        for (var p of r.checks) {
          await supabase.from("advance_payments").upsert({
            contract_id: r.contractId,
            year: year,
            period: r.spaceName + " — " + p.label,
            base_rent: r.baseRentMonthly * p.months,
            indexed_rent: p.rentBeforeVat,
            management_advance: p.mgmtBeforeVat,
            total_before_vat: p.totalBeforeVat,
            vat_amount: p.vat,
            total_with_vat: p.totalWithVat,
            check_date: p.checkDate,
            cpi_base_value: r.cpiBaseValue,
            cpi_at_payment: r.cpiCurrentValue,
            status: "pending",
          }, { onConflict: "contract_id,year,period" });
          count++;
        }
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_advances", notes: count + " מקדמות" });
      alert("✅ נוצרו " + count + " מקדמות");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setCreatingCharges(false); }
  }

  async function createLetters() {
    setCreatingLetters(true);
    try {
      // Group rows by contract for consolidated letter
      var byContract: Record<string, AdvanceRow[]> = {};
      for (var r of results) {
        if (!byContract[r.contractId]) byContract[r.contractId] = [];
        byContract[r.contractId].push(r);
      }
      var count = 0;
      for (var [cid, unitRows] of Object.entries(byContract)) {
        var body = "שוכר/ת נכבד/ה,\n\nלהלן דרישת מקדמות שכ\"ד ודמי ניהול לשנת " + year + ":\n";
        body += "תאריך חישוב מדד: " + fmtDate(cpiCalcDate) + "\n\n";

        var grandTotal = 0;
        for (var ur of unitRows) {
          body += "📐 " + ur.spaceName + " (" + ur.spaceArea + " מ\"ר)\n";
          body += "   שכ\"ד בסיס: " + fmtMoney(ur.baseRentMonthly) + " | צמוד: " + fmtMoney(ur.indexedRentMonthly) + " | ד.נ.: " + fmtMoney(ur.mgmtAdvanceMonthly) + "\n";
          body += "   מדד בסיס: " + ur.cpiBaseValue + " → מדד לחישוב: " + (ur.cpiCurrentValue || "—") + "\n\n";
          for (var ch of ur.checks) {
            body += "   " + ch.label + " (" + fmtDate(ch.checkDate) + "): " + fmtMoney(ch.totalWithVat) + " כולל מע\"מ\n";
            grandTotal += ch.totalWithVat;
          }
          body += "\n";
        }
        body += "סה\"כ שנתי: " + fmtMoney(grandTotal) + "\n\nבברכה,\nהנהלת הנכס";

        await supabase.from("letters").insert({
          contract_id: cid,
          letter_type: "demand",
          subject: "דרישת מקדמות שכ\"ד ודמי ניהול " + year,
          body: body,
          status: "draft",
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_advance_letters", notes: count + " מכתבים" });
      alert("✅ נוצרו " + count + " מכתבי דרישה");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setCreatingLetters(false); }
  }

  var totalAllChecks = results.reduce(function(s, r) { return s + r.checks.reduce(function(ss, p) { return ss + p.totalWithVat; }, 0); }, 0);
  var totalRentOnly = results.reduce(function(s, r) { return s + r.checks.reduce(function(ss, p) { return ss + p.rentBeforeVat; }, 0); }, 0);
  var totalMgmtOnly = results.reduce(function(s, r) { return s + r.checks.reduce(function(ss, p) { return ss + p.mgmtBeforeVat; }, 0); }, 0);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">📋 מקדמות שכ&quot;ד — חישוב שייקים</h2>
        <p className="text-sm text-slate-500 mb-4">חישוב סכומי שייקים מראש לפי יחידה, כולל שכ&quot;ד צמוד למדד ומקדמת דמי ניהול. תומך ביחידות שמתחילות באמצע שנה (פרו-רטה).</p>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
            <select value={propId} onChange={function(e) { setPropId(e.target.value); setResults([]); }} className={ic}>
              <option value="">— בחר נכס —</option>
              {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שנת שכירות</label>
            <input type="number" value={year} onChange={function(e) { setYear(Number(e.target.value)); setResults([]); }} className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך חישוב מדד</label>
            <input type="date" value={cpiCalcDate} onChange={function(e) { setCpiCalcDate(e.target.value); setResults([]); }} className={ic} />
            <div className="text-xs text-slate-400 mt-0.5">המערכת תיקח את המדד הידוע בתאריך זה (t-2)</div>
          </div>
        </div>

        <button onClick={compute} disabled={computing || !propId}
          className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {computing ? "מחשב..." : "חשב מקדמות"}
        </button>

        {results.length > 0 && (
          <div className="mt-5 space-y-4">
            {/* Summary KPIs */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                <div className="text-xs text-green-600">שכ&quot;ד צמוד (לפני מע&quot;מ)</div>
                <div className="text-lg font-black text-green-800">{fmtMoney(totalRentOnly)}</div>
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                <div className="text-xs text-blue-600">מקדמת דמי ניהול (לפני מע&quot;מ)</div>
                <div className="text-lg font-black text-blue-800">{fmtMoney(totalMgmtOnly)}</div>
              </div>
              <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-center">
                <div className="text-xs text-purple-600">סה&quot;כ שייקים (כולל מע&quot;מ)</div>
                <div className="text-lg font-black text-purple-800">{fmtMoney(totalAllChecks)}</div>
              </div>
            </div>

            {/* Per-unit detail */}
            {results.map(function(r, ri) {
              var unitTotal = r.checks.reduce(function(s, p) { return s + p.totalWithVat; }, 0);
              return (
                <div key={ri} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{r.tenantName}</div>
                      <div className="text-xs text-slate-500">📐 {r.spaceName} | {r.spaceArea} מ&quot;ר | תחילה: {fmtDate(r.startDate)}</div>
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-bold text-green-700">{fmtMoney(unitTotal)}</div>
                      <div className="text-xs text-slate-500">סה&quot;כ שנתי כולל מע&quot;מ</div>
                    </div>
                  </div>

                  {/* Contract details */}
                  <div className="px-5 py-2 grid grid-cols-5 gap-2 text-xs border-b border-slate-100 bg-blue-50/30">
                    <div>
                      <div className="text-slate-500">שכ&quot;ד בסיס</div>
                      <div className="font-bold text-slate-800">{fmtMoney(r.baseRentMonthly)}/חודש</div>
                    </div>
                    <div>
                      <div className="text-slate-500">שכ&quot;ד צמוד</div>
                      <div className="font-bold text-green-700">{fmtMoney(r.indexedRentMonthly)}/חודש</div>
                    </div>
                    <div>
                      <div className="text-slate-500">מקדמת ד.נ.</div>
                      <div className="font-bold text-slate-800">{fmtMoney(r.mgmtAdvanceMonthly)}/חודש</div>
                    </div>
                    <div>
                      <div className="text-slate-500">מדד בסיס</div>
                      <div className="font-bold text-slate-800">{r.cpiBaseValue || "—"} ({fmtDate(r.cpiBaseDate)})</div>
                    </div>
                    <div>
                      <div className="text-slate-500">מדד לחישוב</div>
                      <div className="font-bold text-slate-800">{r.cpiCurrentValue || "—"} ({r.cpiCurrentDate})</div>
                    </div>
                  </div>

                  {/* Check table */}
                  <table className="w-full text-sm text-right">
                    <thead className="bg-slate-50 text-xs">
                      <tr>
                        <th className="px-3 py-2 font-semibold text-slate-700">תקופה</th>
                        <th className="px-3 py-2 font-semibold text-slate-700">תאריך שייק</th>
                        <th className="px-3 py-2 font-semibold text-slate-700">שכ&quot;ד צמוד</th>
                        <th className="px-3 py-2 font-semibold text-slate-700">ד.נ.</th>
                        <th className="px-3 py-2 font-semibold text-slate-700">לפני מע&quot;מ</th>
                        <th className="px-3 py-2 font-semibold text-slate-700">מע&quot;מ</th>
                        <th className="px-3 py-2 font-semibold text-slate-700">סכום שייק</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.checks.map(function(ch, ci) {
                        return (
                          <tr key={ci} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2 font-semibold text-slate-800">{ch.label}</td>
                            <td className="px-3 py-2 text-slate-600">{fmtDate(ch.checkDate)}</td>
                            <td className="px-3 py-2 text-green-700">{fmtMoney(ch.rentBeforeVat)}</td>
                            <td className="px-3 py-2 text-slate-600">{fmtMoney(ch.mgmtBeforeVat)}</td>
                            <td className="px-3 py-2 text-slate-700">{fmtMoney(ch.totalBeforeVat)}</td>
                            <td className="px-3 py-2 text-slate-500">{fmtMoney(ch.vat)}</td>
                            <td className="px-3 py-2 font-bold text-blue-700">{fmtMoney(ch.totalWithVat)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-green-50 border-t-2 border-green-200">
                      <tr>
                        <td className="px-3 py-2 font-bold text-green-800" colSpan={2}>סה&quot;כ</td>
                        <td className="px-3 py-2 font-bold text-green-700">{fmtMoney(r.checks.reduce(function(s,c){return s+c.rentBeforeVat;},0))}</td>
                        <td className="px-3 py-2 font-bold text-slate-700">{fmtMoney(r.checks.reduce(function(s,c){return s+c.mgmtBeforeVat;},0))}</td>
                        <td className="px-3 py-2 font-bold text-slate-800">{fmtMoney(r.checks.reduce(function(s,c){return s+c.totalBeforeVat;},0))}</td>
                        <td className="px-3 py-2 font-bold text-slate-500">{fmtMoney(r.checks.reduce(function(s,c){return s+c.vat;},0))}</td>
                        <td className="px-3 py-2 font-black text-blue-800">{fmtMoney(unitTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })}

            {/* Grand total */}
            <div className="rounded-xl bg-purple-50 border-2 border-purple-200 p-4 text-center">
              <div className="text-2xl font-black text-purple-800">{fmtMoney(totalAllChecks)}</div>
              <div className="text-sm text-purple-600">סה&quot;כ מקדמות לכל היחידות — שנת {year}</div>
            </div>

            <div className="flex gap-3">
              <button onClick={createCharges} disabled={creatingCharges}
                className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {creatingCharges ? "יוצר..." : "💾 שמור מקדמות"}
              </button>
              <button onClick={createLetters} disabled={creatingLetters}
                className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                {creatingLetters ? "יוצר..." : "📄 צור מכתבי דרישה"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
