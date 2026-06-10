"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { getVatRates, vatPctAt, type VatRate } from '@/lib/vat';
import { PageHero } from '@/components/ui';

function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtPct(n: number) { return (Math.round(n * 10) / 10).toFixed(1) + "%"; }

const MONTHS_HE = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

const ic = "rounded-lg border border-slate-300 px-3 py-2 text-right text-sm bg-white";

// ─── Per-month bucket ─────────────────────────────────────────────────────
type MonthBucket = {
  month: number;
  // Income POTENTIAL (forecast) — broken by source
  potRent: number;       // rent from advances + revenue reports
  potMgmt: number;       // management advance + management diff charges
  potOther: number;      // insurance, cpi_diff, waste, other charges
  // Income ACTUAL (collected)
  paidRent: number;
  paidMgmt: number;
  paidOther: number;
  // Occupancy
  occupiedArea: number;
  vacantArea: number;
  activeContracts: number;
  // Contract events that month
  contractsStarting: Array<{ name: string; date: string }>;
  contractsEnding: Array<{ name: string; date: string }>;
};

function emptyBucket(month: number): MonthBucket {
  return {
    month, potRent: 0, potMgmt: 0, potOther: 0,
    paidRent: 0, paidMgmt: 0, paidOther: 0,
    occupiedArea: 0, vacantArea: 0, activeContracts: 0,
    contractsStarting: [], contractsEnding: [],
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────
export default function CashflowPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [propertyFilter, setPropertyFilter] = useState<string>("");
  const [tenantSearch, setTenantSearch] = useState<string>("");
  const [compareYoY, setCompareYoY] = useState<boolean>(false);

  const [properties,   setProperties]   = useState<any[]>([]);
  const [spaces,       setSpaces]       = useState<any[]>([]);
  const [contracts,    setContracts]    = useState<any[]>([]);
  const [advances,     setAdvances]     = useState<any[]>([]);
  const [charges,      setCharges]      = useState<any[]>([]);
  const [revenues,     setRevenues]     = useState<any[]>([]);
  // Previous year — only loaded when YoY enabled
  const [advancesPrev, setAdvancesPrev] = useState<any[]>([]);
  const [chargesPrev,  setChargesPrev]  = useState<any[]>([]);
  const [revenuesPrev, setRevenuesPrev] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Full VAT-rate history; each revenue row is grossed-up at the rate in effect
  // for ITS month (so reconstructing a past year uses that year's rate).
  const [vatRates, setVatRates] = useState<VatRate[]>([]);

  useEffect(function() { loadAll(); }, [year, compareYoY]);

  async function loadAll() {
    setLoading(true);
    // VAT history from the configured source (vat_rates), not a literal.
    setVatRates(await getVatRates());
    var yearStart = year + "-01-01";
    var yearEnd   = (year + 1) + "-01-01";
    var prevStart = (year - 1) + "-01-01";
    var prevEnd   = year + "-01-01";

    // Supabase query builders are thenable but not strict Promises — using
    // `any[]` here keeps Promise.all happy without forcing wrappers.
    const promises: any[] = [
      // Properties — name + total_area (kept for the contract-context bar)
      supabase.from("properties").select("id, name, total_area"),
      // All spaces — the TRUE denominator for occupancy. properties.total_area
      // is manually entered and frequently differs from the actual sum of
      // spaces.area, so we use this instead.
      supabase.from("spaces").select("id, property_id, area, space_name"),
      // Contracts. contract_spaces brings the space_ids each contract holds —
      // we sum the spaces.area for those ids to get the real occupied area.
      supabase.from("contracts")
        .select("id, status, is_amendment, rent_type, revenue_pct, start_date, end_date, charged_area, rent_per_sqm, vat_type, tenant_id, property_id, tenants(name), properties(name), contract_spaces(space_id, spaces(area))")
        .eq("is_amendment", false),
      // Advance payments for the year
      supabase.from("advance_payments")
        .select("id, contract_id, check_date, total_with_vat, total_before_vat, vat_amount, management_advance, actual_paid, waived, space_name, tenant_name")
        .gte("check_date", yearStart).lt("check_date", yearEnd),
      // Charges for the year (use due_date when present)
      supabase.from("charges")
        .select("id, contract_id, charge_type, total_amount, status, due_date, billing_period_start, contracts(tenant_id, property_id, tenants(name), properties(name))")
        .or("due_date.gte." + yearStart + ",billing_period_start.gte." + yearStart),
      // Revenue reports for the year
      supabase.from("revenue_reports")
        .select("id, contract_id, report_month, gross_revenue, final_rent, actual_paid, contracts(tenant_id, property_id, tenants(name), properties(name), vat_type)")
        .gte("report_month", yearStart).lt("report_month", yearEnd),
    ];

    if (compareYoY) {
      promises.push(
        supabase.from("advance_payments")
          .select("id, contract_id, check_date, total_with_vat, total_before_vat, vat_amount, management_advance, actual_paid, waived")
          .gte("check_date", prevStart).lt("check_date", prevEnd),
        supabase.from("charges")
          .select("id, contract_id, charge_type, total_amount, status, due_date, billing_period_start")
          .or("due_date.gte." + prevStart + ",billing_period_start.gte." + prevStart),
        supabase.from("revenue_reports")
          .select("id, contract_id, report_month, final_rent, actual_paid")
          .gte("report_month", prevStart).lt("report_month", prevEnd),
      );
    }

    const results = await Promise.all(promises);
    setProperties(results[0].data || []);
    setSpaces(results[1].data || []);
    setContracts(results[2].data || []);
    setAdvances(results[3].data || []);
    setCharges(results[4].data || []);
    setRevenues(results[5].data || []);
    if (compareYoY) {
      setAdvancesPrev(results[6]?.data || []);
      setChargesPrev(results[7]?.data || []);
      setRevenuesPrev(results[8]?.data || []);
    } else {
      setAdvancesPrev([]); setChargesPrev([]); setRevenuesPrev([]);
    }
    setLoading(false);
  }

  // ─── Filter helpers ──────────────────────────────────────────────────
  function contractMatchesFilter(c: any): boolean {
    if (propertyFilter && c.property_id !== propertyFilter) return false;
    if (tenantSearch) {
      var q = tenantSearch.toLowerCase();
      var name = ((c.tenants as any)?.name || "").toLowerCase();
      if (name.indexOf(q) === -1) return false;
    }
    return true;
  }
  function contractIdsMatching(): Set<string> {
    var ids = new Set<string>();
    contracts.filter(contractMatchesFilter).forEach(function(c) { ids.add(c.id); });
    return ids;
  }

  // Compute buckets for a given year (using the loaded data sets).
  // Pass advance/charges/revenues arrays so we can reuse for YoY.
  function computeBuckets(adv: any[], chg: any[], rev: any[], yr: number): MonthBucket[] {
    var matchingIds = contractIdsMatching();
    var months: MonthBucket[] = [];
    for (var i = 1; i <= 12; i++) months.push(emptyBucket(i));

    // 1) Advances
    adv.forEach(function(a: any) {
      if (a.waived) return;
      if (!matchingIds.has(a.contract_id)) return;
      var d = a.check_date ? new Date(a.check_date) : null;
      if (!d || d.getFullYear() !== yr) return;
      var m = d.getMonth();
      var totalGross = Number(a.total_with_vat) || 0;
      var mgmt       = Number(a.management_advance) || 0;
      var paid       = Number(a.actual_paid) || 0;
      var rent       = totalGross - mgmt; // rent net of mgmt within the same advance
      months[m].potRent += rent;
      months[m].potMgmt += mgmt;
      if (paid > 0) {
        // Distribute proportionally between rent and mgmt
        if (totalGross > 0) {
          months[m].paidRent += paid * (rent / totalGross);
          months[m].paidMgmt += paid * (mgmt / totalGross);
        } else {
          months[m].paidRent += paid;
        }
      }
    });

    // 2) Charges
    chg.forEach(function(c: any) {
      if (!matchingIds.has(c.contract_id)) return;
      var dStr = c.due_date || c.billing_period_start;
      if (!dStr) return;
      var d = new Date(dStr);
      if (d.getFullYear() !== yr) return;
      var m = d.getMonth();
      var amt = Number(c.total_amount) || 0;
      var paid = c.status === "paid" ? amt : 0;
      if (c.charge_type === "management") {
        months[m].potMgmt += amt;
        months[m].paidMgmt += paid;
      } else if (c.charge_type === "rent") {
        months[m].potRent += amt;
        months[m].paidRent += paid;
      } else {
        // insurance, cpi_diff, waste, other → "other"
        months[m].potOther += amt;
        months[m].paidOther += paid;
      }
    });

    // 3) Revenue reports — count as rent
    rev.forEach(function(r: any) {
      if (!matchingIds.has(r.contract_id)) return;
      var d = r.report_month ? new Date(r.report_month) : null;
      if (!d || d.getFullYear() !== yr) return;
      var m = d.getMonth();
      var amt = Number(r.final_rent) || 0;
      var vatType = (r.contracts as any)?.vat_type;
      var vp = vatPctAt(vatRates, r.report_month);
      var withVat = vatType === "taxable" ? amt * (1 + vp) : amt;
      months[m].potRent += withVat;
      var paid = Number(r.actual_paid) || 0;
      if (paid > 0) months[m].paidRent += paid * (vatType === "taxable" ? (1 + vp) : 1);
    });

    // 4) Occupancy + contract events
    // Denominator: sum of spaces.area for the filtered property/properties —
    // same formula /properties uses, matching the user's expectation.
    var matchingContracts = contracts.filter(contractMatchesFilter);
    var totalArea = spaces
      .filter(function(s) { return !propertyFilter || s.property_id === propertyFilter; })
      .reduce(function(s, sp) { return s + (Number(sp.area) || 0); }, 0);
    // Map space_id → area for quick lookup
    var spaceAreaById: Record<string, number> = {};
    spaces.forEach(function(sp) { spaceAreaById[sp.id] = Number(sp.area) || 0; });

    months.forEach(function(mb) {
      var monthStart = new Date(yr, mb.month - 1, 1);
      var monthEnd   = new Date(yr, mb.month, 0);
      var heldSpaceIds: Record<string, boolean> = {};
      var active = 0;
      matchingContracts.forEach(function(c) {
        var cs = c.start_date ? new Date(c.start_date) : null;
        var ce = c.end_date ? new Date(c.end_date) : null;
        if (cs && cs > monthEnd) return;
        if (ce && ce < monthStart) return;
        if (c.status !== "active" && c.status !== "expiring" && c.status !== "extended") return;
        // Collect the space_ids this contract holds. The actual area comes
        // from the spaces table to avoid the data drift in contract.charged_area.
        ((c.contract_spaces as any[]) || []).forEach(function(cs2: any) {
          if (cs2?.space_id) heldSpaceIds[cs2.space_id] = true;
        });
        active++;
        if (cs && cs.getFullYear() === yr && cs.getMonth() === mb.month - 1) {
          mb.contractsStarting.push({ name: (c.tenants as any)?.name || "—", date: c.start_date });
        }
        if (ce && ce.getFullYear() === yr && ce.getMonth() === mb.month - 1) {
          mb.contractsEnding.push({ name: (c.tenants as any)?.name || "—", date: c.end_date });
        }
      });
      var occupied = Object.keys(heldSpaceIds).reduce(function(s, sid) { return s + (spaceAreaById[sid] || 0); }, 0);
      mb.occupiedArea = occupied;
      mb.vacantArea = Math.max(0, totalArea - occupied);
      mb.activeContracts = active;
    });

    return months;
  }

  const monthly     = computeBuckets(advances, charges, revenues, year);
  const monthlyPrev = compareYoY ? computeBuckets(advancesPrev, chargesPrev, revenuesPrev, year - 1) : [];

  // Avg rent/sqm — used to estimate potential income from vacant area
  function avgRentPerSqmPerMonth(): number {
    var matching = contracts.filter(contractMatchesFilter);
    var totalArea = matching.reduce(function(s, c) { return s + (Number(c.charged_area) || 0); }, 0);
    var totalRent = matching.reduce(function(s, c) {
      return s + (Number(c.rent_per_sqm) || 0) * (Number(c.charged_area) || 0);
    }, 0);
    return totalArea > 0 ? totalRent / totalArea : 0;
  }

  // Year totals
  const totals = monthly.reduce(function(acc, m) {
    acc.potRent  += m.potRent;
    acc.potMgmt  += m.potMgmt;
    acc.potOther += m.potOther;
    acc.paidRent  += m.paidRent;
    acc.paidMgmt  += m.paidMgmt;
    acc.paidOther += m.paidOther;
    return acc;
  }, { potRent: 0, potMgmt: 0, potOther: 0, paidRent: 0, paidMgmt: 0, paidOther: 0 });

  const totalsPrev = monthlyPrev.reduce(function(acc, m) {
    acc.pot  += m.potRent + m.potMgmt + m.potOther;
    acc.paid += m.paidRent + m.paidMgmt + m.paidOther;
    return acc;
  }, { pot: 0, paid: 0 });

  var totalPotential = totals.potRent + totals.potMgmt + totals.potOther;
  var totalPaid      = totals.paidRent + totals.paidMgmt + totals.paidOther;
  var avgPct = totalPotential > 0 ? (totalPaid / totalPotential) * 100 : 0;

  // YTD metric — only count months whose due dates have already passed.
  // This separates "collection performance on bills that came due" from "bills
  // that haven't been issued yet". The full-year % is misleading mid-year
  // (future months count as un-collected, dragging the % down artificially).
  var todayDate = new Date();
  var lastDueMonth = (year === currentYear)
    ? todayDate.getMonth() + 1                       // current month (inclusive)
    : (year < currentYear ? 12 : 0);                  // past year → full; future → 0
  var ytdPotential = monthly.slice(0, lastDueMonth).reduce(function(s, m) { return s + m.potRent + m.potMgmt + m.potOther; }, 0);
  var ytdPaid      = monthly.slice(0, lastDueMonth).reduce(function(s, m) { return s + m.paidRent + m.paidMgmt + m.paidOther; }, 0);
  var ytdPct = ytdPotential > 0 ? (ytdPaid / ytdPotential) * 100 : 0;

  // Occupancy avg + vacant potential
  var avgOccupancy = monthly.reduce(function(s, m) {
    var t = m.occupiedArea + m.vacantArea;
    return s + (t > 0 ? (m.occupiedArea / t) * 100 : 0);
  }, 0) / 12;
  var avgVacantArea = monthly.reduce(function(s, m) { return s + m.vacantArea; }, 0) / 12;
  var avgRpsm = avgRentPerSqmPerMonth();
  var potentialIfVacantRented = avgVacantArea * avgRpsm * 12;

  // Contracts ending this year (for the alert section)
  var endingContracts = contracts.filter(contractMatchesFilter).filter(function(c) {
    if (!c.end_date) return false;
    var ce = new Date(c.end_date);
    return ce.getFullYear() === year && (c.status === "active" || c.status === "expiring" || c.status === "extended");
  }).sort(function(a, b) { return new Date(a.end_date).getTime() - new Date(b.end_date).getTime(); });

  // Year options
  var yearOptions: number[] = [];
  for (var y = currentYear + 1; y >= currentYear - 5; y--) yearOptions.push(y);

  // Bar chart scaling
  var maxVal = Math.max(...monthly.map(function(m) { return m.potRent + m.potMgmt + m.potOther; }), 1);
  if (compareYoY) {
    var maxPrev = Math.max(...monthlyPrev.map(function(m) { return m.potRent + m.potMgmt + m.potOther; }), 0);
    maxVal = Math.max(maxVal, maxPrev);
  }

  // CSV export — richer with new columns
  function exportCSV() {
    var bom = "﻿";
    var header = ["חודש", "חוזים פעילים", "תפוסה %", "שטח פנוי (מ\"ר)", "פוטנציאל שכ\"ד", "פוטנציאל מקדמת דמי ניהול", "פוטנציאל אחר", "סה\"כ פוטנציאל", "גבייה בפועל", "% גבייה"].join(",");
    var rows = monthly.map(function(m) {
      var pot = m.potRent + m.potMgmt + m.potOther;
      var paid = m.paidRent + m.paidMgmt + m.paidOther;
      var occ = (m.occupiedArea + m.vacantArea) > 0 ? (m.occupiedArea / (m.occupiedArea + m.vacantArea)) * 100 : 0;
      var pct = pot > 0 ? (paid / pot) * 100 : 0;
      return [
        MONTHS_HE[m.month] + " " + year,
        m.activeContracts,
        occ.toFixed(1) + "%",
        m.vacantArea.toFixed(0),
        Math.round(m.potRent),
        Math.round(m.potMgmt),
        Math.round(m.potOther),
        Math.round(pot),
        Math.round(paid),
        pct.toFixed(1) + "%",
      ].join(",");
    });
    var csv = bom + [header].concat(rows).join("\n");
    var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    var a = document.createElement("a"); a.href = url; a.download = "תזרים_" + year + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div dir="rtl">
      <PageHero title="תזרים שנתי" icon="💹" tone="emerald"
        subtitle={<>פוטנציאל שנתי: <strong>{fmtMoney(totalPotential)}</strong> | גבייה: <strong className="text-emerald-100">{fmtMoney(totalPaid)}</strong> | <span title="ביחס לחודשים שכבר חויבו (עד החודש הנוכחי)">גבייה לתאריך היום: <strong>{fmtPct(ytdPct)}</strong></span></>}
        actions={
          <div className="flex gap-2 items-center">
            <button onClick={function() { setYear(year - 1); }} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">←</button>
            <span className="text-lg font-bold w-16 text-center">{year}</span>
            <button onClick={function() { setYear(year + 1); }} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">→</button>
            <button onClick={exportCSV} className="rounded-xl bg-white text-emerald-700 px-4 py-2 text-sm font-bold hover:bg-emerald-50 shadow-sm">⬇ CSV</button>
          </div>
        } />

      {/* Filter bar */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2">
        <select value={propertyFilter} onChange={function(e) { setPropertyFilter(e.target.value); }} className={ic + " w-48"}>
          <option value="">🏢 נכס: הכל</option>
          {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
        </select>
        <input
          type="text"
          value={tenantSearch}
          onChange={function(e) { setTenantSearch(e.target.value); }}
          placeholder="🔍 חיפוש שוכר"
          className={ic + " flex-1 min-w-[180px]"}
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-600 px-2 py-1 cursor-pointer">
          <input type="checkbox" checked={compareYoY} onChange={function(e) { setCompareYoY(e.target.checked); }} className="w-3.5 h-3.5"/>
          השווה ל-{year - 1}
        </label>
        {(propertyFilter || tenantSearch) && (
          <button onClick={function() { setPropertyFilter(""); setTenantSearch(""); }} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 border border-slate-200 rounded">
            ✕ נקה
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <div className="text-xl font-black text-slate-800">{fmtMoney(totalPotential)}</div>
          <div className="text-xs text-slate-400 mt-0.5">הכנסה שנתית פוטנציאלית</div>
          {compareYoY && (
            <div className="text-[10px] mt-1 text-slate-500">
              {year - 1}: {fmtMoney(totalsPrev.pot)}{" "}
              {totalsPrev.pot > 0 && (
                <span className={totalPotential >= totalsPrev.pot ? "text-green-600" : "text-red-600"}>
                  ({totalPotential >= totalsPrev.pot ? "+" : ""}{fmtPct(((totalPotential - totalsPrev.pot) / totalsPrev.pot) * 100)})
                </span>
              )}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center shadow-sm">
          <div className="text-xl font-black text-green-700">{fmtMoney(totalPaid)}</div>
          <div className="text-xs text-green-700 mt-0.5">גבייה בפועל</div>
          {compareYoY && (
            <div className="text-[10px] mt-1 text-green-700">
              {year - 1}: {fmtMoney(totalsPrev.paid)}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <div className={"text-xl font-black " + (ytdPct >= 90 ? "text-green-700" : ytdPct >= 70 ? "text-yellow-600" : "text-red-600")} title="גבייה / פוטנציאל עד החודש הנוכחי בלבד — חודשים עתידיים לא נספרים כי החיוב טרם הופק">{fmtPct(ytdPct)}</div>
          <div className="text-xs text-slate-400 mt-0.5">% גבייה לתאריך היום</div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            (שנתי בכללות: {fmtPct(avgPct)} — כולל חודשים שטרם הופק)
          </div>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-center shadow-sm">
          <div className="text-xl font-black text-blue-700">{fmtPct(avgOccupancy)}</div>
          <div className="text-xs text-blue-700 mt-0.5">תפוסה ממוצעת</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center shadow-sm">
          <div className="text-xl font-black text-amber-700">{fmtMoney(potentialIfVacantRented)}</div>
          <div className="text-xs text-amber-700 mt-0.5">
            פוטנציאל אם יחידות ריקות יושכרו
            <div className="text-[9px] text-amber-600">({avgVacantArea.toFixed(0)} מ&quot;ר ריקים × ממוצע ₪{avgRpsm.toFixed(0)}/מ&quot;ר)</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : (
        <>
          {/* Stacked bar chart per month */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 mb-4">
            <div className="text-xs font-semibold text-slate-500 mb-4">הכנסה חודשית — מקורות מופרדים</div>
            <div className="flex items-end gap-1 h-48">
              {monthly.map(function(m, idx) {
                var totalPot = m.potRent + m.potMgmt + m.potOther;
                var hPot = maxVal > 0 ? (totalPot / maxVal) * 100 : 0;
                var rentPct = totalPot > 0 ? (m.potRent / totalPot) * 100 : 0;
                var mgmtPct = totalPot > 0 ? (m.potMgmt / totalPot) * 100 : 0;
                var otherPct = totalPot > 0 ? (m.potOther / totalPot) * 100 : 0;
                var paidTotal = m.paidRent + m.paidMgmt + m.paidOther;
                var hPaid = maxVal > 0 ? (paidTotal / maxVal) * 100 : 0;
                var prev = monthlyPrev[idx];
                var prevTotal = prev ? prev.potRent + prev.potMgmt + prev.potOther : 0;
                var hPrev = maxVal > 0 ? (prevTotal / maxVal) * 100 : 0;
                var isNow = m.month === new Date().getMonth() + 1 && year === currentYear;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-slate-800 text-white text-xs rounded-lg p-2 whitespace-nowrap text-right shadow-lg">
                      <div className="font-bold mb-0.5">{MONTHS_HE[m.month]} {year}</div>
                      <div>🏢 שכ&quot;ד: {fmtMoney(m.potRent)}</div>
                      <div>🔧 מקדמת דמי ניהול: {fmtMoney(m.potMgmt)}</div>
                      <div>📋 אחר: {fmtMoney(m.potOther)}</div>
                      <div className="border-t border-slate-600 mt-0.5 pt-0.5">סה&quot;כ פוטנציאל: {fmtMoney(totalPot)}</div>
                      <div className="text-green-300">💰 גבייה: {fmtMoney(paidTotal)} ({fmtPct(totalPot > 0 ? (paidTotal / totalPot) * 100 : 0)})</div>
                      <div className="text-blue-200">🏠 תפוסה: {fmtPct((m.occupiedArea + m.vacantArea) > 0 ? (m.occupiedArea / (m.occupiedArea + m.vacantArea)) * 100 : 0)}</div>
                      {compareYoY && prev && <div className="text-amber-200">📅 {year - 1}: {fmtMoney(prevTotal)}</div>}
                    </div>
                    {/* Bars */}
                    <div className="w-full flex items-end gap-0.5 h-40">
                      {compareYoY && (
                        <div className="flex-1 rounded-t bg-slate-300/60" style={{ height: hPrev + "%", minHeight: prevTotal > 0 ? "3px" : "0" }} />
                      )}
                      {/* Stacked potential */}
                      <div className="flex-1 relative" style={{ height: hPot + "%", minHeight: totalPot > 0 ? "3px" : "0" }}>
                        <div className="absolute inset-x-0 bottom-0 bg-blue-500" style={{ height: rentPct + "%" }} />
                        <div className="absolute inset-x-0 bg-purple-500" style={{ bottom: rentPct + "%", height: mgmtPct + "%" }} />
                        <div className="absolute inset-x-0 rounded-t bg-amber-500" style={{ bottom: (rentPct + mgmtPct) + "%", height: otherPct + "%" }} />
                      </div>
                      {/* Paid bar */}
                      <div className={"flex-1 rounded-t transition-all " + (isNow ? "bg-green-600" : "bg-green-400")}
                        style={{ height: hPaid + "%", minHeight: paidTotal > 0 ? "3px" : "0" }} />
                    </div>
                    <div className={"text-xs text-center truncate w-full " + (isNow ? "font-bold text-blue-700" : "text-slate-400")}>
                      {MONTHS_HE[m.month].substring(0, 3)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 mt-3 text-xs text-slate-500 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block" /> שכ&quot;ד</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-500 inline-block" /> מקדמת דמי ניהול</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500 inline-block" /> אחר (ביטוח/הפרשי/אשפה)</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> גבייה בפועל</span>
              {compareYoY && <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-300/80 inline-block" /> {year - 1}</span>}
            </div>
          </div>

          {/* Contracts ending alert */}
          {endingContracts.length > 0 && (
            <div className="mb-4 rounded-xl border-2 border-amber-200 bg-amber-50/60 p-3">
              <div className="font-bold text-amber-900 text-sm mb-1.5">⚠ {endingContracts.length} חוזים מסתיימים בשנה זו</div>
              <div className="text-xs text-amber-800 space-y-0.5 max-h-24 overflow-y-auto">
                {endingContracts.map(function(c, i) {
                  return (
                    <div key={i} className="flex justify-between">
                      <span>{(c.tenants as any)?.name || "—"} <span className="text-amber-600">({(c.properties as any)?.name})</span></span>
                      <span className="font-mono">{new Date(c.end_date).toLocaleDateString("he-IL")}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detailed monthly table — broken by income source */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-3 font-semibold text-slate-700">חודש</th>
                  <th className="px-3 py-3 font-semibold text-slate-700">חוזים פעילים</th>
                  <th className="px-3 py-3 font-semibold text-blue-700">תפוסה</th>
                  <th className="px-3 py-3 font-semibold text-blue-600">שכ&quot;ד</th>
                  <th className="px-3 py-3 font-semibold text-purple-600">מקדמת דמי ניהול</th>
                  <th className="px-3 py-3 font-semibold text-amber-600">אחר</th>
                  <th className="px-3 py-3 font-semibold text-slate-700">סה&quot;כ פוטנציאל</th>
                  <th className="px-3 py-3 font-semibold text-green-700">גבייה</th>
                  <th className="px-3 py-3 font-semibold text-slate-700">% גבייה</th>
                  <th className="px-3 py-3 font-semibold text-slate-500">אירועים</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map(function(m) {
                  var pot = m.potRent + m.potMgmt + m.potOther;
                  var paid = m.paidRent + m.paidMgmt + m.paidOther;
                  var pct = pot > 0 ? (paid / pot) * 100 : 0;
                  var occ = (m.occupiedArea + m.vacantArea) > 0 ? (m.occupiedArea / (m.occupiedArea + m.vacantArea)) * 100 : 0;
                  var isNow = m.month === new Date().getMonth() + 1 && year === currentYear;
                  return (
                    <tr key={m.month} className={"border-t border-slate-100 " + (isNow ? "bg-blue-50" : "hover:bg-slate-50")}>
                      <td className={"px-3 py-2.5 font-semibold whitespace-nowrap " + (isNow ? "text-blue-700" : "text-slate-800")}>
                        {MONTHS_HE[m.month]}
                        {isNow && <span className="mr-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">נוכחי</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 text-center">{m.activeContracts}</td>
                      <td className="px-3 py-2.5 text-blue-700 font-semibold">{fmtPct(occ)}</td>
                      <td className="px-3 py-2.5 text-blue-600 font-mono">{m.potRent > 0 ? fmtMoney(m.potRent) : "—"}</td>
                      <td className="px-3 py-2.5 text-purple-600 font-mono">{m.potMgmt > 0 ? fmtMoney(m.potMgmt) : "—"}</td>
                      <td className="px-3 py-2.5 text-amber-600 font-mono">{m.potOther > 0 ? fmtMoney(m.potOther) : "—"}</td>
                      <td className="px-3 py-2.5 text-slate-800 font-bold font-mono">{fmtMoney(pot)}</td>
                      <td className="px-3 py-2.5 text-green-700 font-semibold font-mono">{fmtMoney(paid)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-2 max-w-20">
                            <div className={"h-2 rounded-full " + (pct >= 90 ? "bg-green-500" : pct >= 70 ? "bg-yellow-400" : "bg-red-400")}
                              style={{ width: pct + "%" }} />
                          </div>
                          <span className={"font-bold text-xs " + (pct >= 90 ? "text-green-700" : pct >= 70 ? "text-yellow-700" : "text-red-600")}>
                            {fmtPct(pct)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-slate-500">
                        {m.contractsStarting.length > 0 && (
                          <div className="text-green-700">
                            ➕ {m.contractsStarting.length} {m.contractsStarting.length === 1 ? "חוזה חדש" : "חוזים חדשים"}
                          </div>
                        )}
                        {m.contractsEnding.length > 0 && (
                          <div className="text-amber-700">
                            ➖ {m.contractsEnding.length} {m.contractsEnding.length === 1 ? "חוזה מסתיים" : "חוזים מסתיימים"}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                <tr>
                  <td className="px-3 py-3 text-slate-700">סה&quot;כ {year}</td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 text-blue-700 font-semibold">{fmtPct(avgOccupancy)}</td>
                  <td className="px-3 py-3 text-blue-600 font-mono">{fmtMoney(totals.potRent)}</td>
                  <td className="px-3 py-3 text-purple-600 font-mono">{fmtMoney(totals.potMgmt)}</td>
                  <td className="px-3 py-3 text-amber-600 font-mono">{fmtMoney(totals.potOther)}</td>
                  <td className="px-3 py-3 text-slate-800 font-mono">{fmtMoney(totalPotential)}</td>
                  <td className="px-3 py-3 text-green-700 font-mono">{fmtMoney(totalPaid)}</td>
                  <td className="px-3 py-3"><span className={avgPct >= 90 ? "text-green-700" : avgPct >= 70 ? "text-yellow-700" : "text-red-600"}>{fmtPct(avgPct)}</span></td>
                  <td className="px-3 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
