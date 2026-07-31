"use client";
import { useState, useEffect, useRef } from "react";
import { revenuePctAtDate, pctTiersFromRow, describePctTiers } from "@/lib/revenue-pct-steps";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import { getVatRates, vatPctAt, type VatRate } from '@/lib/vat';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';
import { minRentForPeriod } from '@/lib/min-rent';
import { revenueCategoriesFromRow, splitRevenue, hasCategories, describeCategories } from '@/lib/revenue-categories';
import { periodsForYear, computeSettlement, FREQ_LABELS, type SettlementFreq, type SettlementCalc, type SettlementPeriod } from '@/lib/revenue-settlement';
import { revenueProtectionFromRow, hasRevenueProtection, isPeriodProtected, describeRevenueProtection } from '@/lib/revenue-protection';
import { fetchCpiAdjustedWithRetry } from '@/lib/cpi-server';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
function fmtMoney(n: number) { return (n && Math.abs(n) > 0.001) ? "₪"+n.toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtNum(n: number, dec=2) { return (n && Math.abs(n) > 0.001) ? n.toLocaleString("he-IL",{minimumFractionDigits:dec,maximumFractionDigits:dec}) : "—"; }

// Bucket created via migration add_attachment_to_revenue_reports.
// Public so the link in the row works directly without signing.
const REVENUE_BUCKET = "revenue_attachments";

const HEB_MONTHS = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

// CBS calculator wants MM-DD-YYYY; day 15 is the publication day, bumped to 16
// so the "known index" resolves the same way it does across the app.
function toCbsDate(dateStr: string): string | null {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  if (d.getDate() === 15) d.setDate(16);
  return String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + "-" + d.getFullYear();
}

function monthKey(year: number, m: number): string {
  return year + "-" + String(m).padStart(2, "0") + "-01";
}

export default function RevenuePage() {
  const currentYear = new Date().getFullYear();
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [reports,    setReports]    = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [saving,     setSaving]     = useState(false);
  // VAT-rate history — a revenue report is grossed-up at the rate in effect for
  // its month, so a back-dated report uses the historically-correct rate.
  const [vatRates,   setVatRates]   = useState<VatRate[]>([]);
  useEffect(function(){ getVatRates().then(setVatRates); }, []);

  // Primary filters: tenant (contract) + year — drives a 12-month breakdown table.
  const [selContractId, setSelContractId] = useState<string>("");
  const [selYear,       setSelYear]       = useState<number>(currentYear);

  // Modal state
  const [fContractId,  setFContractId]  = useState("");
  const [fMonth,       setFMonth]       = useState<string>(""); // YYYY-MM
  const [fGrossRevenue,setFGrossRevenue]=useState("");
  // Per-category turnover for contracts that price delivery (or anything else)
  // at its own percentage. Empty for a single-percentage contract.
  const [fByCategory, setFByCategory] = useState<Record<string,string>>({});
  const [fMgmtInGross, setFMgmtInGross] = useState<string>(""); // manual override
  const [fNotes,       setFNotes]       =useState("");
  const [fFile,        setFFile]        = useState<File|null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks per-row "attaching" state (the small 📎 button on each existing report)
  const [rowAttaching, setRowAttaching] = useState<string>("");

  // Area timeline for the selected contract — base + amendments collapsed into
  // chronological [startDate..endDate, area, spaceName, spaceId] segments. Drives
  // the mixed-month splitting (e.g. March 2026 = 1-12 at 365m² + 13-31 at 110m²)
  // AND the per-space mgmt rate lookup (billing_groups.rate_per_sqm_monthly).
  type AreaSegment = { startDate: Date; endDate: Date | null; area: number; spaceName: string; spaceId: string; };
  const [areaSegments, setAreaSegments] = useState<AreaSegment[]>([]);
  // space_id → mgmt rate per sqm per month, for the selected year (from billing_groups
  // where group_type='management' + year = selYear). Empty if no group is set up.
  const [mgmtRateBySpaceId, setMgmtRateBySpaceId] = useState<Record<string, number>>({});
  // Per-month actuals from billing_reconciliations (when finalized).
  // Key = "YYYY-MM". Value = the actual mgmt amount for that month.
  // Empty until the reconciliation flow starts writing to this table.
  const [mgmtActualByMonth, setMgmtActualByMonth] = useState<Record<string, number>>({});
  // Rent steps + CPI ratios drive the MINIMUM rent: the floor is not frozen at
  // the signed figure — it rises with the contract's steps and stays linked to
  // the ORIGINAL base index.
  const [minTiers, setMinTiers] = useState<any[]>([]);
  const [minCpiByMonth, setMinCpiByMonth] = useState<Record<string, number>>({});
  // Periodic settlement (quarterly / half-yearly / yearly): each period restates
  // both sides to the index known on its settlement date and bills the gap.
  const [settlements, setSettlements] = useState<Array<{ period: SettlementPeriod; calc: SettlementCalc }>>([]);
  const [settling, setSettling] = useState<string>("");
  // The contract fixes the settlement cadence, but the user may want to LOOK at
  // the same period at a different one. "" = follow the contract.
  const [settleViewFreq, setSettleViewFreq] = useState<string>("");

  // Uploads a file to the revenue_attachments bucket and returns the metadata
  // that should be written onto the revenue_reports row. Throws on failure.
  async function uploadAttachment(file: File): Promise<{ url: string; path: string; name: string; size: number; type: string; }> {
    var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    var path = "revenue/" + Date.now() + "_" + safeName;
    var upRes = await supabase.storage.from(REVENUE_BUCKET).upload(path, file, { upsert: false });
    if (upRes.error) throw upRes.error;
    var urlRes = supabase.storage.from(REVENUE_BUCKET).getPublicUrl(path);
    return {
      url: urlRes.data.publicUrl,
      path: path,
      name: file.name,
      size: file.size,
      type: file.type || "",
    };
  }

  // Attaches a file to an existing row (the 📎 / 🔄 buttons in the table).
  async function attachToRow(rowId: string, file: File) {
    setRowAttaching(rowId);
    try {
      var existing = reports.find(function(r) { return r.id === rowId; });
      if (existing?.attachment_path) {
        await supabase.storage.from(REVENUE_BUCKET).remove([existing.attachment_path]);
      }
      var meta = await uploadAttachment(file);
      var { error } = await supabase.from("revenue_reports").update({
        attachment_url: meta.url, attachment_path: meta.path,
        attachment_name: meta.name, attachment_size: meta.size, attachment_type: meta.type,
      }).eq("id", rowId);
      if (error) throw error;
      await logAudit({ entity_type: "revenue", entity_id: rowId, action: existing?.attachment_url ? "replace_attachment" : "add_attachment" });
      await loadAll();
    } catch (e: any) { alert("שגיאה בהעלאה: " + (e?.message || e)); }
    finally { setRowAttaching(""); }
  }

  async function removeAttachment(row: any) {
    if (!row.attachment_url) return;
    if (!confirm("למחוק את הקובץ המצורף?")) return;
    try {
      if (row.attachment_path) {
        await supabase.storage.from(REVENUE_BUCKET).remove([row.attachment_path]);
      }
      await supabase.from("revenue_reports").update({
        attachment_url: null, attachment_path: null, attachment_name: null, attachment_size: null, attachment_type: null,
      }).eq("id", row.id);
      await logAudit({ entity_type: "revenue", entity_id: row.id, action: "remove_attachment" });
      await loadAll();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
  }

  async function deleteRow(row: any) {
    if (!confirm("למחוק את הדיווח של " + HEB_MONTHS[new Date(row.report_month).getMonth()+1] + " " + new Date(row.report_month).getFullYear() + "?")) return;
    try {
      if (row.attachment_path) {
        await supabase.storage.from(REVENUE_BUCKET).remove([row.attachment_path]);
      }
      await supabase.from("revenue_reports").delete().eq("id", row.id);
      await logAudit({ entity_type: "revenue", entity_id: row.id, action: "delete" });
      await loadAll();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
  }

  useEffect(function() { setFByCategory({}); }, [fContractId]);

  // Build this year's settlements for the selected contract. One CBS ratio per
  // month (month → settlement date); when the contract says a late report is
  // settled at the higher index, the ratio to TODAY is taken as well and the
  // larger of the two is used, exactly as the clause reads.
  useEffect(function() {
    var cancelled = false;
    (async function() {
      var c: any = contracts.find(function(x: any) { return x.id === selContractId; });
      var freq = (settleViewFreq || c?.revenue_settlement_freq || "monthly") as SettlementFreq;
      if (!c) { setSettlements([]); return; }
      // A settlement only exists where the tenant pays the minimum separately and
      // the top-up is collected afterwards. With no minimum (or one that is not
      // paid in advance) the report already bills the whole rent, so "the gap
      // between the minimum paid and the turnover share" would be the entire
      // rent — presenting that as an amount to bill invites double-billing.
      // Either arrangement can need a settlement: a minimum paid in advance
      // (collect the top-up) or a protected tenant (refund the shortfall).
      if (!c.revenue_minimum_advance && !hasRevenueProtection(revenueProtectionFromRow(c))) { setSettlements([]); return; }

      var periods = periodsForYear(selYear, freq, Number(c.revenue_settlement_day) || 15);
      var vatPct = c.vat_type === "taxable" ? vatPctAt(vatRates, new Date()) : 0;
      var out: Array<{ period: SettlementPeriod; calc: SettlementCalc }> = [];

      for (var pi = 0; pi < periods.length; pi++) {
        var period = periods[pi];
        var periodReports = reports.filter(function(r: any) {
          return r.contract_id === selContractId && String(r.report_month).slice(0, 7) >= period.periodStart.slice(0, 7)
            && String(r.report_month).slice(0, 7) <= period.periodEnd.slice(0, 7);
        });
        if (periodReports.length === 0) continue;   // nothing to settle yet

        var ratios: Record<string, number> = {};
        if (c.indexation_method !== "none") {
          var toDates = [period.settlementDate];
          if (c.revenue_late_report_higher_index && new Date() > new Date(period.settlementDate)) {
            toDates.push(new Date().toISOString().slice(0, 10));
          }
          for (var mi = 0; mi < period.months.length; mi++) {
            var key = period.year + "-" + String(period.months[mi]).padStart(2, "0") + "-01";
            var fromCbs = toCbsDate(key);
            if (!fromCbs) continue;
            var best = 0;
            for (var ti = 0; ti < toDates.length; ti++) {
              var toCbs = toCbsDate(toDates[ti]);
              if (!toCbs) continue;
              var res: any = await fetchCpiAdjustedWithRetry({ value: 10000, fromDate: fromCbs, toDate: toCbs });
              if (cancelled) return;
              if (res?.success) {
                var r = Number(res.adjustedRentPerSqm) / 10000;
                if (r > best) best = r;   // "the higher of the two indices"
              }
            }
            if (best > 0) ratios[key] = best;
          }
        }
        var prot = revenueProtectionFromRow(c);
        var periodProtected = isPeriodProtected({
          contract: c, protection: prot, options: c.contract_options || [], periodEnd: period.periodEnd,
        });
        out.push({ period: period, calc: computeSettlement({
          period: period, reports: periodReports, ratios: ratios, vatPct: vatPct,
          allowNegative: periodProtected,
          // The minimum is what the advances already covered; the settlement
          // collects the gap up to the turnover share.
          baseOf: function(rep: any) { return Number(rep?.min_rent) || 0; },
          // Same figure the monthly calc compares to the minimum: the share net
          // of management fees when those come out of the percentage.
          altOf: function(rep: any) {
            var share = Number(rep?.calculated_rent) || 0;
            var mgmt = rep?.mgmt_in_gross != null ? Number(rep.mgmt_in_gross)
              : (c.mgmt_included_in_revenue && c.mgmt_fee_per_sqm ? Number(c.mgmt_fee_per_sqm) * (Number(c.charged_area) || 0) : 0);
            return Math.max(0, Math.round((share - (mgmt || 0)) * 100) / 100);
          },
        }) });
      }
      if (!cancelled) setSettlements(out);
    })();
    return function() { cancelled = true; };
  }, [selContractId, selYear, contracts.length, reports.length, vatRates.length, settleViewFreq]);

  useEffect(function() { loadAll(); }, [selYear]);

  // Reload the area timeline + mgmt rates when the user picks a different tenant
  // or year.
  useEffect(function() { loadAreaSegments(selContractId); }, [selContractId, selYear]);

  // Load the selected contract's rent steps, then resolve one CPI ratio per
  // month of the selected year (base index → that month). Ratios come from the
  // CBS calculator, which handles base-year rebasing — a raw index/index ratio
  // would be wrong across a base change. A month whose index isn't published
  // yet is simply left out, and the floor for it is shown un-linked rather than
  // silently under-stated.
  useEffect(function() {
    var cancelled = false;
    (async function() {
      if (!selContractId) { setMinTiers([]); setMinCpiByMonth({}); return; }
      var { data: tiers } = await supabase.from("contract_price_tiers")
        .select("increase_type,increase_value,from_year,to_year,is_recurring,recurring_every_years")
        .eq("contract_id", selContractId).order("from_year");
      if (cancelled) return;
      setMinTiers(tiers ?? []);

      var c: any = contracts.find(function(x: any) { return x.id === selContractId; });
      if (!c || c.indexation_method === "none" || !c.index_base_date) { setMinCpiByMonth({}); return; }
      var fromCbs = toCbsDate(c.index_base_date);
      if (!fromCbs) { setMinCpiByMonth({}); return; }

      var map: Record<string, number> = {};
      for (var m = 1; m <= 12; m++) {
        var key = monthKey(selYear, m);
        var toCbs = toCbsDate(key);
        if (!toCbs) continue;
        if (new Date(key) > new Date()) continue;   // future month — nothing to link to
        var res: any = await fetchCpiAdjustedWithRetry({ value: 10000, fromDate: fromCbs, toDate: toCbs });
        if (cancelled) return;
        if (res?.success) {
          var ratio = Number(res.adjustedRentPerSqm) / 10000;
          if (ratio > 0) map[key] = ratio;
        }
      }
      if (!cancelled) setMinCpiByMonth(map);
    })();
    return function() { cancelled = true; };
  }, [selContractId, selYear, contracts.length]);

  // Build the chronological area timeline from the base contract + amendments,
  // then pull the per-space mgmt rate from billing_groups for the selected year
  // and the per-month actuals from billing_reconciliations (when present).
  async function loadAreaSegments(contractId: string) {
    if (!contractId) {
      setAreaSegments([]); setMgmtRateBySpaceId({}); setMgmtActualByMonth({});
      return;
    }
    const [baseRes, amendsRes] = await Promise.all([
      supabase.from("contracts")
        .select("id, property_id, start_date, charged_area, contract_spaces(space_id, spaces(space_name,area))")
        .eq("id", contractId).single(),
      supabase.from("contracts")
        .select("id, amendment_date, start_date, charged_area, contract_spaces(space_id, spaces(space_name,area))")
        .eq("parent_contract_id", contractId)
        .eq("is_amendment", true)
        .order("amendment_date", { ascending: true }),
    ]);
    var base: any = baseRes.data;
    var amends: any[] = amendsRes.data || [];
    if (!base) {
      setAreaSegments([]); setMgmtRateBySpaceId({}); setMgmtActualByMonth({});
      return;
    }

    function spaceNameOf(row: any): string {
      var cs = row?.contract_spaces;
      if (!cs || cs.length === 0) return "";
      var names = cs.map(function(x: any) { return x?.spaces?.space_name; }).filter(Boolean);
      return names.join(", ");
    }
    function firstSpaceId(row: any): string {
      var cs = row?.contract_spaces;
      return (cs && cs.length > 0 && cs[0]?.space_id) || "";
    }

    var segments: AreaSegment[] = [];
    var currentArea = Number(base.charged_area) || 0;
    var currentName = spaceNameOf(base);
    var currentSpaceId = firstSpaceId(base);
    var currentStart = base.start_date ? new Date(base.start_date) : new Date(selYear, 0, 1);

    amends.forEach(function(am: any) {
      var amDate = new Date(am.amendment_date || am.start_date);
      var prevEnd = new Date(amDate);
      prevEnd.setDate(prevEnd.getDate() - 1);
      segments.push({ startDate: currentStart, endDate: prevEnd, area: currentArea, spaceName: currentName, spaceId: currentSpaceId });
      currentArea = Number(am.charged_area) || currentArea;
      currentName = spaceNameOf(am) || currentName;
      currentSpaceId = firstSpaceId(am) || currentSpaceId;
      currentStart = amDate;
    });
    segments.push({ startDate: currentStart, endDate: null, area: currentArea, spaceName: currentName, spaceId: currentSpaceId });
    setAreaSegments(segments);

    // ─── Mgmt advance: pull billing_groups for property+year, group_type=management ───
    // Same pattern as components/AdvancesTab.tsx. rate_per_sqm_monthly is the
    // forecast/advance rate; the per-space mapping comes from billing_group_spaces.
    var propertyId = base.property_id;
    if (propertyId) {
      var { data: mgmtGroups } = await supabase.from("billing_groups")
        .select("id, rate_per_sqm_monthly, annual_amount, billing_group_spaces(space_id)")
        .eq("property_id", propertyId)
        .eq("group_type", "management")
        .eq("year", selYear);
      var rateBySpace: Record<string, number> = {};
      (mgmtGroups || []).forEach(function(g: any) {
        var rate = Number(g.rate_per_sqm_monthly) || 0;
        (g.billing_group_spaces || []).forEach(function(bgs: any) {
          if (bgs.space_id) rateBySpace[bgs.space_id] = rate;
        });
      });
      setMgmtRateBySpaceId(rateBySpace);
    } else {
      setMgmtRateBySpaceId({});
    }

    // ─── Mgmt actual: pull billing_reconciliations for the contract+year ───
    // billing_type='management', period text holds "YYYY-MM" (convention; the
    // table is empty in production today). actual_share, when present, takes
    // priority over the advance rate.
    var contractIds = [contractId].concat(amends.map(function(a: any) { return a.id; }));
    var { data: recons } = await supabase.from("billing_reconciliations")
      .select("contract_id, year, period, billing_type, actual_share, advance_amount")
      .in("contract_id", contractIds)
      .eq("year", selYear)
      .eq("billing_type", "management");
    var actuals: Record<string, number> = {};
    (recons || []).forEach(function(r: any) {
      var actual = Number(r.actual_share);
      if (actual > 0 && r.period) actuals[r.period] = actual;
    });
    setMgmtActualByMonth(actuals);
  }

  async function loadAll() {
    // Load all year's reports for ALL contracts so switching the tenant filter is instant.
    // The 12-month table reads from this in-memory set, filtered by selContractId.
    var yearStart = selYear + "-01-01";
    var yearEnd   = (selYear + 1) + "-01-01"; // exclusive — avoids the Feb-31 bug entirely
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("contracts").select("id,property_id,status,rent_type,revenue_pct,revenue_pct_tiers,min_rent_per_sqm,charged_area,rent_per_sqm,investment_addition,vat_type,mgmt_fee_per_sqm,mgmt_included_in_revenue,start_date,indexation_method,index_base_date,index_base_value,revenue_categories,revenue_minimum_advance,minimum_rent,revenue_protection_type,revenue_protection_months,revenue_protection_notes,contract_options(id,start_date,status,is_exercised,cancels_revenue_protection),tenants(name),properties(name)").in("status",["active","expiring","extended"]),
      supabase.from("revenue_reports").select("*,contracts(property_id,tenants(name),properties(name))").gte("report_month",yearStart).lt("report_month",yearEnd).order("report_month",{ascending:true}),
    ]);
    var scope = await getScopeIds();
    var scopedC = scopeRows(c??[], scope, function(x: any){ return x.property_id; });
    var revenueContracts = scopedC.filter(function(x){return x.rent_type==="revenue_based"||x.revenue_pct;});
    setContracts(revenueContracts);
    setReports(scopeRows(r??[], scope, function(x: any){ return x.contracts?.property_id; }));
    // Default-select the first revenue contract on first load
    if (!selContractId && revenueContracts.length > 0) setSelContractId(revenueContracts[0].id);
    setLoading(false);
  }

  // Pure calc: given a contract + raw gross revenue (+ optional manual mgmt),
  // returns the full breakdown. The financial model (per the contract terms
  // for revenue-pct tenants where mgmt is included in the revenue):
  //
  //   1. Tenant reports their gross revenue (includes the rent + mgmt portion)
  //   2. Property is owed: consideration = pct% × gross  (= "תמורה בגין פדיון")
  //   3. From that consideration, mgmt fee is taken out:
  //        rent_from_revenue = consideration − mgmt   (= "שכ"ד מפדיון")
  //   4. For reporting purposes, the "net revenue" (revenue that's pure rent
  //      basis, i.e. before mgmt) = gross − mgmt/pct  — this is the figure
  //      that would yield rent_from_revenue if you applied pct% to it.
  //
  // Mgmt sources (priority): manual override → contract per-sqm × area → 0.
  function calcRent(contractId: string, grossRevenue: number, manualMgmt?: number, periodDate?: string, byCategory?: Record<string, any> | null) {
    const c = contracts.find(function(x){return x.id===contractId;});
    if (!c) return null;
    // The percentage can step up over the years ("3.5% until year 3, 4% after"),
    // so it is resolved for the month being reported — not read off the contract
    // header. With no steps this returns the single agreed percentage.
    const pct = revenuePctAtDate({
      basePct: Number(c.revenue_pct) || 0,
      tiers: pctTiersFromRow(c),
      contractStart: c.start_date || periodDate || new Date(),
      date: periodDate || new Date(),
    });
    // Effective area for the reported month — walk the base+amendment area
    // timeline so a mid-contract store/size change (e.g. golf 365→110) uses the
    // RIGHT sqm, matching the table. Falls back to the contract's charged_area.
    var area = Number(c.charged_area) || 0;
    if (periodDate && areaSegments.length > 0) {
      var pd = new Date(periodDate);
      for (var si = 0; si < areaSegments.length; si++) {
        var sg = areaSegments[si];
        if (pd >= sg.startDate && (sg.endDate === null || pd <= sg.endDate)) { area = sg.area; break; }
      }
    }
    var mgmtMonthly: number;
    if (manualMgmt != null && manualMgmt > 0) {
      mgmtMonthly = manualMgmt;
    } else if (c.mgmt_included_in_revenue && c.mgmt_fee_per_sqm && area) {
      mgmtMonthly = Number(c.mgmt_fee_per_sqm) * area;
    } else {
      mgmtMonthly = 0;
    }
    // Categories priced separately (delivery at a lower rate, etc.): the
    // consideration is the sum of each category at ITS rate, and only that
    // total is measured against the minimum.
    const cats = revenueCategoriesFromRow(c);
    const split = splitRevenue({
      categories: cats,
      byCategory: byCategory,
      fallbackGross: grossRevenue,
      fallbackPct: pct,
    });
    const consideration = split.consideration;                            // תמורה בגין פדיון
    const effPct        = split.effectivePct || pct;
    const netGross      = effPct > 0 ? Math.max(split.gross - mgmtMonthly / (effPct/100), 0)
                                     : split.gross;                        // מחזור נטו (information)
    const rentFromRev   = consideration - mgmtMonthly;                    // שכ"ד מפדיון (before min)
    // Floor = the minimum after the contract's rent steps, linked to the
    // ORIGINAL base index — not the figure signed years ago.
    const minCalc       = minRentForPeriod({
      baseMinPerSqm: Number(c.min_rent_per_sqm) || 0,
      tiers: minTiers,
      contractStart: c.start_date || periodDate || new Date(),
      date: periodDate || new Date(),
      area: area,
      investmentAddition: Number(c.investment_addition) || 0,
      cpiRatio: periodDate ? minCpiByMonth[String(periodDate).slice(0, 8) + "01"] : null,
    });
    // Contracts whose minimum was entered as a monthly SUM (min_rent_per_sqm
    // empty) still have a floor — take the larger of the two readings so
    // neither way of entering it is silently ignored.
    const minMonthly    = Number(c.minimum_rent) || 0;
    const minRent       = Math.max(minCalc.amount, minMonthly);
    const finalRent     = Math.max(rentFromRev, minRent);
    const vat           = c.vat_type==="taxable" ? finalRent*vatPctAt(vatRates, periodDate || new Date()) : 0;
    return {
      pct, effPct, split, mgmtMonthly, netGross,
      consideration,                  // 12% × gross
      calcRent: consideration,        // alias used elsewhere
      rentFromRev,                    // consideration − mgmt (before min)
      minRent, minCalc, finalRent, vat,
      total: finalRent + vat,
      area: area,
    };
  }

  // With categories the total is the sum of the per-category inputs, so the
  // single "gross" box is not what drives the calculation.
  const fCats = revenueCategoriesFromRow(contracts.find(function(x:any){ return x.id === fContractId; }));
  const fCatsTotal = fCats.reduce(function(sum, c) { return sum + (Number(fByCategory[c.key]) || 0); }, 0);
  const fEffectiveGross = hasCategories(fCats) ? fCatsTotal : Number(fGrossRevenue);
  const previewCalc = fContractId && fEffectiveGross > 0
    ? calcRent(fContractId, fEffectiveGross, fMgmtInGross ? Number(fMgmtInGross) : undefined, fMonth ? fMonth + "-01" : undefined, fByCategory)
    : null;

  // Raise the period's difference as a charge. The settlement date is the tax
  // point, and the annex gives the tenant 7 days from the demand.
  async function createSettlementCharge(period: SettlementPeriod, calc: SettlementCalc) {
    if (!selContractId || Math.abs(calc.difference) < 0.01) return;
    // A negative gap only happens under a rent protection, and it is a refund:
    // the row is written as a credit so it reads as money going back, not owed.
    var isCredit = calc.difference < 0;
    if (calc.missingMonths.length > 0 &&
        !confirm("חסרים דיווחי פדיון ל-" + calc.missingMonths.length + " חודשים בתקופה. ליצור חיוב חלקי בכל זאת?")) return;
    if (calc.unindexed &&
        !confirm("חלק מהחודשים לא שוערכו כי המדד טרם פורסם, והם חושבו ללא הצמדה. להמשיך?")) return;
    setSettling(period.key);
    try {
      var { data, error } = await supabase.from("charges").insert({
        contract_id: selContractId,
        charge_type: "revenue_settlement",
        description: (isCredit ? "זיכוי הגנת שכ\"ד — " : "התחשבנות פדיון — ") + period.label,
        base_amount: calc.difference,
        vat_amount: calc.vatAmount,
        total_amount: calc.total,
        vat_type: calc.vatPct > 0 ? "taxable" : "exempt",
        billing_period_start: period.periodStart,
        billing_period_end: period.periodEnd,
        due_date: calc.dueDate,
        status: "pending",
        notes: "מינימום משוערך " + calc.totalBase + " · פדיון משוערך " + calc.totalAlt
          + " · שוערך למדד הידוע ביום " + period.settlementDate
          + (isCredit ? " · הפדיון נפל מהמינימום וההגנה בתוקף — מוחזר לשוכר" : ""),
      }).select("id").single();
      if (error) throw error;
      await logAudit({ entity_type: "charge", entity_id: data.id, action: "revenue_settlement", notes: period.label + " " + calc.total });
      alert(isCredit
        ? "✅ נוצר זיכוי לשוכר על סך " + fmtMoney(Math.abs(calc.total)) + " (הגנת שכ\"ד).\nניתן לטפל בו ממסך החיובים."
        : "✅ נוצר חיוב הפרש על סך " + fmtMoney(calc.total) + " לתשלום עד " + fmtDate(calc.dueDate) + ".\nניתן לשלוח אותו לשוכר ממסך החיובים.");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setSettling(""); }
  }

  async function handleSave() {
    if (!fContractId || !fMonth || !(fEffectiveGross > 0)) {
      alert(hasCategories(fCats) ? "חובה: חוזה + חודש + פדיון לפחות בסוג אחד" : "חובה: חוזה + חודש + הכנסה ברוטו");
      return;
    }
    var manualMgmt = fMgmtInGross ? Number(fMgmtInGross) : undefined;
    const calc = calcRent(fContractId, fEffectiveGross, manualMgmt, fMonth ? fMonth + "-01" : undefined, fByCategory);
    if (!calc) return;
    setSaving(true);
    try {
      // Upload first — if upload fails, fail the whole save so we don't write
      // a row that "claims" an attachment that never landed in storage.
      var attachmentMeta: any = null;
      if (fFile) attachmentMeta = await uploadAttachment(fFile);

      const { data } = await supabase.from("revenue_reports").insert({
        contract_id: fContractId, report_month: fMonth + "-01",
        gross_revenue: fEffectiveGross, revenue_pct: calc.effPct || calc.pct,
        revenue_by_category: hasCategories(fCats) ? fByCategory : null,
        calculated_rent: calc.calcRent, min_rent: calc.minRent,
        final_rent: calc.finalRent, notes: fNotes || null,
        mgmt_in_gross: manualMgmt ?? null,
        attachment_url:  attachmentMeta?.url  ?? null,
        attachment_path: attachmentMeta?.path ?? null,
        attachment_name: attachmentMeta?.name ?? null,
        attachment_size: attachmentMeta?.size ?? null,
        attachment_type: attachmentMeta?.type ?? null,
      }).select().single();
      await logAudit({entity_type:"revenue",entity_id:data.id,action:"create"});
      closeModal();
      await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  function openNewFor(contractId: string, monthYM: string) {
    setEditingId("new");
    setFContractId(contractId);
    setFMonth(monthYM);
    setFGrossRevenue("");
    setFMgmtInGross("");
    setFNotes("");
    setFFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeModal() {
    setEditingId(""); setFContractId(""); setFMonth(""); setFGrossRevenue(""); setFMgmtInGross(""); setFNotes(""); setFFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ─── Build the 12-month table for the selected tenant ───
  const selContract = contracts.find(function(c){return c.id===selContractId;});
  const tenantReports = reports.filter(function(r){return r.contract_id===selContractId;});
  const fallbackArea = Number(selContract?.charged_area) || 0;
  const pctLabel = selContract?.revenue_pct ?? 0;
  const mgmtIncluded = !!selContract?.mgmt_included_in_revenue;
  const contractFeePerSqm = Number(selContract?.mgmt_fee_per_sqm) || 0;

  // Map month → report
  const reportByMonth: Record<number, any> = {};
  tenantReports.forEach(function(r) {
    var m = new Date(r.report_month).getMonth() + 1;
    reportByMonth[m] = r;
  });

  // Resolves the area segment(s) that overlap a given month. Each returned
  // "part" is a contiguous day range within the month at a single space —
  // (startDay, endDay, area, spaceName, spaceId, mgmtRate). For a non-mixed
  // month this is one part covering all days; for March 2026 it's two parts
  // (1-12, 13-31) so we can charge the right mgmt rate per unit.
  type MonthPart = { startDay: number; endDay: number; area: number; spaceName: string; spaceId: string; mgmtRate: number; };
  function partsForMonth(m: number): MonthPart[] {
    var monthStart = new Date(selYear, m - 1, 1);
    var monthEnd = new Date(selYear, m, 0); // last day
    var daysInMonth = monthEnd.getDate();
    if (areaSegments.length === 0) {
      // Segments not loaded yet — fall back to contract-level area.
      return [{ startDay: 1, endDay: daysInMonth, area: fallbackArea, spaceName: "", spaceId: "", mgmtRate: 0 }];
    }
    var overlapping = areaSegments.filter(function(s) {
      if (s.startDate > monthEnd) return false;
      if (s.endDate !== null && s.endDate < monthStart) return false;
      return true;
    });
    if (overlapping.length === 0) return [];
    return overlapping.map(function(s) {
      var effStart = s.startDate > monthStart ? s.startDate : monthStart;
      var effEnd = (s.endDate === null || s.endDate > monthEnd) ? monthEnd : s.endDate;
      return {
        startDay: effStart.getDate(), endDay: effEnd.getDate(),
        area: s.area, spaceName: s.spaceName, spaceId: s.spaceId,
        mgmtRate: mgmtRateBySpaceId[s.spaceId] || 0,
      };
    }).sort(function(a, b) { return a.startDay - b.startDay; });
  }

  // Each visual table row is potentially one of multiple sub-rows of a month.
  // Mixed months produce 2+ sub-rows; "actions" controls (attach/delete/+) appear
  // only on the first sub-row (`isFirstSubOfMonth`) because they refer to the
  // single underlying report row.
  type MgmtSource = "actual" | "manual" | "billing_group" | "contract_per_sqm" | "none";
  type MonthSubRow = {
    m: number;
    subIdx: number;
    isFirstSubOfMonth: boolean;
    label: string;
    spaceName: string;
    daysInPart: number;
    daysInMonth: number;
    fraction: number;
    area: number;
    report?: any;
    gross: number;
    mgmtDeduct: number;
    mgmtSource: MgmtSource;
    net: number;
    calcRent: number;
    finalRent: number;
    rentPerSqm: number;
    cumAvgRentPerSqm: number;
  };

  var rows: MonthSubRow[] = [];
  var sumFinal = 0;
  var sumSqmMonths = 0; // running denominator for cumulative avg rent/sqm

  // Whether to show the mgmt column at all — true when the contract flag is set,
  // OR any report has a manual mgmt_in_gross, OR billing_groups defined a rate
  // for one of the contract's spaces.
  var hasAnyMgmt = mgmtIncluded
    || tenantReports.some(function(r) { return r.mgmt_in_gross != null && Number(r.mgmt_in_gross) > 0; })
    || Object.keys(mgmtRateBySpaceId).length > 0;

  for (var mIdx = 1; mIdx <= 12; mIdx++) {
    var parts = partsForMonth(mIdx);
    if (parts.length === 0) continue; // shouldn't happen
    var monthEnd = new Date(selYear, mIdx, 0);
    var daysInMonth = monthEnd.getDate();
    var isMixed = parts.length > 1;
    var rep = reportByMonth[mIdx];

    // Compute the WHOLE-MONTH amounts first, then distribute proportionally.
    var monthGross = rep ? Number(rep.gross_revenue) || 0 : 0;
    var monthFinal = rep ? Number(rep.final_rent) || 0 : 0;

    // Resolve mgmt for THIS month from the priority chain:
    //   1. actual reconciliation for this month
    //   2. manual override entered on the report
    //   3. per-space advance rate from billing_groups (× area × days fraction)
    //   4. contract-level mgmt_fee_per_sqm
    //   5. zero
    var monthMgmt = 0;
    var monthMgmtSource: MgmtSource = "none";
    var monthKeyStr = selYear + "-" + String(mIdx).padStart(2, "0");
    if (mgmtActualByMonth[monthKeyStr] != null && Number(mgmtActualByMonth[monthKeyStr]) > 0) {
      monthMgmt = Number(mgmtActualByMonth[monthKeyStr]);
      monthMgmtSource = "actual";
    } else if (rep && rep.mgmt_in_gross != null && Number(rep.mgmt_in_gross) > 0) {
      monthMgmt = Number(rep.mgmt_in_gross);
      monthMgmtSource = "manual";
    } else {
      // Auto from billing_groups (preferred) or contract_per_sqm (fallback) —
      // weighted across sub-parts when area changes mid-month.
      var bgTotal = 0;
      var cpsTotal = 0;
      var anyBgRate = false;
      parts.forEach(function(p) {
        var partDays = p.endDay - p.startDay + 1;
        var f = partDays / daysInMonth;
        if (p.mgmtRate > 0) {
          bgTotal += p.mgmtRate * p.area * f;
          anyBgRate = true;
        }
        if (contractFeePerSqm > 0) {
          cpsTotal += contractFeePerSqm * p.area * f;
        }
      });
      if (anyBgRate) {
        monthMgmt = bgTotal;
        monthMgmtSource = "billing_group";
      } else if (contractFeePerSqm > 0 && mgmtIncluded) {
        monthMgmt = cpsTotal;
        monthMgmtSource = "contract_per_sqm";
      }
    }

    parts.forEach(function(p, idx) {
      var partDays = p.endDay - p.startDay + 1;
      var fraction = partDays / daysInMonth;
      var subGross = monthGross * fraction;
      // For billing_group rate, mgmt scales by this segment's own area+days;
      // for the other sources it's a flat monthly amount split proportionally.
      var subMgmt: number;
      if (monthMgmtSource === "billing_group") {
        subMgmt = p.mgmtRate * p.area * fraction;
      } else {
        subMgmt = monthMgmt * fraction;
      }
      // Per the user's contract model (mgmt is paid OUT OF the 12% consideration):
      //   תמורה (subCalc)  = pct × gross
      //   שכ"ד מפדיון      = תמורה − mgmt
      //   נטו מחזור (info) = gross − mgmt / pct
      // Re-derive on the fly so older saved final_rent values (which used the
      // pre-fix formula) don't show stale numbers in the table.
      var pctFrac = Number(pctLabel) / 100;
      var subCalc  = subGross * pctFrac;                          // תמורה
      var subNet   = pctFrac > 0 ? Math.max(subGross - subMgmt / pctFrac, 0)
                                 : subGross;                       // מחזור נטו
      var subFinal = subCalc - subMgmt;                           // שכ"ד מפדיון
      var rps = (p.area > 0 && Math.abs(subFinal) > 0)
        ? subFinal / (p.area * fraction)
        : 0;

      if (rep) {
        sumFinal += subFinal;
        sumSqmMonths += p.area * fraction;
      }
      var cumRps = sumSqmMonths > 0 ? sumFinal / sumSqmMonths : 0;

      var labelBase = HEB_MONTHS[mIdx] + " " + String(selYear).slice(-2);
      var label = isMixed ? labelBase + " (" + p.startDay + "-" + p.endDay + ")" : labelBase;

      rows.push({
        m: mIdx, subIdx: idx, isFirstSubOfMonth: idx === 0,
        label, spaceName: p.spaceName,
        daysInPart: partDays, daysInMonth, fraction,
        area: p.area, report: rep,
        gross: subGross, mgmtDeduct: subMgmt, mgmtSource: monthMgmtSource,
        net: subNet, calcRent: subCalc, finalRent: subFinal,
        rentPerSqm: rps, cumAvgRentPerSqm: cumRps,
      });
    });
  }

  // Year totals
  var totGross = rows.reduce(function(s,r){return s+r.gross;},0);
  var totMgmt  = rows.reduce(function(s,r){return s+r.mgmtDeduct;},0);
  var totNet   = rows.reduce(function(s,r){return s+r.net;},0);
  var totFinal = rows.reduce(function(s,r){return s+r.finalRent;},0);
  var avgRpsYear = sumSqmMonths > 0 ? sumFinal / sumSqmMonths : 0;

  // Year options — current year ± 5
  var yearOptions: number[] = [];
  for (var y = currentYear + 1; y >= currentYear - 5; y--) yearOptions.push(y);

  return (
    <div dir="rtl">
      <PageHero title={"שכ\"ד פידיון"} icon="📊" tone="emerald" subtitle={contracts.length + " חוזי פידיון פעילים"} />

      {/* Tenant + year filters */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר</label>
          <select value={selContractId} onChange={function(e){setSelContractId(e.target.value);}} className={ic}>
            <option value="">-- בחר שוכר --</option>
            {contracts.map(function(c){return (
              <option key={c.id} value={c.id}>
                {c.tenants?.name} — {c.properties?.name} ({c.revenue_pct}%)
              </option>
            );})}
          </select>
        </div>
        <div className="w-full sm:w-32">
          <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
          <select value={selYear} onChange={function(e){setSelYear(Number(e.target.value));}} className={ic}>
            {yearOptions.map(function(y){return <option key={y} value={y}>{y}</option>;})}
          </select>
        </div>
      </div>

      {/* Contract context bar */}
      {selContract && (<>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
          {areaSegments.length <= 1 ? (
            <span><span className="text-slate-500">שטח:</span> <span className="font-semibold">{fallbackArea} מ"ר</span></span>
          ) : (
            <span><span className="text-slate-500">שטח (היסטוריה):</span>
              {areaSegments.map(function(s, i) {
                var fromStr = s.startDate.toLocaleDateString("he-IL");
                var toStr   = s.endDate ? s.endDate.toLocaleDateString("he-IL") : "—";
                return (
                  <span key={i} className="mr-2 font-semibold">
                    {s.area} מ"ר ({fromStr}{s.endDate ? "→"+toStr : "→ ..."})
                  </span>
                );
              })}
            </span>
          )}
          <span><span className="text-slate-500">% פידיון:</span> <span className="font-semibold">{pctLabel}%</span></span>
          {(function() {
            // The percentage may step up over the years — show the schedule, so
            // the figure above isn't mistaken for the rate in force today.
            var pt = pctTiersFromRow(selContract);
            if (pt.length === 0) return null;
            return (
              <span className="rounded-md bg-purple-100 text-purple-900 px-2 py-0.5 font-semibold" title="האחוז משתנה לאורך השנים; החישוב לכל חודש נעשה לפי האחוז שבתוקף באותה שנת חוזה">
                📈 {describePctTiers(Number(selContract.revenue_pct) || 0, pt)}
              </span>
            );
          })()}
          {(function() {
            var cats = revenueCategoriesFromRow(selContract);
            if (!hasCategories(cats)) return null;
            return (
              <span className="rounded-md bg-purple-100 text-purple-900 px-2 py-0.5 font-semibold" title="הפדיון מדווח בנפרד לכל סוג, והתמורה היא סכום כל סוג לפי האחוז שלו">
                🧾 {describeCategories(cats)}
              </span>
            );
          })()}
          {selContract.min_rent_per_sqm && (function() {
            // Show the floor as it stands NOW, not as signed — steps and linkage
            // both move it, and a stale figure here misleads the check against
            // the turnover share.
            var nowKey = monthKey(selYear, Math.min(12, new Date().getMonth() + 1));
            var nowMin = minRentForPeriod({
              baseMinPerSqm: Number(selContract.min_rent_per_sqm) || 0,
              tiers: minTiers,
              contractStart: selContract.start_date || nowKey,
              date: nowKey,
              area: 1,
              cpiRatio: minCpiByMonth[nowKey],
            });
            var moved = Math.abs(nowMin.perSqmIndexed - Number(selContract.min_rent_per_sqm)) > 0.005;
            return (
              <span>
                <span className="text-slate-500">מינ' למ&quot;ר:</span>{" "}
                <span className="font-semibold">{fmtMoney(nowMin.perSqmIndexed)}</span>
                {moved && (
                  <span className="text-[11px] text-slate-400">
                    {" "}(בחוזה {fmtMoney(Number(selContract.min_rent_per_sqm))}
                    {nowMin.perSqm !== Number(selContract.min_rent_per_sqm) ? " · אחרי מדרגות " + fmtMoney(nowMin.perSqm) : ""}
                    {nowMin.indexed ? " · צמוד ×" + nowMin.cpiRatio.toFixed(4) : " · טרם הוצמד"})
                  </span>
                )}
              </span>
            );
          })()}
          {mgmtIncluded && (
            <span className="rounded-md bg-amber-100 text-amber-900 px-2 py-0.5 font-semibold">
              ⚙️ ניהול כלול במחזור — מנוטרל אוטומטית
              {contractFeePerSqm > 0 && <span className="text-amber-700"> ({fmtMoney(contractFeePerSqm)}/מ"ר/חודש)</span>}
            </span>
          )}
          {!contractFeePerSqm && mgmtIncluded && (
            <span className="text-amber-700 text-[11px]">⚠ אין הגדרת mgmt_fee_per_sqm — הזן את דמי הניהול ידנית בכל דיווח</span>
          )}
        </div>

        {selContract.revenue_minimum_advance === false && (Number(selContract.minimum_rent) > 0 || selContract.min_rent_per_sqm) && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            להסכם זה מוגדר מינימום, אך הוא אינו משולם כמקדמה — לכן כל דיווח מחייב את מלוא שכ&quot;ד החודש (הגבוה מבין המינימום לפדיון) ואין התחשבנות תקופתית נפרדת.
          </div>
        )}

        {settlements.length > 0 && (
          <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-xs font-bold text-indigo-800">
                ⚖️ התחשבנות — הפרש בין המינימום ששולם לתמורה מהפדיון
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-indigo-600">חשב לפי</span>
                <select value={settleViewFreq} onChange={function(e){ setSettleViewFreq(e.target.value); }}
                  className="rounded border border-indigo-200 px-2 py-0.5 text-[11px]">
                  <option value="">לפי החוזה ({FREQ_LABELS[(selContract.revenue_settlement_freq || "monthly") as SettlementFreq]})</option>
                  <option value="monthly">חודשית</option>
                  <option value="quarterly">רבעונית</option>
                  <option value="semiannual">חצי שנתית</option>
                  <option value="annual">שנתית</option>
                </select>
              </div>
            </div>
            {settleViewFreq && settleViewFreq !== (selContract.revenue_settlement_freq || "monthly") && (
              <div className="mb-2 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px] text-amber-800">
                תצוגה בלבד — החוזה קובע התחשבנות {FREQ_LABELS[(selContract.revenue_settlement_freq || "monthly") as SettlementFreq]}.
                חיוב שייווצר כאן לא תואם את תדירות ההתחשבנות שבהסכם.
              </div>
            )}
            {hasRevenueProtection(revenueProtectionFromRow(selContract)) && (
              <div className="mb-2 rounded bg-blue-50 border border-blue-200 px-2 py-1.5 text-[11px] text-blue-800">
                🛡️ {describeRevenueProtection(revenueProtectionFromRow(selContract), selContract, selContract.contract_options || [])}
                {" "}— בתקופה מוגנת פער שלילי מוחזר לשוכר; מחוץ לתקופה המינימום הוא רצפה והפער יהיה אפס.
              </div>
            )}
            <div className="mb-2 rounded bg-slate-50 border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600">
              {selContract.revenue_minimum_advance
                ? "המודל בהסכם זה: המינימום משולם כמקדמה מדי חודש, וההתחשבנות גובה רק את ההשלמה לאחוז מהפדיון. במסך החיובים ההשלמה מוצגת בניכוי המינימום שכבר חויב."
                : "המודל בהסכם זה: ללא מקדמות — כל דיווח מחייב את מלוא שכ\"ד החודש (הגבוה מבין המינימום לפדיון). אם עברתם למקדמות מינימום, סמנו זאת בהסכם כדי שההשלמה תחושב נכון."}
            </div>
            <div className="space-y-2">
              {settlements.map(function(st) {
                var c = st.calc;
                return (
                  <div key={st.period.key} className="rounded-lg border border-indigo-100 bg-white p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-bold text-slate-700">
                        {st.period.label}
                        <span className="font-normal text-slate-400"> · התחשבנות ליום {fmtDate(st.period.settlementDate)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={"text-xs font-bold " + (c.difference > 0 ? "text-red-700" : c.difference < 0 ? "text-blue-700" : "text-green-700")}>
                          {c.difference > 0 ? "הפרש לחיוב " + fmtMoney(c.total)
                            : c.difference < 0 ? "🛡️ להחזר לשוכר " + fmtMoney(Math.abs(c.total))
                            : "אין הפרש — המינימום כיסה"}
                        </span>
                        {Math.abs(c.difference) > 0.009 && (
                          <button disabled={settling === st.period.key}
                            onClick={function() { createSettlementCharge(st.period, c); }}
                            className="rounded border border-indigo-300 bg-indigo-50 text-indigo-700 px-2 py-0.5 text-[11px] font-bold hover:bg-indigo-100 disabled:opacity-50">
                            {settling === st.period.key ? "יוצר..." : (c.difference < 0 ? "צור זיכוי לשוכר" : "צור חיוב הפרש")}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-1.5 overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead className="text-slate-400">
                          <tr>
                            <th className="text-right font-semibold py-0.5">חודש</th>
                            <th className="text-right font-semibold">מינימום ששולם</th>
                            <th className="text-right font-semibold">תמורה מפדיון</th>
                            <th className="text-right font-semibold">מקדם שערוך</th>
                            <th className="text-right font-semibold">מינימום משוערך</th>
                            <th className="text-right font-semibold">פדיון משוערך</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.rows.map(function(r) {
                            return (
                              <tr key={r.monthKey} className={"border-t border-slate-50 " + (r.reported ? "" : "opacity-50")}>
                                <td className="py-0.5">{HEB_MONTHS[r.month]}{r.reported ? "" : " (לא דווח)"}</td>
                                <td>{fmtMoney(r.base)}</td>
                                <td>{fmtMoney(r.alt)}</td>
                                <td className="text-slate-400">×{r.ratio.toFixed(4)}</td>
                                <td>{fmtMoney(r.indexedBase)}</td>
                                <td>{fmtMoney(r.indexedAlt)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t border-slate-200 font-bold">
                          <tr>
                            <td className="py-0.5">סה&quot;כ</td>
                            <td colSpan={3}></td>
                            <td>{fmtMoney(c.totalBase)}</td>
                            <td>{fmtMoney(c.totalAlt)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {(c.missingMonths.length > 0 || c.unindexed) && (
                      <div className="mt-1 text-[11px] text-amber-700">
                        {c.missingMonths.length > 0 && <>⚠ חסרים דיווחים: {c.missingMonths.map(function(m){return HEB_MONTHS[m];}).join(", ")} — ההתחשבנות חלקית. </>}
                        {c.unindexed && <>⚠ חלק מהחודשים לא שוערכו (מדד טרם פורסם) וחושבו ×1.</>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>)}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : contracts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📊</div><div>אין חוזי פידיון</div>
          <div className="text-xs mt-2">הגדר חוזי פידיון בעמוד חוזים</div>
        </div>
      ) : !selContractId ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400 text-sm">
          בחר שוכר כדי להציג את הדיווחים החודשיים
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className={"grid gap-3 mb-5 " + (hasAnyMgmt ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3")}>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 text-center">
              <div className="text-2xl font-black text-slate-700">{fmtMoney(totGross)}</div>
              <div className="text-xs text-slate-400 mt-1">מחזור ברוטו {selYear}</div>
            </div>
            {hasAnyMgmt && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 shadow-sm p-4 text-center">
                <div className="text-2xl font-black text-amber-700">{fmtMoney(totMgmt)}</div>
                <div className="text-xs text-amber-700 mt-1">דמי ניהול בתוך המחזור</div>
              </div>
            )}
            <div className="rounded-xl border border-blue-200 bg-blue-50 shadow-sm p-4 text-center">
              <div className="text-2xl font-black text-blue-700">{fmtMoney(totFinal)}</div>
              <div className="text-xs text-blue-700 mt-1">שכ"ד סה"כ {selYear}</div>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 shadow-sm p-4 text-center">
              <div className="text-2xl font-black text-green-700">{fmtNum(avgRpsYear)}</div>
              <div className="text-xs text-green-700 mt-1">ממוצע שכ"ד למ"ר</div>
            </div>
          </div>

          {/* 12-month table */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto mb-4">
            <table className="w-full min-w-[640px] text-right text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-3 font-semibold text-slate-700">חודש</th>
                  <th className="px-3 py-3 font-semibold text-slate-500">שטח (מ"ר)</th>
                  <th className="px-3 py-3 font-semibold text-slate-700">מחזור ברוטו</th>
                  {hasAnyMgmt && <th className="px-3 py-3 font-semibold text-amber-700">דמי ניהול</th>}
                  {hasAnyMgmt && <th className="px-3 py-3 font-semibold text-slate-700">נטו מחזור</th>}
                  <th className="px-3 py-3 font-semibold text-slate-700" title="תמורה לפני ניכוי דמי ניהול">תמורה {pctLabel}%</th>
                  <th className="px-3 py-3 font-semibold text-slate-700" title="שכ&quot;ד אחרי ניכוי דמי ניהול מהתמורה">שכ&quot;ד מפדיון</th>
                  <th className="px-3 py-3 font-semibold text-green-700">שכ"ד/מ"ר</th>
                  <th className="px-3 py-3 font-semibold text-slate-500">ממוצע מצטבר/מ"ר</th>
                  <th className="px-3 py-3 font-semibold text-slate-700">דיווח השוכר</th>
                  <th className="px-3 py-3 font-semibold text-slate-700"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(function(row, rowIdx) {
                  var isThisRowAttaching = row.report && rowAttaching === row.report.id;
                  var hasReport = !!row.report;
                  var hasAttachment = !!row.report?.attachment_url;
                  // The attach / "+ הוסף" / 🗑 controls refer to the underlying
                  // monthly report row, so render them only on the first sub-row.
                  var showActions = row.isFirstSubOfMonth;
                  var nextSameMonth = rowIdx + 1 < rows.length && rows[rowIdx + 1].m === row.m;
                  return (
                    <tr key={row.m + "-" + row.subIdx} className={
                      "border-t border-slate-100 " +
                      (hasReport ? "hover:bg-slate-50" : "bg-slate-50/40 text-slate-400") +
                      (!row.isFirstSubOfMonth ? " bg-amber-50/30" : "")
                    }>
                      <td className="px-3 py-2.5 font-semibold whitespace-nowrap">
                        {row.label}
                        {row.spaceName && row.isFirstSubOfMonth === false && (
                          <div className="text-[10px] text-slate-500 font-normal">{row.spaceName}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs">{row.area}</td>
                      <td className="px-3 py-2.5 font-mono">{fmtMoney(row.gross)}</td>
                      {hasAnyMgmt && (
                        <td className="px-3 py-2.5 font-mono text-amber-700 whitespace-nowrap">
                          {row.mgmtDeduct > 0 ? (
                            <span title={
                              row.mgmtSource === "actual" ? "מספר אמת (התחשבנות סופית)" :
                              row.mgmtSource === "manual" ? "הוזן ידנית בדיווח" :
                              row.mgmtSource === "billing_group" ? "מקדמת ניהול לפי קבוצת חיוב (rate × שטח)" :
                              row.mgmtSource === "contract_per_sqm" ? "מהגדרת mgmt_fee_per_sqm בחוזה" :
                              ""
                            }>
                              −{fmtMoney(row.mgmtDeduct)}
                              {row.mgmtSource === "actual" && <span className="text-[9px] font-bold text-green-700 mr-1">✓ אמת</span>}
                              {row.mgmtSource === "manual" && <span className="text-[9px] font-bold text-blue-700 mr-1">ידני</span>}
                              {row.mgmtSource === "billing_group" && <span className="text-[9px] font-bold text-amber-600 mr-1">מקדמה</span>}
                            </span>
                          ) : "—"}
                        </td>
                      )}
                      {hasAnyMgmt && <td className="px-3 py-2.5 font-mono">{fmtMoney(row.net)}</td>}
                      <td className="px-3 py-2.5 font-mono">{fmtMoney(row.calcRent)}</td>
                      <td className="px-3 py-2.5 font-mono font-black text-blue-700">{fmtMoney(row.finalRent)}</td>
                      <td className="px-3 py-2.5 font-mono text-green-700">{row.rentPerSqm > 0 ? fmtNum(row.rentPerSqm) : "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-slate-500 text-xs">{row.cumAvgRentPerSqm > 0 ? fmtNum(row.cumAvgRentPerSqm) : "—"}</td>
                      <td className="px-3 py-2.5">
                        {!showActions ? <span className="text-slate-300 text-xs">↑</span> :
                         hasAttachment ? (
                          <div className="flex items-center gap-1">
                            <a
                              href={row.report.attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-700 hover:text-blue-900 underline truncate max-w-[120px]"
                              title={row.report.attachment_name || "הצג קובץ"}
                            >📎 {row.report.attachment_name || "קובץ"}</a>
                            <button
                              onClick={function(){
                                var inp = document.createElement("input");
                                inp.type = "file";
                                inp.accept = ".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf";
                                inp.onchange = function(e: any) { var f = e.target.files?.[0]; if (f) attachToRow(row.report.id, f); };
                                inp.click();
                              }}
                              disabled={isThisRowAttaching}
                              className="text-xs border border-slate-200 rounded px-1 py-0.5 text-slate-500 hover:bg-slate-50"
                              title="החלף קובץ"
                            >🔄</button>
                            <button
                              onClick={function(){ removeAttachment(row.report); }}
                              className="text-xs border border-red-100 rounded px-1 py-0.5 text-red-400 hover:bg-red-50"
                              title="מחק קובץ"
                            >🗑</button>
                          </div>
                        ) : hasReport ? (
                          <button
                            onClick={function(){
                              var inp = document.createElement("input");
                              inp.type = "file";
                              inp.accept = ".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf";
                              inp.onchange = function(e: any) { var f = e.target.files?.[0]; if (f) attachToRow(row.report.id, f); };
                              inp.click();
                            }}
                            disabled={isThisRowAttaching}
                            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50 disabled:opacity-50"
                            title="צרף דיווח מהשוכר"
                          >
                            {isThisRowAttaching ? "מעלה..." : "📎 צרף"}
                          </button>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {!showActions ? <span className="text-slate-300 text-xs">↑</span> :
                         hasReport ? (
                          <button
                            onClick={function(){ deleteRow(row.report); }}
                            className="text-xs text-red-400 hover:text-red-600"
                            title="מחק דיווח"
                          >🗑 מחק</button>
                        ) : (
                          <button
                            onClick={function(){ openNewFor(selContractId, monthKey(selYear, row.m).slice(0,7)); }}
                            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-1 hover:bg-blue-50"
                          >+ הוסף</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <tr>
                  <td className="px-3 py-3 text-slate-700">סה"כ {selYear}</td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 font-mono text-slate-800">{fmtMoney(totGross)}</td>
                  {hasAnyMgmt && <td className="px-3 py-3 font-mono text-amber-700">{fmtMoney(totMgmt)}</td>}
                  {hasAnyMgmt && <td className="px-3 py-3 font-mono text-slate-800">{fmtMoney(totNet)}</td>}
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 font-mono font-black text-blue-700">{fmtMoney(totFinal)}</td>
                  <td className="px-3 py-3 font-mono text-green-700">{avgRpsYear > 0 ? fmtNum(avgRpsYear) : "—"}</td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Bottom "add report" button — user explicitly asked it be at the bottom */}
          <div className="flex justify-center mb-4">
            <button
              onClick={function(){
                // Default to current month if it's in the selected year, else January
                var defaultMonth = (selYear === currentYear)
                  ? (selYear + "-" + String(new Date().getMonth()+1).padStart(2,"0"))
                  : (selYear + "-01");
                openNewFor(selContractId || (contracts[0]?.id || ""), defaultMonth);
              }}
              className="rounded-lg bg-blue-700 px-6 py-3 font-bold text-white hover:bg-blue-800 shadow-sm"
            >
              + דיווח הכנסה
            </button>
          </div>
        </>
      )}

      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">דיווח הכנסה {fMonth && "— " + (HEB_MONTHS[Number(fMonth.split("-")[1])] + " " + fMonth.split("-")[0])}</h2>
              <button onClick={closeModal} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                  <select value={fContractId} onChange={function(e){setFContractId(e.target.value);}} className={ic}>
                    <option value="">-- בחר --</option>
                    {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name} ({c.revenue_pct}%)</option>;})}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חודש *</label>
                  <input type="month" value={fMonth} onChange={function(e){setFMonth(e.target.value);}} className={ic}/>
                </div>
              </div>
              {hasCategories(fCats) ? (
                <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-3 space-y-2">
                  <div className="text-xs font-bold text-purple-800">פדיון לפי סוג *</div>
                  {fCats.map(function(cat) {
                    var amt = Number(fByCategory[cat.key]) || 0;
                    return (
                      <div key={cat.key} className="flex items-center gap-2">
                        <span className="text-xs text-purple-700 w-28 truncate">{cat.name}</span>
                        <span className="text-[11px] text-purple-500 w-12">{cat.pct}%</span>
                        <input type="number" value={fByCategory[cat.key] ?? ""}
                          onChange={function(e){ setFByCategory({ ...fByCategory, [cat.key]: e.target.value }); }}
                          className={ic + " flex-1"} placeholder="0" />
                        <span className="text-[11px] text-purple-600 w-24 text-left">
                          {amt > 0 ? fmtMoney(amt * cat.pct / 100) : "—"}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between text-xs border-t border-purple-200 pt-1.5">
                    <span className="text-purple-700 font-semibold">סה&quot;כ פדיון</span>
                    <span className="font-bold">{fmtMoney(fCatsTotal)}</span>
                  </div>
                  {previewCalc && (
                    <div className="flex justify-between text-xs">
                      <span className="text-purple-700 font-semibold">תמורה משוקללת</span>
                      <span className="font-bold">{fmtMoney(previewCalc.consideration)} <span className="font-normal text-purple-500">({previewCalc.effPct}% אפקטיבי)</span></span>
                    </div>
                  )}
                  {previewCalc?.split?.missing?.length > 0 && (
                    <div className="text-[11px] text-amber-700">⚠ לא דווח פדיון עבור: {previewCalc.split.missing.join(", ")} — ייחשב כאפס.</div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">הכנסה ברוטו (₪) *</label>
                  <input type="number" value={fGrossRevenue} onChange={function(e){setFGrossRevenue(e.target.value);}} className={ic} placeholder="לדוגמה: 500000"/>
                </div>
              )}
              {/* Manual mgmt-in-gross — shown only when the contract flag is set.
                  Overrides the auto-derivation (mgmt_fee_per_sqm × area). */}
              {(() => {
                var c = contracts.find(function(x){return x.id===fContractId;});
                if (!c?.mgmt_included_in_revenue) return null;
                var autoMgmt = (c.mgmt_fee_per_sqm && c.charged_area)
                  ? Number(c.mgmt_fee_per_sqm) * Number(c.charged_area) : 0;
                return (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-amber-700">
                      דמי ניהול בתוך המחזור (₪)
                      {autoMgmt > 0 && <span className="text-slate-400 mr-2 font-normal">— ברירת מחדל מהחוזה: {fmtMoney(autoMgmt)}</span>}
                      {!autoMgmt && <span className="text-amber-600 mr-2 font-normal">— אין הגדרה בחוזה, הזן ידנית</span>}
                    </label>
                    <input
                      type="number"
                      value={fMgmtInGross}
                      onChange={function(e){setFMgmtInGross(e.target.value);}}
                      className={ic}
                      placeholder={autoMgmt > 0 ? "השאר ריק לשימוש בברירת מחדל" : "לדוגמה: 1500"}
                    />
                  </div>
                );
              })()}
              {previewCalc && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm space-y-1.5">
                  <div className="font-bold text-blue-700 mb-2">חישוב אוטומטי</div>
                  <div className="flex justify-between text-xs"><span className="text-slate-500">מחזור ברוטו (כולל דמי ניהול)</span><span className="font-medium">{fmtMoney(Number(fGrossRevenue))}</span></div>
                  {previewCalc.mgmtMonthly > 0 && (
                    <div className="flex justify-between text-xs text-slate-500"><span>מחזור נטו (ללא דמי ניהול) — מידע</span><span className="font-medium">{fmtMoney(previewCalc.netGross)}</span></div>
                  )}
                  <div className="flex justify-between text-xs border-t border-blue-200 pt-1.5">
                    <span className="text-slate-700 font-semibold">תמורה בגין פדיון {previewCalc.pct}%</span>
                    <span className="font-semibold">{fmtMoney(previewCalc.consideration)}</span>
                  </div>
                  {previewCalc.mgmtMonthly > 0 && (
                    <div className="flex justify-between text-xs text-amber-700">
                      <span>− דמי ניהול בתוך המחזור</span>
                      <span className="font-medium">−{fmtMoney(previewCalc.mgmtMonthly)}</span>
                    </div>
                  )}
                  {previewCalc.minRent > 0 && (
                    <div className="flex justify-between text-xs"><span className="text-slate-500">מינימום</span><span className="font-medium">{fmtMoney(previewCalc.minRent)}</span></div>
                  )}
                  <div className="flex justify-between font-black text-blue-800 text-base pt-2 border-t border-blue-200">
                    <span>שכ&quot;ד מפדיון</span><span>{fmtMoney(previewCalc.finalRent)}</span>
                  </div>
                  {previewCalc.vat > 0 && (
                    <div className="flex justify-between text-xs text-slate-500"><span>מע&quot;מ</span><span className="font-medium">{fmtMoney(previewCalc.vat)}</span></div>
                  )}
                  {previewCalc.area > 0 && Math.abs(previewCalc.finalRent) > 0 && (
                    <div className="flex justify-between text-xs text-green-700 pt-1"><span>שכ&quot;ד למ&quot;ר</span><span className="font-medium">{fmtNum(previewCalc.finalRent / previewCalc.area)}</span></div>
                  )}
                  {previewCalc.rentFromRev < previewCalc.minRent && previewCalc.minRent > 0 && (
                    <div className="text-xs text-orange-600 font-semibold">⚠️ פידיון נמוך ממינימום — יחויב מינימום</div>
                  )}
                </div>
              )}
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic}/></div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">📎 צרף דיווח מהשוכר (PDF / תמונה)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
                  onChange={function(e){ setFFile(e.target.files?.[0] || null); }}
                  className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                />
                {fFile && (
                  <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
                    <span>{fFile.name}</span>
                    <span className="text-slate-400">({(fFile.size/1024).toFixed(0)} KB)</span>
                    <button type="button" onClick={function(){setFFile(null); if (fileInputRef.current) fileInputRef.current.value="";}} className="text-red-500 hover:text-red-700">× הסר</button>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={closeModal} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving||!previewCalc} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"שומר...":"שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
