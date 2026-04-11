"use client";
import { useState, useEffect } from "react";
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

interface AdvanceRow {
  contractId: string;
  tenantName: string;
  spacesDesc: string;
  baseRentMonthly: number;
  cpiBaseValue: number;
  cpiBaseDate: string;
  cpiCurrentValue: number;
  cpiCurrentDate: string;
  indexedRentMonthly: number;
  mgmtAdvanceMonthly: number;
  totalMonthly: number;
  periods: Array<{ label: string; months: number; checkDate: string; totalBeforeVat: number; vat: number; totalWithVat: number; }>;
}

export default function AdvancesTab({ properties }: { properties: any[] }) {
  const currentYear = new Date().getFullYear();
  const [propId, setPropId] = useState("");
  const [year, setYear] = useState(currentYear + 1);
  const [computing, setComputing] = useState(false);
  const [results, setResults] = useState<AdvanceRow[]>([]);
  const [creatingCharges, setCreatingCharges] = useState(false);
  const [creatingLetters, setCreatingLetters] = useState(false);

  async function compute() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    setComputing(true);
    setResults([]);
    try {
      // Load contracts with checks for this property
      var { data: contracts } = await supabase.from("contracts")
        .select("id, rent_per_sqm, charged_area, investment_addition, payment_method, payment_frequency, vat_type, indexation_method, index_base_date, index_base_value, start_date, end_date, is_amendment, tenants(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))")
        .eq("property_id", propId)
        .in("status", ["active", "extended"])
        .eq("is_amendment", false);

      // Filter only checks_advance contracts
      contracts = (contracts ?? []).filter(function(c: any) { return c.payment_method === "checks_advance"; });
      if (contracts.length === 0) { alert("אין חוזים עם שיקים מראש בנכס זה"); setComputing(false); return; }

      // Load management rates (billing groups or property budget)
      var { data: mgmtGroups } = await supabase.from("billing_groups")
        .select("*,billing_group_spaces(space_id)")
        .eq("property_id", propId).eq("group_type", "management").eq("year", year);
      var { data: budget } = await supabase.from("property_budgets")
        .select("management_budget").eq("property_id", propId).eq("year", year).maybeSingle();
      var { data: propSpaces } = await supabase.from("spaces")
        .select("id,area").eq("property_id", propId);

      var totalPropArea = (propSpaces ?? []).reduce(function(s: number, sp: any) { return s + (Number(sp.area) || 0); }, 0);
      var defaultMgmtRate = budget?.management_budget && totalPropArea > 0
        ? Number(budget.management_budget) / totalPropArea / 12 : 0;

      // Build space → mgmt rate map
      var spaceMgmtRate: Record<string, number> = {};
      for (var g of mgmtGroups ?? []) {
        var sids = (g.billing_group_spaces || []).map(function(x: any) { return x.space_id; });
        var gArea = sids.reduce(function(s: number, sid: string) { var sp = (propSpaces ?? []).find(function(x: any) { return x.id === sid; }); return s + (Number(sp?.area) || 0); }, 0);
        var rate = Number(g.rate_per_sqm_monthly) || (Number(g.annual_amount) && gArea > 0 ? Number(g.annual_amount) / gArea / 12 : 0);
        for (var sid of sids) spaceMgmtRate[sid] = rate;
      }

      // Get VAT rate
      var { data: vatData } = await supabase.from("vat_rates").select("rate_pct").order("effective_from", { ascending: false }).limit(1);
      var vatPct = (vatData && vatData.length > 0 ? Number(vatData[0].rate_pct) : 18) / 100;

      var rows: AdvanceRow[] = [];
      for (var c of contracts) {
        // Calculate base monthly rent (per-unit aware)
        var baseMonthly = 0;
        var spacesDesc: string[] = [];
        (c.contract_spaces || []).forEach(function(cs: any) {
          var area = cs.spaces?.area || 0;
          if (cs.charge_method === "fixed" && cs.fixed_rent) baseMonthly += Number(cs.fixed_rent);
          else baseMonthly += (Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0) * area;
          if (cs.spaces?.space_name) spacesDesc.push(cs.spaces.space_name);
        });
        if (baseMonthly === 0) baseMonthly = (Number(c.rent_per_sqm) || 0) * (Number(c.charged_area) || 0);

        // Calculate management advance per month
        var mgmtMonthly = 0;
        (c.contract_spaces || []).forEach(function(cs: any) {
          var area = cs.spaces?.area || 0;
          var r = spaceMgmtRate[cs.space_id] ?? defaultMgmtRate;
          mgmtMonthly += r * area;
        });
        if (mgmtMonthly === 0 && defaultMgmtRate > 0) mgmtMonthly = defaultMgmtRate * (Number(c.charged_area) || 0);

        // CPI calculation
        var cpiBaseDate = c.index_base_date || c.start_date;
        var fromCbs = formatDateForCbs(cpiBaseDate);
        // Use last known CPI (Nov publication = Oct CPI)
        var toCbs = formatDateForCbs(new Date().toISOString());
        var cpiRatio = 1;
        var cpiBaseValue = Number(c.index_base_value) || 0;
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

        // Generate periods based on payment frequency
        var periods: AdvanceRow["periods"] = [];
        var isVat = c.vat_type === "taxable";

        if (c.payment_frequency === "quarterly") {
          for (var q = 1; q <= 4; q++) {
            var startMonth = (q - 1) * 3 + 1;
            var checkDate = year + "-" + String(startMonth).padStart(2, "0") + "-01";
            var totalBV = totalMonthly * 3;
            var vat = isVat ? totalBV * vatPct : 0;
            periods.push({
              label: "רבעון " + q,
              months: 3,
              checkDate: checkDate,
              totalBeforeVat: totalBV,
              vat: vat,
              totalWithVat: totalBV + vat,
            });
          }
        } else {
          // Monthly
          for (var m = 1; m <= 12; m++) {
            var checkDate2 = year + "-" + String(m).padStart(2, "0") + "-01";
            var vat2 = isVat ? totalMonthly * vatPct : 0;
            periods.push({
              label: "חודש " + m,
              months: 1,
              checkDate: checkDate2,
              totalBeforeVat: totalMonthly,
              vat: vat2,
              totalWithVat: totalMonthly + vat2,
            });
          }
        }

        rows.push({
          contractId: c.id,
          tenantName: (c.tenants as any)?.name || "—",
          spacesDesc: spacesDesc.join(", "),
          baseRentMonthly: baseMonthly,
          cpiBaseValue: cpiBaseValue,
          cpiBaseDate: cpiBaseDate,
          cpiCurrentValue: cpiCurrentValue,
          cpiCurrentDate: cpiCurrentDate,
          indexedRentMonthly: indexedMonthly,
          mgmtAdvanceMonthly: mgmtMonthly,
          totalMonthly: totalMonthly,
          periods: periods,
        });
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
        for (var p of r.periods) {
          await supabase.from("advance_payments").upsert({
            contract_id: r.contractId,
            year: year,
            period: p.label,
            base_rent: r.baseRentMonthly * p.months,
            indexed_rent: r.indexedRentMonthly * p.months,
            management_advance: r.mgmtAdvanceMonthly * p.months,
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
      var count = 0;
      for (var r of results) {
        var body = "שוכר/ת נכבד/ה,\n\nלהלן דרישת מקדמות שכ\"ד ודמי ניהול לשנת " + year + ":\n\n";
        body += "שכ\"ד בסיס: " + fmtMoney(r.baseRentMonthly) + "/חודש\n";
        body += "שכ\"ד צמוד למדד: " + fmtMoney(r.indexedRentMonthly) + "/חודש\n";
        body += "מקדמת דמי ניהול: " + fmtMoney(r.mgmtAdvanceMonthly) + "/חודש\n\n";
        body += "פירוט שייקים:\n";
        for (var p of r.periods) {
          body += p.label + " (" + fmtDate(p.checkDate) + "): " + fmtMoney(p.totalWithVat) + " (כולל מע\"מ)\n";
        }
        body += "\nסה\"כ שנתי: " + fmtMoney(r.periods.reduce(function(s, p) { return s + p.totalWithVat; }, 0)) + "\n";
        body += "\nבברכה,\nהנהלת הנכס";

        await supabase.from("letters").insert({
          contract_id: r.contractId,
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

  var totalAllChecks = results.reduce(function(s, r) { return s + r.periods.reduce(function(ss, p) { return ss + p.totalWithVat; }, 0); }, 0);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">📋 מקדמות שכ&quot;ד — חישוב שייקים</h2>
        <p className="text-sm text-slate-500 mb-4">חישוב סכומי שייקים מראש לשנה הבאה, כולל שכ&quot;ד צמוד למדד ומקדמת דמי ניהול.</p>

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
          className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {computing ? "מחשב..." : "חשב מקדמות"}
        </button>

        {results.length > 0 && (
          <div className="mt-5 space-y-4">
            {results.map(function(r) {
              return (
                <div key={r.contractId} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{r.tenantName}</div>
                      <div className="text-xs text-slate-500">{r.spacesDesc}</div>
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-bold text-green-700">{fmtMoney(r.totalMonthly)}/חודש</div>
                      <div className="text-xs text-slate-500">צמוד + ד.נ.</div>
                    </div>
                  </div>
                  {/* Contract details */}
                  <div className="px-5 py-3 grid grid-cols-4 gap-3 text-xs border-b border-slate-100 bg-blue-50/30">
                    <div>
                      <div className="text-slate-500">שכ&quot;ד בסיס</div>
                      <div className="font-bold text-slate-800">{fmtMoney(r.baseRentMonthly)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">שכ&quot;ד צמוד</div>
                      <div className="font-bold text-green-700">{fmtMoney(r.indexedRentMonthly)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">מקדמת ד.נ.</div>
                      <div className="font-bold text-slate-800">{fmtMoney(r.mgmtAdvanceMonthly)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">מדד</div>
                      <div className="font-bold text-slate-800">{r.cpiBaseValue ? r.cpiBaseValue + " → " + (r.cpiCurrentValue || "—") : "ללא"}</div>
                    </div>
                  </div>
                  {/* Check table */}
                  <table className="w-full text-sm text-right">
                    <thead className="bg-slate-50 text-xs">
                      <tr>
                        <th className="px-4 py-2 font-semibold text-slate-700">תקופה</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">תאריך שייק</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">לפני מע&quot;מ</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">מע&quot;מ</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">סכום שייק</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.periods.map(function(p, pi) {
                        return (
                          <tr key={pi} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-2 font-semibold text-slate-800">{p.label}</td>
                            <td className="px-4 py-2 text-slate-600">{fmtDate(p.checkDate)}</td>
                            <td className="px-4 py-2 text-slate-600">{fmtMoney(p.totalBeforeVat)}</td>
                            <td className="px-4 py-2 text-slate-600">{fmtMoney(p.vat)}</td>
                            <td className="px-4 py-2 font-bold text-blue-700">{fmtMoney(p.totalWithVat)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-green-50 border-t-2 border-green-200">
                      <tr>
                        <td className="px-4 py-2 font-bold text-green-800" colSpan={4}>סה&quot;כ שנתי</td>
                        <td className="px-4 py-2 font-black text-green-800">{fmtMoney(r.periods.reduce(function(s, p) { return s + p.totalWithVat; }, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })}

            {/* Total across all contracts */}
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-center">
              <div className="text-2xl font-black text-blue-800">{fmtMoney(totalAllChecks)}</div>
              <div className="text-sm text-blue-600">סה&quot;כ מקדמות לכל השוכרים — שנת {year}</div>
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
