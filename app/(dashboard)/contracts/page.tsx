"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { syncContractStatuses } from '@/lib/contractSync';
import { logAudit } from '@/lib/audit-log';
import { PageHero } from '@/components/ui';
import { fetchCpiAdjusted, fetchHighestChainedCpi } from '@/lib/cpi-server';
import { calcChainingCoefficient, formatPeriod } from '@/lib/cpi-utils';
import { getVatPct } from '@/lib/vat';
import { getScopeIds, scopeRows } from '@/lib/permissions';
import CalcProgress, { CalcProgressState } from '@/components/CalcProgress';
import { buildPriceTimeline, calculateTierPreviews, buildSpaceRentSchedule, rentAtDate, type PriceTier } from '@/lib/contract-utils';
import { penaltyTermsFromRow, hasPenalty, describePenaltyTerms, contractArea, penaltyMonths } from '@/lib/option-penalty';
import { previewOptionDecline, applyOptionDecline } from '@/lib/option-decline';
import { baseIndexRuleFromRow, describeBaseIndexRule, baseIndexPending, resolveBaseIndexMonth } from '@/lib/base-index-rule';
import { pctTiersFromRow, describePctTiers } from '@/lib/revenue-pct-steps';
import { mgmtProtectionFromRow, describeMgmtProtection } from '@/lib/mgmt-protection';
// CPI + price timeline

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
// Auto-computed lease/option END dates are stored as EXCLUSIVE boundaries
// (start + N months/years = the day AFTER the last lease day) — required for
// option chaining and "start ≤ now < end" checks. For DISPLAY we show the
// inclusive last day (boundary − 1): a 1-year lease from 1.7.2025 ends 30.6.2026.
// BUT only when the end really is a "start + N" boundary — detected by it sharing
// the start's day-of-month (addMonths/addYears preserve the day; every link in
// the chain keeps the contract-start day). An explicitly-typed end (e.g. 31.12)
// whose day differs is left as-is, so we never mis-shift a genuine end date.
function inclusiveEnd(end: string | Date, start?: string | Date | null): Date | null {
  if (!end) return null;
  var e = new Date(end);
  if (isNaN(e.getTime())) return null;
  if (!start) return e;
  var s = new Date(start);
  if (isNaN(s.getTime())) return e;
  if (e.getDate() !== s.getDate()) return e; // explicit end date, not a start+N boundary
  var x = new Date(e);
  x.setDate(x.getDate() - 1);
  return x;
}
function fmtEndDate(end: string, start?: string | null) { var x = inclusiveEnd(end, start); return x ? x.toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return "₪"+(n??0).toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}); }

function yearsMonthsLeft(endDate: string) {
  const now = new Date();
  const end = new Date(endDate);
  if (isNaN(end.getTime())) return null;
  const diffMs = end.getTime() - now.getTime();
  if (diffMs <= 0) return { years: 0, months: 0, text: "פג!", isExpired: true };
  const totalMonths = Math.floor(diffMs / (1000*60*60*24*30.44));
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  let text = "";
  if (years > 0) text += years + " שנים";
  if (years > 0 && months > 0) text += " ו-";
  if (months > 0) text += months + " חודשים";
  if (!text) text = "פחות מחודש";
  return { years, months, text, isExpired: false };
}

// "מדד ידוע" — the CPI index KNOWN at a given date.
// CPI for month X is published around the 15th of month X+1.
// On 15th+ of month Y → known index = month Y-1
// Before 15th of month Y → known index = month Y-2
function getKnownIndexMonth(date: Date): { year: number; month: number } {
  const d = new Date(date);
  const monthsBack = d.getDate() >= 15 ? 1 : 2;
  d.setMonth(d.getMonth() - monthsBack);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// Label for a contract's BASE index. index_base_date is the REFERENCE date the
// user enters; the actual base index is the "known" index published by then —
// e.g. on 1.11.2019 the known index is SEPTEMBER 2019 (published 15.10.2019),
// NOT November. Keeps the details label in sync with the CPI calculator box,
// which already resolves to the known month.
function baseIndexLabel(dateStr: string): string {
  if (!dateStr) return "";
  const k = getKnownIndexMonth(new Date(dateStr));
  return formatPeriod(k.year, k.month);
}

// Format date as MM-DD-YYYY for CBS calculator.
// CBS publishes CPI on the 15th but considers it "known" from the 16th.
// Users always enter 15 as the day for index dates, so we bump to 16 automatically.
function formatDateForCbs(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  if (d.getDate() === 15) d.setDate(16);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

const STATUS_MAP: Record<string,{label:string;color:string;dot:string}> = {
  active:   {label:"פעיל",    color:"bg-green-100 text-green-700",  dot:"bg-green-500"},
  expiring: {label:"מסתיים", color:"bg-yellow-100 text-yellow-700",dot:"bg-yellow-500"},
  extended: {label:"פעיל",   color:"bg-green-100 text-green-700",  dot:"bg-green-500"}, // alias for active
  upcoming: {label:"עתידי",  color:"bg-purple-100 text-purple-700",dot:"bg-purple-500"},
  ended:    {label:"הסתיים", color:"bg-slate-100 text-slate-500",  dot:"bg-slate-400"},
};

export default function ContractsPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  // Configured VAT rate (vat_rates) — fetched once; default 18% until loaded.
  const [vatPct,    setVatPct]    = useState(0.18);
  useEffect(function(){ getVatPct().then(setVatPct); }, []);
  const [selected,  setSelected]  = useState<string|null>(null);
  const [filterSt,  setFilterSt]  = useState("active");
  const [filterProp, setFilterProp] = useState("all");
  const [search,    setSearch]    = useState("");
  const [cpiResult, setCpiResult] = useState<any>(null);
  const [cpiLoading, setCpiLoading] = useState(false);
  // A derived base index that hasn't been fixed yet: nothing to link to, so the
  // screen says so instead of computing from a placeholder date.
  const [cpiPending, setCpiPending] = useState("");
  const [cpiProgress, setCpiProgress] = useState<CalcProgressState | null>(null);
  const [perUnitCpi, setPerUnitCpi] = useState<Record<string, {ratio: number, source: string}>>({});
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [rawTiersWithSpace, setRawTiersWithSpace] = useState<any[]>([]);
  const [priceTimeline, setPriceTimeline] = useState<any[]>([]);
  // For revenue-% contracts: rent-per-sqm derived from reported turnover (no CPI).
  const [revStats, setRevStats] = useState<any>(null);
  const [amendments, setAmendments] = useState<any[]>([]);
  const [parkingSubs, setParkingSubs] = useState<any[]>([]);
  const [spaceOverlaps, setSpaceOverlaps] = useState<any[]>([]);

  // Amendment modal state
  const [showAmendModal, setShowAmendModal] = useState(false);
  // Recording the actual handover — the moment the lease really starts.
  const [showHandover, setShowHandover] = useState(false);
  const [handoverDate, setHandoverDate] = useState("");
  const [handoverSaving, setHandoverSaving] = useState(false);
  const [amendType, setAmendType] = useState<string|null>(null);
  const [amendDate, setAmendDate] = useState(new Date().toISOString().split("T")[0]);
  const [amendNotes, setAmendNotes] = useState("");
  const [amendDocUrl, setAmendDocUrl] = useState("");
  const [amendSaving, setAmendSaving] = useState(false);
  // For unit swap/add
  const [amendRemoveSpaces, setAmendRemoveSpaces] = useState<string[]>([]);
  const [amendAddSpaces, setAmendAddSpaces] = useState<string[]>([]);
  const [amendAddRents, setAmendAddRents] = useState<Record<string, string>>({});
  const [allPropertySpaces, setAllPropertySpaces] = useState<any[]>([]);
  // For extend period
  const [amendNewEndDate, setAmendNewEndDate] = useState("");
  // For price change
  const [amendPriceChanges, setAmendPriceChanges] = useState<Record<string, string>>({});
  // Per-unit CPI base: "original" = use contract's CPI, "custom" = new CPI value/date
  const [amendCpiMode, setAmendCpiMode] = useState<Record<string, "original" | "custom">>({});
  const [amendCpiValue, setAmendCpiValue] = useState<Record<string, string>>({});
  const [amendCpiDate, setAmendCpiDate] = useState<Record<string, string>>({});
  // Parking subscription
  const [amendParkQty, setAmendParkQty] = useState("1");
  const [amendParkFee, setAmendParkFee] = useState("");
  const [amendParkMarked, setAmendParkMarked] = useState(false);
  const [amendParkSpotNumber, setAmendParkSpotNumber] = useState("");
  const [amendParkIncluded, setAmendParkIncluded] = useState(false);
  // Visitor parking
  const [amendVisitorCodes, setAmendVisitorCodes] = useState("");
  const [amendVisitorDiscount, setAmendVisitorDiscount] = useState("");
  const [amendVisitorTariff, setAmendVisitorTariff] = useState("");
  const [amendVisitorFreq, setAmendVisitorFreq] = useState("quarterly");

  useEffect(function() { loadContracts(); }, []);

  // Deep link from alerts (and anywhere else): /contracts?select=<contractId>
  // auto-opens that contract's detail panel.
  useEffect(function() {
    try {
      var sel = new URLSearchParams(window.location.search).get("select");
      if (sel) setSelected(sel);
    } catch (e) { /* SSR-safe no-op */ }
  }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts")
      .select("*, tenants(name,phone,primary_email,company_name), properties(name,city), contract_options(id,option_number,duration_months,duration_years,start_date,end_date,notice_days_before_end,notice_type,status,is_exercised,rent_mechanism,rent_increase_pct,new_rent_value,option_group,exit_points,price_schedule_type,price_tiers,non_exercise_penalty_type,non_exercise_penalty_value,non_exercise_penalty_basis,non_exercise_penalty_months,non_exercise_penalty_indexed,non_exercise_penalty_vat,non_exercise_penalty_days,non_exercise_penalty_notes,declined_at,non_exercise_charge_id), guarantees(id,guarantee_type,status,amount_required,amount_actual,end_date,bank,document_url), contract_ti(id,description,ti_type,ti_amount,recovery_method,recovery_amount_monthly,recovery_start_date,recovery_end_date,payment_trigger,payment_days_after,payment_due_date,payment_installments,requires_invoice,requires_report,paid_at,paid_amount,payment_notes,notes), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,index_base_value,index_base_date,use_original_index,spaces(space_name,area))")
      .order("end_date");
    // Data-level scoping: managers/viewers see only contracts of their
    // allowed properties (admin scope is null = everything).
    var scope = await getScopeIds();
    var scoped = scopeRows(data ?? [], scope, function(c: any){ return c.property_id; });
    setContracts(scoped);
    setLoading(false);
    // Don't override a deep-linked selection (?select=) with the default pick —
    // this async callback closes over a stale `selected` (null on mount).
    var urlSel: string | null = null;
    try { urlSel = new URLSearchParams(window.location.search).get("select"); } catch (e) { /* noop */ }
    if (!selected && !urlSel && (data??[]).filter(function(c){return c.status==="active";}).length>0) {
      setSelected((data??[]).filter(function(c){return c.status==="active";})[0].id);
    }
  }

  const selContract = contracts.find(function(c){return c.id===selected;});

  // Load amendments + check space overlaps for selected contract
  useEffect(function() {
    if (!selContract) { setAmendments([]); setParkingSubs([]); setSpaceOverlaps([]); return; }
    // Load amendments first, then check overlaps using ALL spaces (base + amendments)
    supabase.from("contracts")
      .select("id,amendment_number,amendment_date,amendment_notes,document_url,start_date,end_date,rent_per_sqm,charged_area,contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,index_base_value,index_base_date,use_original_index,spaces(space_name,area))")
      .eq("parent_contract_id", selContract.id)
      .eq("is_amendment", true)
      .order("amendment_number")
      .then(function({ data }) {
        var loadedAmendments = data ?? [];
        setAmendments(loadedAmendments);

        // Effective spaces = latest amendment's spaces, or base if no amendments
        var latestAm = loadedAmendments.length > 0 ? loadedAmendments[loadedAmendments.length - 1] : null;
        var effSpaces = latestAm?.contract_spaces?.length > 0
          ? latestAm.contract_spaces
          : (selContract.contract_spaces || []);
        var spaceIds = effSpaces.map(function(cs: any) { return cs.space_id; });

        if (spaceIds.length > 0) {
          // Build the full "family" of IDs to exclude:
          // The base contract, all its amendments, and if selContract IS an amendment —
          // also its parent and all sibling amendments.
          var baseId = selContract.parent_contract_id || selContract.id;
          var excludeIds = [selContract.id, baseId];
          loadedAmendments.forEach(function(am: any) { excludeIds.push(am.id); });
          // If this contract is an amendment, also load sibling amendments from parent
          if (selContract.parent_contract_id) {
            excludeIds.push(selContract.parent_contract_id);
          }

          supabase.from("contract_spaces")
            .select("space_id, contracts!inner(id, status, start_date, end_date, is_amendment, parent_contract_id, tenants(name))")
            .in("space_id", spaceIds)
            .in("contracts.status", ["active", "extended"])
            .then(async function({ data: overlapData }) {
              var rawOverlaps = (overlapData ?? []).filter(function(o: any) {
                var cId = o.contracts.id;
                if (excludeIds.includes(cId)) return false;
                if (o.contracts.parent_contract_id && excludeIds.includes(o.contracts.parent_contract_id)) return false;
                var oS = new Date(o.contracts.start_date);
                var oE = new Date(o.contracts.end_date);
                var cS = new Date(selContract.start_date);
                var cE = new Date(selContract.end_date);
                return oS < cE && oE > cS;
              });
              // Filter out "phantom" overlaps: if the other contract's latest
              // amendment REMOVED the space (e.g. cross-swap), it's not real.
              // Resolve each overlap to its BASE contract, then check latest amendment.
              if (rawOverlaps.length > 0) {
                // Map each overlap to its base contract ID
                var otherBaseIds = new Set<string>();
                rawOverlaps.forEach(function(o: any) {
                  var baseId = o.contracts.parent_contract_id || o.contracts.id;
                  otherBaseIds.add(baseId);
                });
                var baseIdArr = Array.from(otherBaseIds);
                // Load latest amendment spaces for each base contract
                var { data: otherAmends } = await supabase.from("contracts")
                  .select("parent_contract_id, amendment_number, contract_spaces(space_id)")
                  .in("parent_contract_id", baseIdArr)
                  .eq("is_amendment", true)
                  .order("amendment_number", { ascending: false });
                // Build map: baseId → Set of space_ids in latest amendment
                var otherEffective: Record<string, Set<string>> = {};
                for (var oa of (otherAmends || [])) {
                  if (!otherEffective[oa.parent_contract_id]) {
                    otherEffective[oa.parent_contract_id] = new Set(
                      (oa.contract_spaces || []).map(function(cs: any) { return cs.space_id; })
                    );
                  }
                }
                rawOverlaps = rawOverlaps.filter(function(o: any) {
                  // Resolve to base contract
                  var baseId = o.contracts.parent_contract_id || o.contracts.id;
                  var effSet = otherEffective[baseId];
                  // If base has amendments, check if space is still in effective set
                  if (effSet) return effSet.has(o.space_id);
                  return true; // no amendments → base is the effective state
                });
              }
              setSpaceOverlaps(rawOverlaps);
            });
        } else { setSpaceOverlaps([]); }
      });
    // Load parking subscriptions for this contract AND its amendments
    supabase.from("contracts").select("id").or("id.eq."+selContract.id+",parent_contract_id.eq."+selContract.id)
      .then(function({ data: ids }) {
        var contractIds = (ids || []).map(function(c: any) { return c.id; });
        if (contractIds.length === 0) { setParkingSubs([]); return; }
        supabase.from("parking_subscriptions")
          .select("*").in("contract_id", contractIds).eq("status","active")
          .then(function({ data: pks }) { setParkingSubs(pks ?? []); });
      });
  }, [selected]);

  // Load price tiers and build timeline when contract selected
  useEffect(function() {
    if (!selContract) { setPriceTiers([]); setPriceTimeline([]); return; }
    supabase.from("contract_price_tiers").select("*, spaces(space_name)")
      .eq("contract_id", selContract.id).is("option_id", null).order("tier_number")
      .then(function({ data: tiers }) {
        setRawTiersWithSpace(tiers ?? []);
        var loadedTiers: PriceTier[] = (tiers ?? []).map(function(t: any) {
          return {
            increase_type: t.increase_type ?? "pct",
            increase_value: Number(t.increase_value) || 0,
            from_year: t.from_year ?? 1,
            to_year: t.to_year ?? 3,
            is_recurring: t.is_recurring ?? false,
            recurring_every_years: t.recurring_every_years ?? (t.is_recurring ? 1 : null),
            calculated_rent_per_sqm: null,
            notes: t.notes ?? "",
          };
        });
        // Same fallback as the edit screen: contracts whose tier rows failed to
        // save still carry the full schedule on contracts.increase_steps.
        if (loadedTiers.length === 0 && Array.isArray((selContract as any).increase_steps)) {
          loadedTiers = ((selContract as any).increase_steps as any[]).map(function(t: any) {
            return {
              increase_type: t.increase_type ?? "pct",
              increase_value: Number(t.increase_value) || 0,
              from_year: t.from_year ?? 1,
              to_year: t.to_year ?? 3,
              is_recurring: t.is_recurring ?? false,
              recurring_every_years: t.recurring_every_years ?? (t.is_recurring ? 1 : null),
              calculated_rent_per_sqm: null,
              notes: t.notes ?? "",
            };
          });
        }
        setPriceTiers(loadedTiers);
        if (selContract.start_date && selContract.end_date) {
          var tl = buildPriceTimeline({
            contractStart: selContract.start_date,
            contractEnd: selContract.end_date,
            // A turnover lease has no rent_per_sqm — what steps over the years
            // is the MINIMUM, so that is the figure the timeline is built on.
            // Reading the empty column showed every period as ₪0.00.
            baseRentPerSqm: Number(selContract.rent_per_sqm)
              || Number(selContract.min_rent_per_sqm)
              || 0,
            mainTiers: loadedTiers,
            options: (selContract.contract_options ?? []).map(function(o: any) {
              return { ...o, price_schedule_type: o.price_schedule_type || "inherit", price_tiers: o.price_tiers || [] };
            }),
          });
          setPriceTimeline(tl);
        }
      });
  }, [selected]);

  // Revenue-% contracts: derive rent-per-sqm from reported turnover — the LATEST
  // month and the AVERAGE — using the stored final_rent (already net of the mgmt
  // fee and the minimum, exactly as the revenue screen computes it). No CPI
  // applies to revenue rent, so this is the equivalent of the CPI box for these
  // contracts. Mirrors the revenue page's principle, sourced from its data.
  useEffect(function() {
    var cancelled = false;
    if (!selContract || selContract.rent_type !== "revenue_pct") { setRevStats(null); return; }
    supabase.from("revenue_reports")
      .select("report_month, gross_revenue, final_rent")
      .eq("contract_id", selContract.id)
      .order("report_month", { ascending: true })
      .then(function({ data }: any) {
        if (cancelled) return;
        var rows = (data ?? []).filter(function(r: any){ return r.final_rent != null; });
        if (rows.length === 0) { setRevStats(null); return; }
        var area = Number(selContract.charged_area)
          || (selContract.contract_spaces || []).reduce(function(s: number, cs: any){ return s + (Number(cs.spaces?.area) || 0); }, 0)
          || 0;
        var sumFinal = rows.reduce(function(s: number, r: any){ return s + (Number(r.final_rent) || 0); }, 0);
        var avgFinal = sumFinal / rows.length;
        var latest = rows[rows.length - 1];
        var latestFinal = Number(latest.final_rent) || 0;
        setRevStats({
          area: area,
          count: rows.length,
          latestMonth: latest.report_month,
          latestFinal: latestFinal,
          latestPerSqm: area > 0 ? latestFinal / area : 0,
          avgFinal: avgFinal,
          avgPerSqm: area > 0 ? avgFinal / area : 0,
        });
      });
    return function(){ cancelled = true; };
  }, [selected]);

  // Load CPI-adjusted price via CBS calculator (server action — no CORS/auth issues).
  // Uses CURRENT rent per sqm (after step-rent) as the base for CPI.
  // Depends on priceTimeline to determine current-year rent.
  useEffect(function() {
    // Guard against out-of-order async results: when the contract/timeline
    // changes mid-fetch, the superseded run is cancelled so it can't overwrite
    // cpiResult with a stale rent base (which caused the calc/timeline mismatch).
    var cancelled = false;
    // Every early return has to clear the spinner too. It used to clear only
    // cpiResult, so selecting a contract that needs no calculation left the
    // previous contract's "מחשב יחס מדד..." running on screen forever.
    var resetCpi = function () { setCpiResult(null); setCpiLoading(false); setCpiProgress(null); };
    if (!selContract) { resetCpi(); setCpiPending(""); return; }
    if (selContract.indexation_method === "none") { resetCpi(); setCpiPending(""); return; }

    // A derived base index that hasn't been fixed yet: there is no base to link
    // from, so say so instead of computing against a placeholder date.
    if (baseIndexPending(selContract)) {
      resetCpi();
      setCpiPending(describeBaseIndexRule(baseIndexRuleFromRow(selContract), selContract));
      return;
    }
    setCpiPending("");

    // A turnover lease links its MINIMUM to the index — that is the figure to
    // adjust when there is no per-sqm rent.
    const origRent = Number(selContract.rent_per_sqm) || Number(selContract.min_rent_per_sqm);
    if (!origRent) { resetCpi(); return; }

    // Rent rate in effect TODAY. The timeline can have GAPS (a tier's period
    // ends before the next change/option begins — e.g. step rent stops at year 5
    // = ₪47 while the next option only starts years later). Requiring an exact
    // start≤now<end match returned no row in the gap and fell back to the YEAR-1
    // base (₪43) → the box showed 43×ratio instead of 47×ratio. Fix: carry
    // forward the LATEST period that has already started (the rate truly in
    // effect now), matching how the rent timeline reads.
    var currentRent = origRent;
    if (priceTimeline.length > 0) {
      var nowT = new Date().getTime();
      var bestStart = -Infinity;
      for (var i = 0; i < priceTimeline.length; i++) {
        var st = new Date(priceTimeline[i].startDate).getTime();
        if (st <= nowT && st >= bestStart && priceTimeline[i].rentPerSqm != null) {
          bestStart = st;
          currentRent = Number(priceTimeline[i].rentPerSqm);
        }
      }
    }

    const refDateStr = selContract.index_base_date || selContract.start_date;
    const baseDate = formatDateForCbs(refDateStr);
    if (!baseDate) { resetCpi(); return; }

    // True rent = current step-rent + investment per sqm
    const cpiInvestPerSqm = selContract.charged_area > 0 && selContract.investment_addition
      ? Number(selContract.investment_addition) / Number(selContract.charged_area)
      : 0;
    const totalRentPerSqm = currentRent + cpiInvestPerSqm;

    // Today's full date for CBS calculator (day matters for known-index)
    const todayForCbs = formatDateForCbs(new Date().toISOString());
    if (!todayForCbs) { resetCpi(); return; }

    setCpiLoading(true);
    var cpiCalcStart = Date.now();
    setCpiProgress({ current: 0, total: 0, label: "מחשב יחס מדד לחוזה...", startedAt: cpiCalcStart });

    // Known index months for fallback
    const knownFrom = getKnownIndexMonth(new Date(refDateStr));
    const knownTo = getKnownIndexMonth(new Date());
    const idxMethod = selContract.indexation_method || "standard";

    // For "highest_in_period" / "no_drop": find the highest CHAINED CPI
    // between base and today via CBS calculator. Scanning DB cpi_records by
    // raw value gives wrong peaks across base-year changes (Israeli CPI
    // re-bases every 2 years — raw values not comparable across bases).

    async function runCpiCalculation() {
      // For highest/no_drop methods, find peak CPI and use that as "current"
      if (idxMethod === "highest_in_period" || idxMethod === "no_drop") {
        var baseDateObj = new Date(refDateStr);
        var nowKnown = getKnownIndexMonth(new Date());
        var peak = await fetchHighestChainedCpi({
          baseFromDate: baseDate,
          scanFromYear: baseDateObj.getFullYear(),
          scanFromMonth: baseDateObj.getMonth() + 1,
          scanToYear: nowKnown.year,
          scanToMonth: nowKnown.month,
        });
        if (peak.success && peak.peakYear && peak.peakMonth) {
          // CBS t-2 rule: to make month X the "known" index, send date = month (X+1), day 16+
          var publishYear = peak.peakYear;
          var publishMonth = peak.peakMonth + 1;
          if (publishMonth > 12) { publishMonth = 1; publishYear++; }
          var highestDate = `${String(publishMonth).padStart(2, "0")}-16-${publishYear}`;
          var data = await fetchCpiAdjusted({ value: totalRentPerSqm, fromDate: baseDate, toDate: highestDate });
          if (data.success) {
            if (cancelled) return;
            setCpiResult({
              success: true, source: "cbs",
              baseRentPerSqm: data.baseRentPerSqm,
              currentRent: currentRent,
              adjustedRentPerSqm: data.adjustedRentPerSqm,
              changePct: data.changePct,
              fromDate: data.fromDate,
              toDate: `${peak.peakMonth}/${peak.peakYear} (שיא)`,
              fromIndexValue: data.fromIndexValue,
              toIndexValue: data.toIndexValue,
              baseYear: data.baseYear,
              verificationUrl: data.verificationUrl,
              method: idxMethod,
              peakMonth: `${peak.peakMonth}/${peak.peakYear}`,
              peakValue: data.toIndexValue,
            });
            setCpiLoading(false); setCpiProgress(null);
            return;
          }
        }
      }

      // Standard t-2: use today
      var stdData = await fetchCpiAdjusted({ value: totalRentPerSqm, fromDate: baseDate, toDate: todayForCbs });
      if (stdData.success) {
        if (cancelled) return;
        setCpiResult({
          success: true, source: "cbs",
          baseRentPerSqm: stdData.baseRentPerSqm,
          currentRent: currentRent,
          adjustedRentPerSqm: stdData.adjustedRentPerSqm,
          changePct: stdData.changePct,
          fromDate: stdData.fromDate,
          toDate: stdData.toDate,
          fromIndexValue: stdData.fromIndexValue,
          toIndexValue: stdData.toIndexValue,
          baseYear: stdData.baseYear,
          verificationUrl: stdData.verificationUrl,
          method: idxMethod,
        });
        setCpiLoading(false); setCpiProgress(null);
      } else {
        throw new Error("CBS failed");
      }
    }

    // Primary: CBS calculator via Server Action (server-side, bypasses Vercel auth)
    // Fallback: cumulative % chain from Supabase cpi_records
    runCpiCalculation()
      .then(function() {})
      .catch(function() {
        // Fallback: index ratio with chaining coefficient (same formula as CBS calculator)
        // Formula: adjusted = baseRent × (currentIndex × chainingCoeff) / baseIndex
        Promise.all([
          supabase.from("cpi_records").select("year,month,value,base_year")
            .eq("year", knownFrom.year).eq("month", knownFrom.month).single(),
          supabase.from("cpi_records").select("year,month,value,base_year")
            .eq("year", knownTo.year).eq("month", knownTo.month).single(),
          supabase.from("cpi_link_coefficients").select("from_base_year,to_base_year,coefficient")
        ]).then(function(results) {
          if (cancelled) return;
          var baseRec = results[0].data;
          var currentRec = results[1].data;
          var coefficients = results[2].data;
          if (!baseRec || !currentRec || !coefficients) { setCpiResult(null); setCpiLoading(false); setCpiProgress(null); return; }
          var baseIdx = Number(baseRec.value);
          var currentIdx = Number(currentRec.value);
          // Calculate chaining coefficient between base years
          var fromBaseYear = parseInt(String(currentRec.base_year));
          var toBaseYear = parseInt(String(baseRec.base_year));
          var chainingCoeff = calcChainingCoefficient(fromBaseYear, toBaseYear, coefficients);
          // CBS formula: adjusted = baseRent × (currentIndex × chainingCoeff) / baseIndex
          var adjustedRent = totalRentPerSqm * (currentIdx * chainingCoeff) / baseIdx;
          var changePct = ((currentIdx * chainingCoeff) / baseIdx - 1) * 100;
          setCpiResult({
            success: true, source: "local",
            baseRentPerSqm: Math.round(totalRentPerSqm * 100) / 100,
            currentRent: currentRent,
            adjustedRentPerSqm: Math.round(adjustedRent * 100) / 100,
            changePct: Math.round(changePct * 100) / 100,
            fromDate: `${knownFrom.month}/${knownFrom.year}`,
            toDate: `${knownTo.month}/${knownTo.year}`,
            fromIndexValue: baseIdx,
            toIndexValue: currentIdx,
            baseYear: baseRec.base_year || null,
            verificationUrl: null,
          });
          setCpiLoading(false); setCpiProgress(null);
        }).catch(function() { if (!cancelled) { setCpiResult(null); setCpiLoading(false); setCpiProgress(null); } });
      });
    return function() { cancelled = true; };
  }, [selected, priceTimeline]);

  // Per-unit CPI: compute CPI ratio per space (handles different CPI bases + indexation method)
  useEffect(function() {
    var cancelled = false;
    (async function() {
      try {
        if (!selContract) { setPerUnitCpi({}); return; }
        if (selContract.indexation_method === "none") { setPerUnitCpi({}); return; }

        var latAmend = amendments.length > 0 ? amendments[amendments.length - 1] : null;
        var curSpaces = latAmend?.contract_spaces?.length > 0
          ? latAmend.contract_spaces
          : (selContract.contract_spaces || []);
        if (!curSpaces || curSpaces.length === 0) { setPerUnitCpi({}); return; }

        var contractBaseDate = selContract.index_base_date || selContract.start_date;
        if (!contractBaseDate) { setPerUnitCpi({}); return; }

        var idxMethod = selContract.indexation_method || "standard";
        var useHighest = idxMethod === "highest_in_period" || idxMethod === "no_drop";

        var todayForCbs = formatDateForCbs(new Date().toISOString());
        if (!todayForCbs) { setPerUnitCpi({}); return; }

        // Group spaces by CPI base date
        var groups: Record<string, string[]> = {};
        var groupBaseDates: Record<string, string> = {}; // cbsDate -> rawDate
        curSpaces.forEach(function(cs: any) {
          if (!cs || !cs.space_id) return;
          var useCustom = cs.use_original_index === false && cs.index_base_date;
          var rawDate = useCustom ? cs.index_base_date : contractBaseDate;
          var cbsDate = formatDateForCbs(rawDate);
          if (!cbsDate) return;
          if (!groups[cbsDate]) groups[cbsDate] = [];
          groups[cbsDate].push(cs.space_id);
          groupBaseDates[cbsDate] = rawDate;
        });

        var groupKeys = Object.keys(groups);
        if (groupKeys.length === 0) { setPerUnitCpi({}); return; }

        // For each group, determine the precise ratio.
        // - Standard: 1 CBS call from base to today.
        // - Highest / no_drop: scan all months in period via CBS calculator
        //   to find the chained peak (raw-value comparison via cpi_records
        //   gives wrong peaks across base-year changes).
        var results = await Promise.all(groupKeys.map(async function(fromDate) {
          if (useHighest) {
            var rawBase = groupBaseDates[fromDate];
            var baseDateObj = new Date(rawBase);
            var nowKnown = getKnownIndexMonth(new Date());
            var peak = await fetchHighestChainedCpi({
              baseFromDate: fromDate,
              scanFromYear: baseDateObj.getFullYear(),
              scanFromMonth: baseDateObj.getMonth() + 1,
              scanToYear: nowKnown.year,
              scanToMonth: nowKnown.month,
            });
            if (peak.success && peak.peakRatio) {
              return { fromDate: fromDate, ratio: peak.peakRatio, source: "cbs" };
            }
            // Fall through to standard if peak scan fails
          }
          try {
            // Use 10000 instead of 1 to avoid rounding errors (CBS rounds to 2 decimals)
            var data: any = await fetchCpiAdjusted({ value: 10000, fromDate: fromDate, toDate: todayForCbs });
            if (!data || !data.success) return { fromDate: fromDate, ratio: 1, source: "error" };
            var preciseRatio = (Number(data.adjustedRentPerSqm) || 10000) / 10000;
            return { fromDate: fromDate, ratio: preciseRatio, source: "cbs" };
          } catch {
            return { fromDate: fromDate, ratio: 1, source: "fallback" };
          }
        }));

        var map: Record<string, {ratio: number, source: string}> = {};
        results.forEach(function(r: any, i: number) {
          var spaceIds = groups[groupKeys[i]] || [];
          spaceIds.forEach(function(sid: string) {
            map[sid] = { ratio: r.ratio, source: r.source };
          });
        });
        if (!cancelled) setPerUnitCpi(map);
      } catch (e) {
        console.error("perUnitCpi error:", e);
        if (!cancelled) setPerUnitCpi({});
      }
    })();
    return function() { cancelled = true; };
  }, [selected, amendments]);

  async function handleSync() {
    setSyncing(true);
    const n = await syncContractStatuses();
    await loadContracts();
    setSyncing(false);
    if (n>0) alert(`✅ עודכנו ${n} חוזים`);
  }

  async function handleExerciseOption(optionId: string, exercised: boolean) {
    // Update option status
    await supabase.from("contract_options").update({
      is_exercised: exercised,
      status: exercised ? "exercised" : "pending",
    }).eq("id", optionId);

    // Close the option's open notice alerts — the question is settled (alerts
    // re-appear via sync if the option is reverted to pending).
    if (exercised) {
      await supabase.from("alerts").update({ is_resolved: true, handled_at: new Date().toISOString() })
        .eq("entity_id", optionId).eq("is_resolved", false);
    }

    // Update contract end_date and status based on exercised options
    if (selContract) {
      const { data: opts } = await supabase.from("contract_options")
        .select("id,end_date,is_exercised,option_number")
        .eq("contract_id", selContract.id)
        .order("option_number");

      // Find the latest exercised option's end_date
      var lastExercised = (opts ?? []).filter(function(o: any) { return o.is_exercised; })
        .sort(function(a: any, b: any) { return b.option_number - a.option_number; })[0];

      if (lastExercised?.end_date) {
        // Extend contract to end of exercised option
        var newEnd = lastExercised.end_date;
        var today = new Date();
        var endDate = new Date(newEnd);
        var newStatus = today > endDate ? "ended" : today >= new Date(selContract.start_date) ? "active" : "upcoming";

        await supabase.from("contracts").update({
          end_date: newEnd,
          status: newStatus,
        }).eq("id", selContract.id);
      } else if (!exercised) {
        // All options cancelled — revert to original end date
        // Recalculate from start_date + lease_period
        // For now just sync statuses
      }
    }

    await loadContracts();
  }

  // Mark an option as NOT exercised. If the contract carries a non-exercise
  // compensation clause, the amount is computed here (area × ₪/sqm × months,
  // + CPI linkage, + VAT at the notice date) and raised as a charge the tenant
  // has to pay within the agreed number of days.
  async function handleDeclineOption(opt: any) {
    setDeclining(opt.id);
    try {
      const preview = await previewOptionDecline(opt.id);
      if (!preview) { alert("לא נמצאה האופציה"); return; }
      const { terms, calc } = preview;

      if (!calc) {
        if (!confirm("לסמן את אופציה " + opt.option_number + " כלא ממומשת?\n(לא הוגדר פיצוי על אי מימוש בהסכם — לא ייווצר חיוב)")) return;
      } else if (!calc.ok) {
        alert("לא ניתן לחשב את הפיצוי: " + (calc.error || "שגיאה לא ידועה"));
        return;
      } else {
        const lines = [
          "לסמן את אופציה " + opt.option_number + " כלא ממומשת ולחייב את השוכר בפיצוי?",
          "",
          terms.type === "per_sqm_month"
            ? "בסיס: " + terms.value + " ₪ למ\"ר × " + calc.area.toLocaleString("he-IL") + " מ\"ר × " + calc.months + " חודשים = " + fmtMoney(calc.rawBase)
            : "בסיס: " + fmtMoney(calc.rawBase),
          terms.indexed ? "הצמדה למדד: ×" + calc.cpiRatio.toFixed(4) + " → " + fmtMoney(calc.base) : "ללא הצמדה",
          terms.vat ? "מע\"מ " + Math.round(calc.vatPct * 100) + "%: " + fmtMoney(calc.vatAmount) : "ללא מע\"מ",
          "סה\"כ לתשלום: " + fmtMoney(calc.total),
          "מועד תשלום אחרון: " + fmtDate(calc.dueDate) + " (" + terms.days + " יום מההודעה)",
        ];
        if (!confirm(lines.join("\n"))) return;
      }

      // A funded investment repays its unearned months on an early exit — show
      // it before anything is written, it is often the larger of the two.
      if (preview.clawback && !preview.clawback.ok) {
        alert("לא ניתן לחשב את החזר ההשקעות: " + (preview.clawback.error || "שגיאה"));
        return;
      }
      if (preview.clawback?.ok && preview.clawback.total > 0) {
        const cb = preview.clawback;
        if (!confirm([
          "בנוסף, ההשקעה שמומנה מחייבת החזר בגין יציאה מוקדמת:",
          "",
          "השקעה " + fmtMoney(cb.fundedAmount) + " ÷ " + cb.commitmentMonths + " חודשי התחייבות = " + fmtMoney(cb.perMonth) + " לחודש",
          "נשכר " + cb.monthsRented + " חודשים · נותרו " + cb.monthsRemaining,
          cb.cpiRatio !== 1 ? "הצמדה: ×" + cb.cpiRatio.toFixed(4) : "ללא הצמדה",
          "סה\"כ להחזר: " + fmtMoney(cb.total),
        ].join("\n"))) return;
      }

      const res = await applyOptionDecline({ preview });
      if (!res.ok) { alert("שגיאה: " + (res.error || "לא ידוע")); return; }

      await loadContracts();
      if (calc?.ok) {
        alert("✅ האופציה סומנה כלא ממומשת ונוצר חיוב פיצוי על סך " + fmtMoney(calc.total)
          + (res.clawbackChargeId ? "\nכן נוצר חיוב החזר השקעות על סך " + fmtMoney(preview.clawback?.total || 0) : "")
          + ".\nניתן לשלוח אותם לשוכר ממסך החיובים.");
      }
    } finally {
      setDeclining(null);
    }
  }

  const filtered = contracts.filter(function(c) {
    if (c.is_amendment) return false; // Hide amendments from sidebar
    var ms = false;
    if (filterSt === "all") ms = true;
    else if (filterSt === "active") ms = c.status === "active" || c.status === "extended" || c.status === "expiring";
    else if (filterSt === "ended") ms = c.status === "ended";
    else if (filterSt === "upcoming") ms = c.status === "upcoming";
    else ms = c.status === filterSt;
    const mp = filterProp === "all" || c.property_id === filterProp;
    const mq = !search || c.tenants?.name?.includes(search) || c.properties?.name?.includes(search);
    return ms && mp && mq;
  });

  // Unique properties from contracts for the filter dropdown
  const propertyOptions = (function() {
    var seen: Record<string, string> = {};
    contracts.forEach(function(c) {
      if (c.property_id && c.properties?.name && !seen[c.property_id]) {
        seen[c.property_id] = c.properties.name;
      }
    });
    return Object.entries(seen).sort(function(a,b){return a[1].localeCompare(b[1]);});
  })();

  // ═══ EFFECTIVE STATE: latest amendment overrides original contract ═══
  // If amendments exist, use the latest one for spaces/pricing/dates
  var latestAmendment = amendments.length > 0 ? amendments[amendments.length - 1] : null;
  var effectiveSpaces = latestAmendment?.contract_spaces?.length > 0
    ? latestAmendment.contract_spaces
    : (selContract?.contract_spaces ?? []);
  var effectiveEndDate = latestAmendment?.end_date || selContract?.end_date;
  var effectiveRentPerSqm = latestAmendment?.rent_per_sqm ?? selContract?.rent_per_sqm ?? 0;
  var effectiveArea = latestAmendment?.charged_area ?? selContract?.charged_area ?? 0;

  const investPerSqm = selContract && effectiveArea > 0 && selContract.investment_addition
    ? Math.round(selContract.investment_addition / effectiveArea * 100) / 100 : 0;
  const originalRentPerSqm = Number(effectiveRentPerSqm) || 0;

  // Current rent per sqm based on contract year (step-rent mechanism)
  // Search BACKWARDS so option entries (which come after main) take priority
  // when their date range overlaps with the original main period
  var currentRentPerSqm = originalRentPerSqm;
  var currentContractYear = 0;
  var currentInOption = false;
  var currentOptionLabel = "";
  if (selContract?.start_date && priceTimeline.length > 0) {
    var now = new Date();
    for (var i = priceTimeline.length - 1; i >= 0; i--) {
      var entry = priceTimeline[i];
      if (new Date(entry.startDate) <= now && new Date(entry.endDate) > now) {
        currentRentPerSqm = entry.rentPerSqm ?? originalRentPerSqm;
        currentContractYear = i + 1;
        if (entry.source && entry.source.toString().startsWith("option")) {
          currentInOption = true;
          currentOptionLabel = entry.label || "אופציה";
        }
        break;
      }
    }
  }
  const trueRentPerSqm = currentRentPerSqm + investPerSqm;
  // Calculate baseRent from EFFECTIVE spaces (latest amendment or original)
  var baseRent = 0;
  if (selContract) {
    var hasPerUnitPricing = effectiveSpaces.some(function(cs: any) { return cs.charge_method === "fixed" || cs.price_per_sqm; });
    if (hasPerUnitPricing && !effectiveRentPerSqm) {
      effectiveSpaces.forEach(function(cs: any) {
        if (cs.charge_method === "fixed" && cs.fixed_rent) baseRent += Number(cs.fixed_rent);
        else baseRent += (Number(cs.price_per_sqm) || 0) * (cs.spaces?.area || 0);
      });
    } else if (effectiveSpaces.length > 0 && effectiveSpaces.some(function(cs: any){ return cs.price_per_sqm; })) {
      effectiveSpaces.forEach(function(cs: any) {
        if (cs.charge_method === "fixed" && cs.fixed_rent) baseRent += Number(cs.fixed_rent);
        else baseRent += (Number(cs.price_per_sqm) || trueRentPerSqm) * (cs.spaces?.area || 0);
      });
    } else {
      baseRent = trueRentPerSqm * (effectiveArea || 0);
    }
  }
  // Original contract rent for comparison
  var originalBaseRent = 0;
  if (selContract && latestAmendment) {
    (selContract.contract_spaces || []).forEach(function(cs: any) {
      if (cs.charge_method === "fixed" && cs.fixed_rent) originalBaseRent += Number(cs.fixed_rent);
      else originalBaseRent += (Number(cs.price_per_sqm) || Number(selContract.rent_per_sqm) || 0) * (cs.spaces?.area || 0);
    });
    if (originalBaseRent === 0) originalBaseRent = (Number(selContract.rent_per_sqm) || 0) * (Number(selContract.charged_area) || 0);
  }
  // Step-rent multiplier: ratio of current year rent vs base rent.
  // NOTE: this is a contract-level, per-sqm, MULTIPLICATIVE ratio. It is kept
  // ONLY for coarse labels (e.g. the "year N" badge). It CANNOT represent
  // per-space additive (fixed_total) tiers, so it must NEVER be used to compute
  // actual money — use unitSteppedMonthly() for that. (Bug: floor 1/2 had a
  // per-space +₪1,000/yr fixed_total tier the multiplier silently dropped,
  // indexing ₪38,000 instead of the stepped ₪42,000.)
  var stepRentMultiplier = 1;
  if (originalRentPerSqm > 0 && currentRentPerSqm > 0 && currentRentPerSqm !== originalRentPerSqm) {
    stepRentMultiplier = currentRentPerSqm / originalRentPerSqm;
  }

  // SINGLE SOURCE OF TRUTH for a unit's current (stepped, pre-CPI) monthly rent.
  // Uses the documented per-space rent schedule — the SAME function billing
  // (AdvancesTab/CpiDiffTab) uses — so per-space additive (fixed_total) and
  // recurring tiers, plus exercised options, are applied for EVERY contract,
  // not just simple per-sqm ones. Every "current rent" computation on this page
  // routes through here so the contract total, the per-unit breakdown and
  // billing can never silently disagree again.
  function unitSteppedMonthly(cs: any): number {
    var isFx = cs.charge_method === "fixed";
    var area = cs.spaces?.area || 0;
    var raw = isFx
      ? (Number(cs.fixed_rent) || 0)
      : (Number(cs.price_per_sqm) || Number(effectiveRentPerSqm) || 0) * area;
    if (!selContract) return raw;
    var sched = buildSpaceRentSchedule({
      contractStartDate: selContract.start_date,
      spaceArea: area,
      isFixed: isFx,
      spaceBaseRent: raw,
      spaceTiers: rawTiersWithSpace.filter(function(t: any){ return t.space_id === cs.space_id; }),
      contractTiers: rawTiersWithSpace.filter(function(t: any){ return !t.space_id; }),
      exercisedOptions: selContract.contract_options || [],
    });
    return rentAtDate(sched, new Date());
  }

  // Contract-level stepped total — summed from the canonical per-unit schedule
  // (NOT the multiplier) so per-space steps are reflected in the headline total.
  var adjustedBaseRent = 0;
  if (selContract && effectiveSpaces.length > 0) {
    effectiveSpaces.forEach(function(cs: any) {
      adjustedBaseRent += unitSteppedMonthly(cs);
    });
  }
  if (adjustedBaseRent === 0) adjustedBaseRent = baseRent;

  // Apply per-unit CPI to get fully adjusted rent
  var cpiAdjustedRent = 0;
  if (Object.keys(perUnitCpi).length > 0 && effectiveSpaces.length > 0) {
    effectiveSpaces.forEach(function(cs: any) {
      var stepped = unitSteppedMonthly(cs);
      var cpiRatio = perUnitCpi[cs.space_id]?.ratio || 1;
      cpiAdjustedRent += stepped * cpiRatio;
    });
  }

  // Use the best available rent for display
  // Sum parking subscriptions (only those NOT included in rent)
  var parkingMonthlyTotal = 0;
  parkingSubs.forEach(function(p: any) {
    if (p.is_included_in_rent) return;
    if (p.subscription_type === "visitor") return; // visitor parking has no fixed monthly fee
    parkingMonthlyTotal += (Number(p.monthly_fee) || 0) * (Number(p.quantity) || 1);
  });
  // A turnover lease has no per-sqm rent, so every figure above lands on 0 and
  // the KPIs read ₪0.00 for a contract that collects a guaranteed minimum. Fall
  // back to the floor — labelled as such in the box below.
  var revenueFloorMonthly = selContract?.rent_type === "revenue_pct"
    ? (Number(selContract?.min_rent_per_sqm) || 0) * (Number(selContract?.charged_area) || 0) || (Number(selContract?.minimum_rent) || 0)
    : 0;
  var rentBeforeParking = cpiAdjustedRent > 0 ? cpiAdjustedRent : adjustedBaseRent > 0 ? adjustedBaseRent : (baseRent || revenueFloorMonthly);
  var displayRent = rentBeforeParking + parkingMonthlyTotal;
  const vat         = selContract?.vat_type==="taxable" ? displayRent*vatPct : 0;
  const remaining   = effectiveEndDate ? yearsMonthsLeft(effectiveEndDate) : null;

  const counts: Record<string,number> = { active: 0, upcoming: 0, ended: 0 };
  contracts.filter(function(c) { return !c.is_amendment; }).forEach(function(c){
    if (c.status === "active" || c.status === "extended" || c.status === "expiring") counts.active++;
    else if (c.status === "upcoming") counts.upcoming++;
    else if (c.status === "ended") counts.ended++;
  });

  // Helper: delete all related data for a single contract ID
  async function deleteContractData(cid: string) {
    await supabase.from("parking_subscriptions").delete().eq("contract_id", cid);
    await supabase.from("alerts").delete().eq("contract_id", cid);
    await supabase.from("charges").delete().eq("contract_id", cid);
    await supabase.from("contract_spaces").delete().eq("contract_id", cid);
    await supabase.from("contract_options").delete().eq("contract_id", cid);
    await supabase.from("contract_price_tiers").delete().eq("contract_id", cid);
    await supabase.from("contract_ti").delete().eq("contract_id", cid);
    await supabase.from("documents").delete().eq("contract_id", cid);
    await supabase.from("guarantees").delete().eq("contract_id", cid);
    await supabase.from("insurances_tenant").delete().eq("contract_id", cid);
    await supabase.from("letters").delete().eq("contract_id", cid);
    await supabase.from("management_fees").delete().eq("contract_id", cid);
    await supabase.from("revenue_reports").delete().eq("contract_id", cid);
  }

  async function handleDeleteContract(contractId: string) {
    // Check if this is a base contract with amendments
    var { data: childAmendments } = await supabase.from("contracts")
      .select("id").eq("parent_contract_id", contractId).eq("is_amendment", true);
    var amendCount = (childAmendments || []).length;
    var msg = amendCount > 0
      ? "למחוק חוזה + " + amendCount + " תוספות? כל החיובים, ערבויות, ביטוחים, חניות ומכתבים של החוזה והתוספות שלו יימחקו!"
      : "למחוק חוזה? כל החיובים, ערבויות, ביטוחים, חניות ומכתבים שלו יימחקו!";
    if (!confirm(msg)) return;
    try {
      // Collect ALL space IDs (base + amendments) for status reset
      var allIds = [contractId, ...(childAmendments || []).map(function(a: any) { return a.id; })];
      var { data: linkedSpaces } = await supabase.from("contract_spaces").select("space_id").in("contract_id", allIds);
      var spaceIds = (linkedSpaces || []).map(function(r: any) { return r.space_id; });

      // Delete ALL amendments first, then the base
      for (var amend of (childAmendments || [])) {
        await deleteContractData(amend.id);
        await supabase.from("contracts").delete().eq("id", amend.id);
      }
      // Delete base contract data
      await deleteContractData(contractId);
      var { error } = await supabase.from("contracts").delete().eq("id", contractId);
      if (error) throw error;

      // Free spaces — but ONLY if they have no other active contracts
      if (spaceIds.length > 0) {
        var uniqueSpaceIds = Array.from(new Set(spaceIds));
        var { data: stillUsed } = await supabase.from("contract_spaces")
          .select("space_id, contracts!inner(status)")
          .in("space_id", uniqueSpaceIds)
          .in("contracts.status", ["active", "extended", "upcoming"]);
        var stillUsedIds = new Set((stillUsed || []).map(function(r: any) { return r.space_id; }));
        var toFree = uniqueSpaceIds.filter(function(sid) { return !stillUsedIds.has(sid); });
        if (toFree.length > 0) {
          await supabase.from("spaces").update({ status: "vacant" }).in("id", toFree);
        }
      }
      await logAudit({ entity_type: "contract", entity_id: contractId, action: "delete" });
      setSelected(null);
      await loadContracts();
    } catch (e: any) { alert("שגיאה במחיקה: " + e?.message); }
  }

  return (
    <div dir="rtl">
      <PageHero title="חוזים" icon="📄" tone="violet"
        subtitle={contracts.filter(function(c){return !c.is_amendment;}).length + " חוזים"}
        actions={
          <>
            <button onClick={handleSync} disabled={syncing}
              className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-sm text-white hover:bg-white/25 disabled:opacity-50">
              {syncing?"⏳ מסנכרן...":"🔄 סנכרן סטטוסים"}
            </button>
            <button onClick={function(){router.push("/contracts/new");}} className="rounded-xl bg-white text-violet-700 px-4 py-2 text-sm font-bold hover:bg-violet-50 shadow-sm">
              + חוזה חדש
            </button>
          </>
        } />

      {/* Status filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{v:"all",l:"הכל"},{v:"active",l:"פעיל"},{v:"upcoming",l:"עתידי"},{v:"ended",l:"הסתיים"}].map(function(s) {
          const cnt = s.v==="all" ? contracts.filter(function(c){return !c.is_amendment;}).length : (counts[s.v]??0);
          const si  = STATUS_MAP[s.v];
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all " +
                (filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {si && <span className={"w-2 h-2 rounded-full "+si.dot}/>}
              {s.l}
              <span className="bg-slate-100 text-slate-500 rounded-full px-1.5 text-[10px] font-bold">{cnt}</span>
            </button>
          );
        })}
        <select value={filterProp} onChange={function(e){setFilterProp(e.target.value);}}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs mr-auto">
          <option value="all">🏢 כל הנכסים</option>
          {propertyOptions.map(function(p) {
            return <option key={p[0]} value={p[0]}>{p[1]}</option>;
          })}
        </select>
        <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
          placeholder="חיפוש שוכר / נכס..."
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs"/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* List — on mobile, hidden once a contract is selected (the detail
            takes over full-screen); on desktop both columns always show. */}
        <div className={(selected ? "hidden lg:block " : "") + "lg:col-span-2 space-y-2 lg:max-h-[70vh] lg:overflow-y-auto pl-1"}>
          {loading ? <div className="text-center py-8 text-slate-400">טוען...</div> : filtered.length===0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400">
              <div className="text-4xl mb-2">📄</div><div>אין חוזים</div>
            </div>
          ) : filtered.map(function(c) {
            const si   = STATUS_MAP[c.status] ?? STATUS_MAP.ended;
            // Find latest amendment for this contract to show effective rent
            var cAmends = contracts.filter(function(a){return a.parent_contract_id===c.id && a.is_amendment;}).sort(function(a,b){return (a.amendment_number||0)-(b.amendment_number||0);});
            var cEffSpaces = cAmends.length > 0 && cAmends[cAmends.length-1].contract_spaces?.length > 0
              ? cAmends[cAmends.length-1].contract_spaces : c.contract_spaces;
            var cEffEnd = cAmends.length > 0 ? (cAmends[cAmends.length-1].end_date || c.end_date) : c.end_date;
            var mon = 0;
            if (cEffSpaces?.length > 0) {
              cEffSpaces.forEach(function(cs: any) {
                if (cs.charge_method === "fixed" && cs.fixed_rent) mon += Number(cs.fixed_rent);
                else mon += (Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0) * (cs.spaces?.area || 0);
              });
            }
            // A turnover lease has no per-sqm rent — showing ₪0.00/חודש made it
            // look like it collects nothing. Fall back to its guaranteed floor.
            if (mon === 0) mon = (c.rent_per_sqm??0)*(c.charged_area??0);
            if (mon === 0) mon = (Number(c.min_rent_per_sqm)||0)*(Number(c.charged_area)||0) || (Number(c.minimum_rent)||0);
            mon += (c.investment_addition??0);
            const rem  = cEffEnd ? yearsMonthsLeft(cEffEnd) : null;
            const isSel = selected===c.id;
            return (
              <div key={c.id} onClick={function(){setSelected(isSel?null:c.id);}}
                className={"rounded-xl border p-3 cursor-pointer transition-all " +
                  (isSel?"border-blue-500 bg-blue-50 shadow-sm":"border-slate-200 bg-white hover:shadow-sm")}>
                <div className="flex items-start justify-between mb-1">
                  <div className="font-semibold text-slate-800 text-sm">{c.tenants?.name}</div>
                  <span className={"text-xs px-2 py-0.5 rounded-full font-semibold "+si.color}>{si.label}</span>
                </div>
                <div className="text-xs text-slate-400">
                  {c.properties?.name}
                  {cEffSpaces?.length > 0 && (
                    <span className="text-slate-300"> — {cEffSpaces.map(function(cs: any) { return cs.spaces?.space_name; }).filter(Boolean).join(", ")}</span>
                  )}
                  {cAmends.length > 0 && <span className="text-yellow-500 mr-1"> ({cAmends.length} תוספות)</span>}
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs font-semibold text-green-700">{fmtMoney(mon)}/חודש</span>
                  {(function(){
                    // A contract that hasn't started yet has no "time left" —
                    // showing 7 שנים ו-1 חודש (the gap from today) read as if
                    // that were the agreed term. Show the term itself.
                    var notStarted = c.start_date && new Date(c.start_date) > new Date();
                    if (notStarted) {
                      var pv = Number(c.lease_period_value) || 0;
                      var yrs = c.lease_period_unit === "years" ? pv : (pv % 12 === 0 ? pv / 12 : 0);
                      var termTxt = yrs > 0 ? yrs + " שנים" : (pv > 0 ? pv + " חודשים" : "");
                      var fromTxt = c.actual_handover_date ? "מהמסירה" : (c.planned_handover_date ? "ממועד המסירה" : "מתחילת השכירות");
                      return termTxt ? (
                        <span className="text-xs font-semibold text-slate-500" title={"טרם החל — תחילת שכירות " + new Date(c.start_date).toLocaleDateString("he-IL")}>
                          {termTxt} {fromTxt}
                        </span>
                      ) : null;
                    }
                    return rem && !rem.isExpired ? (
                      <span className={"text-xs font-semibold " + (rem.years < 1 ? "text-red-600" : rem.years < 2 ? "text-yellow-600" : "text-slate-500")}
                        title="הזמן שנותר עד תום החוזה">
                        נותרו {rem.text}
                      </span>
                    ) : null;
                  })()}
                  {rem?.isExpired && <span className="text-xs font-bold text-red-600">פג!</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Details — on mobile, shown only when a contract is selected. */}
        <div className={(selected ? "" : "hidden lg:block ") + "lg:col-span-3"}>
          {!selContract ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">📄</div><div>בחר חוזה לצפייה</div>
            </div>
          ) : (
            <div className="space-y-3">
              <button onClick={function(){setSelected(null);}} className="lg:hidden flex items-center gap-1 text-sm font-semibold text-blue-600 -mb-1">→ חזרה לרשימת החוזים</button>
              {/* Header */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 cursor-pointer hover:underline hover:text-blue-700" onClick={function(){router.push("/tenants");}}>{selContract.tenants?.name} <span className="text-sm font-normal text-blue-500">→</span></h2>
                    <div className="text-sm text-slate-500 cursor-pointer hover:underline hover:text-blue-600" onClick={function(){router.push("/properties");}}>{selContract.properties?.name}{selContract.properties?.city?" — "+selContract.properties.city:""} <span className="text-blue-400">→</span></div>
                    {selContract.tenants?.company_name&&<div className="text-xs text-slate-400">{selContract.tenants.company_name}</div>}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={function(){router.push("/contracts/"+selContract.id+"/edit");}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={function(){router.push("/contracts/"+selContract.id+"/print");}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">🖨 הדפס</button>
                    <button onClick={function(){router.push("/documents?contract="+selContract.id);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50" title="כל המסמכים של החוזה — סריקה, ערבויות, ביטוחים, העלאות">📁 מסמכים</button>
                    {/* A contract handed over in stages can't start calculating
                        until the real handover date is known. Surfaced here so it
                        doesn't require re-opening the whole wizard. */}
                    {(selContract.planned_handover_date || selContract.actual_handover_date) && (
                      <button onClick={function(){
                          setHandoverDate((selContract.actual_handover_date || selContract.planned_handover_date || "").slice(0,10));
                          setShowHandover(true);
                        }}
                        className={"rounded-lg border px-3 py-1.5 text-xs font-semibold " + (selContract.actual_handover_date
                          ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                          : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 animate-pulse")}
                        title="הזנת מועד המסירה בפועל — ממנה מתחילה תקופת השכירות וכל החישובים">
                        {selContract.actual_handover_date
                          ? "📦 נמסר " + new Date(selContract.actual_handover_date).toLocaleDateString("he-IL")
                          : "📦 הזן מסירה בפועל"}
                      </button>
                    )}
                    {selContract.document_url && (
                      <a href={selContract.document_url} target="_blank" rel="noopener noreferrer"
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-100">📄 צפה בחוזה</a>
                    )}
                    {!selContract.is_amendment && (
                      <button onClick={function(){
                        setShowAmendModal(true);
                        setAmendType(null);
                        setAmendDate(new Date().toISOString().split("T")[0]);
                        setAmendNotes("");
                        setAmendDocUrl("");
                        setAmendRemoveSpaces([]);
                        setAmendAddSpaces([]);
                        setAmendAddRents({});
                        setAmendCpiMode({});
                        setAmendCpiValue({});
                        setAmendCpiDate({});
                        setAmendNewEndDate(selContract.end_date || "");
                        // Init price changes from EFFECTIVE spaces (latest amendment or original)
                        var pc: Record<string,string> = {};
                        effectiveSpaces.forEach(function(cs: any) {
                          pc[cs.space_id] = String(cs.charge_method === "fixed" ? (cs.fixed_rent||0) : (cs.price_per_sqm || effectiveRentPerSqm || 0));
                        });
                        setAmendPriceChanges(pc);
                        // Load all property spaces
                        supabase.from("spaces").select("id,space_name,area,status")
                          .eq("property_id", selContract.property_id).order("space_name")
                          .then(function({data}) { setAllPropertySpaces(data??[]); });
                      }}
                        className="rounded-lg border border-yellow-400 bg-yellow-50 px-3 py-1.5 text-xs font-semibold text-yellow-700 hover:bg-yellow-100">📝 תוספת להסכם</button>
                    )}
                    <button onClick={()=>selected && handleDeleteContract(selected)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 hover:bg-red-100 font-semibold">🗑 מחק</button>
                  </div>
                </div>

                {/* Amendment state indicator */}
                {latestAmendment && (
                  <div className="rounded-lg bg-yellow-50 border border-yellow-300 px-3 py-2 mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-yellow-600">📝</span>
                      <span className="text-sm font-bold text-yellow-800">מצב אחרי תוספת {latestAmendment.amendment_number}</span>
                      <span className="text-xs text-yellow-600">({fmtDate(latestAmendment.amendment_date || latestAmendment.start_date)})</span>
                    </div>
                    {originalBaseRent > 0 && originalBaseRent !== baseRent && (
                      <span className="text-xs text-slate-500">לפני: {fmtMoney(originalBaseRent)}/חודש</span>
                    )}
                  </div>
                )}

                {/* Cross-swap indicators */}
                {amendments.filter(function(am: any) { return (am.amendment_notes || "").includes("החלפה צולבת"); }).map(function(am: any) {
                  var noteMatch = (am.amendment_notes || "").match(/החלפה צולבת עם (.+?):\s*(.+?)\s*→\s*(.+)/);
                  if (!noteMatch) return null;
                  var otherTenant = noteMatch[1];
                  var spacesOut = noteMatch[2];
                  var spacesIn = noteMatch[3];
                  return (
                    <div key={am.id} className="rounded-lg bg-indigo-50 border border-indigo-300 px-3 py-2 mb-3">
                      <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm mb-1">
                        <span>🔄</span>
                        <span>החלפת יחידות עם {otherTenant}</span>
                        <span className="text-xs font-normal text-indigo-500">({fmtDate(am.amendment_date || am.start_date)})</span>
                      </div>
                      <div className="text-xs text-indigo-600 flex items-center gap-2">
                        <span className="bg-red-100 text-red-700 rounded px-1.5 py-0.5">⬅ יצא: {spacesOut}</span>
                        <span className="text-indigo-400">⇄</span>
                        <span className="bg-green-100 text-green-700 rounded px-1.5 py-0.5">➡ נכנס: {spacesIn}</span>
                      </div>
                    </div>
                  );
                })}

                {/* Overlap warning */}
                {spaceOverlaps.length > 0 && (
                  <div className="rounded-lg bg-red-50 border border-red-300 px-3 py-2 mb-3">
                    <div className="flex items-center gap-2 text-red-700 font-bold text-sm mb-1">
                      <span>⚠️</span>
                      <span>יחידות עם חוזה פעיל חופף!</span>
                    </div>
                    <div className="text-xs text-red-600 space-y-0.5">
                      {spaceOverlaps.map(function(o: any, idx: number) {
                        var spaceName = (effectiveSpaces || []).find(function(cs: any){return cs.space_id === o.space_id;})?.spaces?.space_name
                          || (selContract.contract_spaces || []).find(function(cs: any){return cs.space_id === o.space_id;})?.spaces?.space_name
                          || o.space_id;
                        return <div key={idx}>{spaceName} — גם בחוזה: {o.contracts.tenants?.name || "—"} (עד {fmtEndDate(o.contracts.end_date, o.contracts.start_date)})</div>;
                      })}
                    </div>
                  </div>
                )}

                {/* KPI — redesigned */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div className="rounded-xl p-2.5 text-center border border-green-200 bg-green-50">
                    <div className="text-base text-green-800 font-bold">{fmtMoney(displayRent)}</div>
                    <div className="text-xs text-green-600">
                      {selContract.rent_type === "revenue_pct" && cpiAdjustedRent === 0 && adjustedBaseRent === 0 && baseRent === 0
                        ? "מינימום" : cpiAdjustedRent > 0 ? "כולל הצמדה" : "בסיס"}
                    </div>
                  </div>
                  <div className="rounded-xl p-2.5 text-center border border-slate-100">
                    <div className="text-base text-slate-500">{fmtMoney(vat)}</div>
                    <div className="text-xs text-slate-400">מע&quot;מ</div>
                  </div>
                  <div className="rounded-xl p-2.5 text-center border border-blue-200 bg-blue-50">
                    <div className="text-base text-blue-700 font-black">{fmtMoney(displayRent+vat)}</div>
                    <div className="text-xs text-blue-500">סה&quot;כ</div>
                  </div>
                  <div className={"rounded-xl p-2.5 text-center border " + (remaining?.isExpired ? "border-red-200 bg-red-50" : remaining && remaining.years < 1 ? "border-orange-200 bg-orange-50" : "border-green-200 bg-green-50")}>
                    <div className={"text-sm font-bold " + (remaining?.isExpired ? "text-red-600" : remaining && remaining.years < 1 ? "text-orange-600" : "text-green-700")}>
                      {remaining?.text ?? "—"}
                    </div>
                    <div className="text-xs text-slate-400">עד {fmtEndDate(effectiveEndDate, selContract.start_date)}</div>
                  </div>
                </div>

                {/* Revenue-based rent display */}
                {selContract.rent_type === "revenue_pct" && (
                  <div className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-3 mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-purple-800">📊 שכ&quot;ד לפי מחזור</span>
                      <span className="text-lg font-black text-purple-800">
                        {(function(){
                          var pt = pctTiersFromRow(selContract);
                          return pt.length > 0 ? describePctTiers(Number(selContract.revenue_pct) || 0, pt) : selContract.revenue_pct + "%";
                        })()}
                      </span>
                    </div>
                    <div className="text-sm text-purple-600">
                      {/* The floor lives in min_rent_per_sqm when it was agreed
                          per sqm — reading only minimum_rent said "no minimum"
                          for a contract that has one. */}
                      {Number(selContract.min_rent_per_sqm) > 0
                        ? `מינימום: ${fmtMoney(Number(selContract.min_rent_per_sqm))}/מ"ר לחודש` +
                          (Number(selContract.charged_area) > 0
                            ? ` · ${fmtMoney(Number(selContract.min_rent_per_sqm) * Number(selContract.charged_area))}/חודש`
                            : "")
                        : Number(selContract.minimum_rent) > 0
                          ? `מינימום: ${fmtMoney(Number(selContract.minimum_rent))}/חודש`
                          : "ללא מינימום — רק אחוז ממחזור"}
                    </div>
                    {selContract.revenue_report_day && (
                      <div className="text-xs text-purple-500 mt-1">דו&quot;ח פדיון עד ה-{selContract.revenue_report_day} לכל חודש</div>
                    )}

                    {/* Rent-per-sqm from turnover (net of mgmt) — the revenue
                        equivalent of the CPI box: latest month + running average. */}
                    {revStats ? (
                      <div className="mt-2 pt-2 border-t border-purple-200">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-white border border-purple-200 p-2.5 text-center">
                            <div className="text-lg font-black text-purple-900">{fmtMoney(revStats.latestPerSqm)}/מ&quot;ר</div>
                            <div className="text-[10px] text-purple-600">לפי פדיון אחרון{revStats.latestMonth ? " (" + new Date(revStats.latestMonth).toLocaleDateString("he-IL", {month: "short", year: "numeric"}) + ")" : ""}</div>
                          </div>
                          <div className="rounded-lg bg-white border border-purple-200 p-2.5 text-center">
                            <div className="text-lg font-black text-purple-900">{fmtMoney(revStats.avgPerSqm)}/מ&quot;ר</div>
                            <div className="text-[10px] text-purple-600">ממוצע ({revStats.count} דו&quot;חות)</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-purple-600 mt-1.5">
                          <div className="flex justify-between"><span>שכ&quot;ד נטו אחרון/חודש:</span><span className="font-semibold">{fmtMoney(revStats.latestFinal)}</span></div>
                          <div className="flex justify-between"><span>שכ&quot;ד נטו ממוצע/חודש:</span><span className="font-semibold">{fmtMoney(revStats.avgFinal)}</span></div>
                          <div className="flex justify-between"><span>שטח מחויב:</span><span className="font-semibold">{revStats.area} מ&quot;ר</span></div>
                          <div className="flex justify-between"><span className="text-purple-400">בניקוי דמי ניהול · ללא הצמדה</span><span></span></div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 pt-2 border-t border-purple-200 text-[11px] text-purple-400">אין עדיין דו&quot;חות פדיון — שכ&quot;ד למ&quot;ר יוצג לאחר דיווח ראשון.</div>
                    )}
                  </div>
                )}

                {/* Early termination clause */}
                {selContract.early_termination_allowed && (
                  <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 mb-2 flex items-center justify-between text-sm">
                    <span className="text-orange-700 font-bold">⚠️ סיום מוקדם בהודעה</span>
                    <span className="text-orange-800">
                      {selContract.termination_notice_days} ימים מראש
                      {selContract.termination_by === "landlord" ? " (משכיר)" : selContract.termination_by === "tenant" ? " (שוכר)" : " (שני הצדדים)"}
                    </span>
                  </div>
                )}

                {/* Current rent per sqm (with step-rent + investment) */}
                {selContract.rent_type !== "revenue_pct" && trueRentPerSqm > 0 ? (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 mb-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">
                        שכ&quot;ד נוכחי למ&quot;ר
                        {currentContractYear > 0 && <span className="text-blue-500"> (שנה {currentContractYear})</span>}
                        {investPerSqm > 0 && <span className="text-purple-600 font-semibold" title="תוספת שכ&quot;ד בגין השקעות בינוי שביצע המשכיר במושכר"> + תוספת השקעות בינוי {fmtMoney(investPerSqm)}</span>}
                      </span>
                      <span className="font-black text-slate-800">{fmtMoney(trueRentPerSqm)}/מ&quot;ר</span>
                    </div>
                    {currentRentPerSqm !== originalRentPerSqm && (
                      <div className="flex items-center justify-between text-slate-400">
                        <span>שכ&quot;ד מקורי (שנה 1)</span>
                        <span>₪{originalRentPerSqm.toFixed(2)}/מ&quot;ר</span>
                      </div>
                    )}
                  </div>
                ) : selContract.contract_spaces?.length > 0 ? (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 mb-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">שכ&quot;ד חודשי (מחיר לפי יחידה)</span>
                      <span className="font-black text-slate-800">{fmtMoney(displayRent)}/חודש</span>
                    </div>
                  </div>
                ) : null}

                {/* CPI-adjusted price via CBS calculator */}
                {cpiPending && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 leading-relaxed">
                    <div className="font-bold">⏳ מדד הבסיס עדיין לא נקבע — תלוי במועד המסירה</div>
                    <div className="mt-0.5">{cpiPending}</div>
                    <div className="mt-1 text-amber-700">
                      עד להזנת מועד המסירה בפועל לא מתבצע חישוב הצמדה לחוזה. הזן &quot;📦 מסירה בפועל&quot; — מדד הבסיס ייקבע לפי הכלל, וההצמדה תתחיל להיחשב.
                    </div>
                  </div>
                )}
                {cpiLoading && cpiProgress && (
                  <div className="mb-3">
                    <CalcProgress {...cpiProgress} />
                  </div>
                )}
                {cpiLoading && !cpiProgress && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-3 text-xs text-amber-600 animate-pulse">
                    📊 מחשב הצמדה למדד (API למ&quot;ס)...
                  </div>
                )}
                {cpiResult && !cpiLoading && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 mb-3 space-y-2">
                    <div className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-2">
                      📊 הצמדה למדד ({selContract.indexation_method === "highest_in_period" ? "מדד גבוה ביותר" : selContract.indexation_method === "no_drop" ? "ללא ירידה" : selContract.indexation_method === "none" ? "ללא הצמדה" : "כלל t-2"})
                      <span className={"rounded px-1.5 py-0.5 text-[9px] font-bold " + (cpiResult.source === "cbs" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700")}>
                        {cpiResult.source === "cbs" ? "✓ מחשבון למ\"ס" : "≈ חישוב מקומי"}
                      </span>
                      {cpiResult.peakMonth && (
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-orange-100 text-orange-700">
                          🔝 שיא: {cpiResult.peakMonth} ({cpiResult.peakValue})
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {/* CPI-adjusted rent per sqm */}
                      <div className="rounded-lg bg-white border border-amber-200 p-2.5 text-center">
                        <div className="text-lg font-black text-amber-900">₪{cpiResult.adjustedRentPerSqm.toFixed(2)}/מ&quot;ר</div>
                        <div className="text-[10px] text-amber-600">שכ&quot;ד צמוד למדד היום</div>
                      </div>
                      {/* Total monthly CPI-adjusted */}
                      <div className="rounded-lg bg-white border border-amber-200 p-2.5 text-center">
                        <div className="text-lg font-black text-amber-900">₪{Math.round(cpiResult.adjustedRentPerSqm * (Number(selContract.charged_area) ?? 0)).toLocaleString()}</div>
                        <div className="text-[10px] text-amber-600">סה&quot;כ שכ&quot;ד צמוד לחודש (לפני מע&quot;מ)</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-amber-600">
                      <div className="flex justify-between"><span>מדד בסיס ({cpiResult.fromDate}):</span><span className="font-semibold">{cpiResult.fromIndexValue}</span></div>
                      <div className="flex justify-between"><span>מדד נוכחי ({cpiResult.toDate}):</span><span className="font-semibold">{cpiResult.toIndexValue}</span></div>
                      <div className="flex justify-between"><span>שכ&quot;ד בסיס:</span><span className="font-semibold">₪{cpiResult.baseRentPerSqm.toFixed(2)}/מ&quot;ר</span></div>
                      <div className="flex justify-between"><span>שינוי מצטבר:</span><span className="font-semibold">{cpiResult.changePct != null ? cpiResult.changePct + "%" : "—"}</span></div>
                      <div className="flex justify-between"><span>שנת בסיס מדד:</span><span className="font-semibold">{cpiResult.baseYear}</span></div>
                      <div className="flex justify-between"><span>שטח מחויב:</span><span className="font-semibold">{selContract.charged_area} מ&quot;ר</span></div>
                    </div>

                    {/* Self cross-check: the rent the calculator used must equal
                        the rate the price-timeline shows in effect today. If they
                        diverge, surface it instead of silently showing a wrong number. */}
                    {(function(){
                      if (cpiResult.currentRent == null || !priceTimeline.length) return null;
                      var nowT = Date.now();
                      var best = -Infinity, tlRent: number | null = null;
                      for (var i = 0; i < priceTimeline.length; i++) {
                        var st = new Date(priceTimeline[i].startDate).getTime();
                        if (st <= nowT && st >= best && priceTimeline[i].rentPerSqm != null) { best = st; tlRent = Number(priceTimeline[i].rentPerSqm); }
                      }
                      if (tlRent == null) return null;
                      if (Math.abs(tlRent - cpiResult.currentRent) <= 0.5) return null;
                      return <div className="rounded bg-red-100 border border-red-200 px-2 py-1.5 text-[10px] text-red-700 font-semibold">⚠️ אי-התאמה: המחשבון השתמש בבסיס ₪{cpiResult.currentRent.toFixed(2)} בעוד שציר הזמן מראה ₪{tlRent.toFixed(2)} לתקופה הנוכחית — בדוק שלבי המחיר.</div>;
                    })()}

                    {cpiResult.verificationUrl && (
                      <a href={cpiResult.verificationUrl} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-blue-500 hover:underline block">🔗 אימות מול מחשבון הלמ&quot;ס</a>
                    )}
                  </div>
                )}

                {/* Price Timeline — per-unit when per-unit tiers exist */}
                {(function() {
                  var hasPerUnitTiers = rawTiersWithSpace.some(function(t: any) { return t.space_id; });
                  var cpiRatio = cpiResult ? (cpiResult.adjustedRentPerSqm / cpiResult.baseRentPerSqm) : 1;
                  var contractStart = selContract.start_date;

                  if (hasPerUnitTiers && effectiveSpaces.length > 0) {
                    // Per-unit timeline
                    return <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 mb-3">
                      <div className="text-xs font-bold text-blue-800 mb-2">📊 ציר זמן מחירים (לפי יחידה)</div>
                      <div className="space-y-3">
                        {effectiveSpaces.map(function(cs: any) {
                          var spaceName = cs.spaces?.space_name || "—";
                          var area = cs.spaces?.area || 0;
                          var baseRent = cs.charge_method === "fixed" ? Number(cs.fixed_rent) || 0 : (Number(cs.price_per_sqm) || 0);
                          var isFixed = cs.charge_method === "fixed";
                          var spaceTiersList = rawTiersWithSpace.filter(function(t: any) { return t.space_id === cs.space_id; });
                          if (spaceTiersList.length === 0) {
                            // No per-unit tiers — just show base
                            return <div key={cs.space_id} className="text-[10px]">
                              <div className="font-bold text-slate-700">{spaceName} <span className="text-slate-400">({area} מ&quot;ר)</span></div>
                              <div className="text-slate-500 pr-2">{isFixed ? fmtMoney(baseRent) + "/חודש" : "₪" + baseRent.toFixed(2) + '/מ"ר'} — ללא עלייה</div>
                            </div>;
                          }
                          // Build timeline for this space
                          var rows: any[] = [{ label: "בסיס", rent: baseRent }];
                          var currentRent = baseRent;
                          spaceTiersList.sort(function(a: any, b: any) { return (a.from_year || 0) - (b.from_year || 0); });
                          spaceTiersList.forEach(function(tier: any) {
                            var yearLabel = tier.is_recurring ? "כל שנה" : (tier.from_year === tier.to_year ? "שנה " + tier.to_year : "שנים " + (tier.from_year + 1) + "-" + tier.to_year);
                            if (tier.increase_type === "pct") currentRent = currentRent * (1 + (Number(tier.increase_value) || 0) / 100);
                            else if (tier.increase_type === "fixed_sqm") currentRent = currentRent + (Number(tier.increase_value) || 0);
                            else if (tier.increase_type === "fixed_total") currentRent = currentRent + (Number(tier.increase_value) || 0);
                            rows.push({ label: yearLabel, rent: tier.calculated_rent_per_sqm ? Number(tier.calculated_rent_per_sqm) : currentRent, type: tier.increase_type, value: tier.increase_value });
                          });
                          return <div key={cs.space_id}>
                            <div className="text-[10px] font-bold text-slate-700 mb-0.5">{spaceName} <span className="text-slate-400">({area} מ&quot;ר)</span></div>
                            <table className="w-full text-[10px] mr-2">
                              <tbody>
                                {rows.map(function(r: any, ri: number) {
                                  var changeStr = r.type === "pct" ? "+" + r.value + "%" : r.type === "fixed_sqm" ? "+₪" + r.value + '/מ"ר' : r.type === "fixed_total" ? "+₪" + r.value : "";
                                  return <tr key={ri} className="border-b border-blue-100">
                                    <td className="py-0.5 text-slate-600">{r.label}</td>
                                    <td className="py-0.5 font-semibold">{isFixed ? fmtMoney(r.rent) : "₪" + r.rent.toFixed(2) + '/מ"ר'}</td>
                                    <td className="py-0.5 text-amber-700">{cpiResult ? (isFixed ? fmtMoney(r.rent * cpiRatio) : "₪" + (r.rent * cpiRatio).toFixed(2) + '/מ"ר') : ""}</td>
                                    <td className="py-0.5 text-blue-500 text-[9px]">{changeStr}</td>
                                  </tr>;
                                })}
                              </tbody>
                            </table>
                          </div>;
                        })}
                      </div>
                    </div>;
                  }

                  // Standard timeline (contract-level)
                  if (priceTimeline.length <= 1) return null;
                  return <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 mb-3">
                    <div className="text-xs font-bold text-blue-800 mb-2">
                      📊 {selContract.rent_type === "revenue_pct" ? 'ציר זמן שכ"ד מינימום' : "ציר זמן מחירים"}
                    </div>
                    {selContract.rent_type === "revenue_pct" && (
                      <div className="text-[11px] text-blue-700 mb-2 leading-relaxed">
                        בחוזה אחוז-מפדיון הסכומים כאן הם ה<b>מינימום</b> למ&quot;ר לחודש (הרצפה). שכ&quot;ד בפועל = הגבוה מבין
                        {" "}{Number(selContract.revenue_pct) || 0}% מהפדיון לבין המינימום.
                      </div>
                    )}
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="text-blue-600 border-b border-blue-200">
                          <th className="py-1 text-right font-semibold">תקופה</th>
                          <th className="py-1 text-right font-semibold">שכ&quot;ד בסיס</th>
                          {cpiResult && <th className="py-1 text-right font-semibold">צמוד למדד</th>}
                          <th className="py-1 text-center font-semibold w-6"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {priceTimeline.map(function(entry: any, idx: number) {
                          var now = new Date();
                          var isCurrent = new Date(entry.startDate) <= now && new Date(entry.endDate) > now;
                          var startD = new Date(entry.startDate);
                          var endD = new Date(entry.endDate);
                          var endYearCalc = new Date(endD.getTime() - 86400000);
                          var startYear = startD.getFullYear();
                          var endYear = endYearCalc.getFullYear();
                          var yearLabel = startYear === endYear ? String(startYear) : startYear + "–" + endYear;
                          var rentSqm = entry.rentPerSqm ?? 0;
                          var rentWithInvest = rentSqm + investPerSqm;
                          var cpiRentVal = rentWithInvest * cpiRatio;
                          return (
                            <tr key={idx} className={"border-b border-blue-100 " + (isCurrent ? "bg-blue-100 font-bold" : "")}>
                              <td className="py-1 text-right">
                                <span>{entry.label}</span>
                                <span className="text-blue-500 mr-1 font-semibold">({yearLabel})</span>
                              </td>
                              <td className="py-1 text-right">₪{rentWithInvest.toFixed(2)}/מ&quot;ר</td>
                              {cpiResult && <td className="py-1 text-right text-amber-700">₪{cpiRentVal.toFixed(2)}/מ&quot;ר</td>}
                              <td className="py-1 text-center">{isCurrent ? "◀" : ""}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>;
                })()}

                {/* Details */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-slate-700">
                  {[
                    {l:"תחילה",   v:fmtDate(selContract.start_date)},
                    {l:"סיום",    v:fmtEndDate(effectiveEndDate, selContract.start_date)},
                    {l:"שטח",    v:selContract.charged_area?selContract.charged_area+' מ"ר':"—"},
                    {l:"הצמדה",  v:selContract.indexation_method==="highest_in_period"?"מדד גבוה":selContract.indexation_method==="none"?"ללא":"t-2"},
                    {l:"מדד בסיס",v:selContract.index_base_value ? ("📊 מדד " + (selContract.index_base_date ? baseIndexLabel(selContract.index_base_date) + " = " : "= ") + selContract.index_base_value) : "—"},
                    {l:'מע"מ',  v:selContract.vat_type==="taxable"?(Math.round(vatPct*100)+"%"):"פטור"},
                    {l:"סוג שכ\"ד", v: selContract.rent_type==="revenue_pct" ? selContract.revenue_pct+"% ממחזור" : "קבוע"},
                    {l:"שיטת תשלום", v: selContract.payment_method==="checks_advance"?"שיקים מראש":selContract.payment_method==="bank_transfer"?"העברה בנקאית":selContract.payment_method==="cash"?"מזומן":selContract.payment_method==="credit_card"?"כרטיס אשראי":"הוראת קבע"},
                  ].map(function(r){return <div key={r.l} className="flex justify-between border-b border-slate-50 py-1"><span className="text-slate-400">{r.l}</span><span className="font-medium">{r.v}</span></div>;})}
                </div>

                {/* Management-fee protection */}
                {selContract.mgmt_protection_type && selContract.mgmt_protection_type !== "none" && (
                  <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2 text-xs text-teal-800">
                    <div className="font-semibold">🛡️ {describeMgmtProtection(mgmtProtectionFromRow(selContract), selContract)}</div>
                    <div className="mt-0.5">
                      {selContract.mgmt_protection_reconciled_at
                        ? "התחשבנות סיום בוצעה ב-" + fmtDate(selContract.mgmt_protection_reconciled_at)
                        : "בתום התקופה יש לבצע התחשבנות מול העלות בפועל ולהחזיר תשלום עודף לשוכר."}
                    </div>
                    {selContract.mgmt_protection_notes && (
                      <div className="mt-0.5 text-teal-600">{selContract.mgmt_protection_notes}</div>
                    )}
                  </div>
                )}

                {/* Base index tied to a milestone rather than fixed at signing */}
                {selContract.index_base_mode === "derived" && (
                  <div className={"mt-3 rounded-lg border px-3 py-2 text-xs " +
                    (baseIndexPending(selContract) ? "border-amber-300 bg-amber-50 text-amber-800" : "border-indigo-200 bg-indigo-50/50 text-indigo-800")}>
                    <div className="font-semibold">
                      {baseIndexPending(selContract) ? "⏳ " : "📌 "}
                      {describeBaseIndexRule(baseIndexRuleFromRow(selContract), selContract)}
                    </div>
                    {baseIndexPending(selContract) && (
                      <div className="mt-0.5">כל חישובי ההצמדה בחוזה זה חלקיים עד שייקבע מדד הבסיס.</div>
                    )}
                  </div>
                )}

                {/* Parking info */}
                {parkingSubs.length > 0 && (
                  <div className="rounded-lg border border-teal-200 bg-teal-50/30 p-3 mt-3">
                    <div className="text-sm font-bold text-teal-700 mb-2">🅿️ חניות</div>
                    <div className="space-y-1">
                      {parkingSubs.filter(function(p: any) { return p.subscription_type !== "visitor"; }).map(function(p: any) {
                        return <div key={p.id} className="flex justify-between text-xs text-teal-800">
                          <span>{p.quantity || 1} מקומות {p.is_marked ? "(מסומנים)" : ""} {p.is_included_in_rent ? "(כלול בשכ\"ד)" : ""}</span>
                          <span className="font-bold">{fmtMoney((Number(p.monthly_fee) || 0) * (Number(p.quantity) || 1))}/חודש</span>
                        </div>;
                      })}
                      {parkingSubs.filter(function(p: any) { return p.subscription_type === "visitor"; }).map(function(p: any) {
                        return <div key={p.id} className="flex justify-between text-xs text-teal-600">
                          <span>חניית אורחים ({p.visitor_codes_count || 0} קודים, {p.visitor_discount_pct || 0}% הנחה)</span>
                          <span className="font-bold">{fmtMoney(Number(p.visitor_lot_tariff) || 0)}/לוט</span>
                        </div>;
                      })}
                    </div>
                  </div>
                )}

                {/* Price increase schedule */}
                {rawTiersWithSpace.length > 0 && (
                  <div className="rounded-lg border border-purple-200 bg-purple-50/30 p-3 mt-3">
                    <div className="text-sm font-bold text-purple-700 mb-2">📈 מדרגות עליית מחיר</div>
                    {(function() {
                      // Group tiers: per-space vs contract-level
                      var contractLevel = rawTiersWithSpace.filter(function(t: any) { return !t.space_id; });
                      var perSpace: Record<string, any[]> = {};
                      rawTiersWithSpace.filter(function(t: any) { return t.space_id; }).forEach(function(t: any) {
                        var name = t.spaces?.space_name || t.space_id;
                        if (!perSpace[name]) perSpace[name] = [];
                        perSpace[name].push(t);
                      });
                      var hasPerSpace = Object.keys(perSpace).length > 0;
                      return <div className="space-y-2">
                        {contractLevel.length > 0 && !hasPerSpace && (
                          <div className="space-y-1">
                            {contractLevel.map(function(tier: any, i: number) {
                              var label = tier.is_recurring ? "כל שנה" : (tier.from_year === tier.to_year ? "שנה " + tier.to_year : "שנים " + (tier.from_year + 1) + "-" + tier.to_year);
                              var changeLabel = tier.increase_type === "pct" ? "+" + tier.increase_value + "%" : tier.increase_type === "fixed_sqm" ? "+₪" + tier.increase_value + '/מ"ר' : "+₪" + tier.increase_value + " סה\"כ";
                              return <div key={i} className="flex justify-between text-xs text-purple-800">
                                <span>{label}</span>
                                <span className="font-bold">{changeLabel} {tier.calculated_rent_per_sqm ? "→ ₪" + Number(tier.calculated_rent_per_sqm).toFixed(2) + '/מ"ר' : ""}</span>
                              </div>;
                            })}
                          </div>
                        )}
                        {hasPerSpace && Object.entries(perSpace).map(function([spaceName, tiers]) {
                          return <div key={spaceName} className="border-t border-purple-200 pt-1 first:border-0 first:pt-0">
                            <div className="text-xs font-bold text-purple-600 mb-0.5">📐 {spaceName}</div>
                            {(tiers as any[]).map(function(tier: any, i: number) {
                              var label = tier.is_recurring ? "כל שנה" : (tier.from_year === tier.to_year ? "שנה " + tier.to_year : "שנים " + (tier.from_year + 1) + "-" + tier.to_year);
                              var changeLabel = tier.increase_type === "pct" ? "+" + tier.increase_value + "%" : tier.increase_type === "fixed_sqm" ? "+₪" + tier.increase_value + '/מ"ר' : "+₪" + tier.increase_value + " סה\"כ";
                              return <div key={i} className="flex justify-between text-xs text-purple-800 pr-3">
                                <span>{label}</span>
                                <span className="font-bold">{changeLabel} {tier.calculated_rent_per_sqm ? "→ ₪" + Number(tier.calculated_rent_per_sqm).toFixed(2) + '/מ"ר' : ""}</span>
                              </div>;
                            })}
                          </div>;
                        })}
                      </div>;
                    })()}
                  </div>
                )}

                {/* Per-unit breakdown — with step-rent + CPI adjustments */}
                {effectiveSpaces?.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mt-3">
                    <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                      📐 פירוט לפי יחידה
                      {latestAmendment && <span className="text-xs font-normal text-yellow-600">(אחרי תוספת {latestAmendment.amendment_number})</span>}
                      {stepRentMultiplier > 1 && <span className="text-xs font-normal text-blue-600">({currentInOption ? currentOptionLabel : "שנה " + currentContractYear})</span>}
                    </div>
                    {/* Consistency tripwire (runs for EVERY contract): the sum of
                        per-unit current rents MUST equal the contract-level total.
                        Both now route through unitSteppedMonthly(), so a non-zero
                        gap means a calculation path regressed — surface it loudly
                        instead of silently showing a wrong number (the failure mode
                        of the old per-unit multiplier bug). */}
                    {(function() {
                      var puTotal = 0;
                      effectiveSpaces.forEach(function(cs: any){ puTotal += unitSteppedMonthly(cs); });
                      var gap = Math.abs(puTotal - adjustedBaseRent);
                      var tol = Math.max(1, adjustedBaseRent * 0.005);
                      if (gap <= tol) return null;
                      return (
                        <div className="mb-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 font-semibold">
                          ⚠ אי-התאמה בחישוב שכ&quot;ד: סכום היחידות {fmtMoney(puTotal)} ≠ סך החוזה {fmtMoney(adjustedBaseRent)} (פער {fmtMoney(gap)}). ייתכן שמדרגת מחיר/אופציה לא נלקחה — בדוק את הגדרות החוזה.
                        </div>
                      );
                    })()}
                    <div className="space-y-1.5">
                      {effectiveSpaces.map(function(cs: any) {
                        var spName = cs.spaces?.space_name || "—";
                        var spArea = cs.spaces?.area || 0;
                        var isFixed = cs.charge_method === "fixed";
                        // Raw base price
                        var rawMonthly = isFixed
                          ? Number(cs.fixed_rent) || 0
                          : (Number(cs.price_per_sqm) || Number(effectiveRentPerSqm) || 0) * spArea;
                        // Step-rent adjusted — via the canonical per-unit
                        // schedule helper (same source billing + the contract
                        // total use), so this ALWAYS matches them.
                        var steppedMonthly = unitSteppedMonthly(cs);
                        // CPI adjusted
                        var cpiRatio = perUnitCpi[cs.space_id]?.ratio || (cpiResult && cpiResult.baseRentPerSqm > 0 ? cpiResult.adjustedRentPerSqm / cpiResult.baseRentPerSqm : 1);
                        var cpiMonthly = steppedMonthly * cpiRatio;
                        var hasCustomCpi = cs.use_original_index === false;
                        var hasCpiData = cpiRatio > 1;
                        var hasStepped = Math.abs(steppedMonthly - rawMonthly) > 0.5;

                        var rentLabel = isFixed
                          ? fmtMoney(Number(cs.fixed_rent) || 0) + " בסיס"
                          : fmtMoney(Number(cs.price_per_sqm) || Number(effectiveRentPerSqm) || 0) + '/מ"ר';

                        // Per-sqm prices (base and adjusted) — derived from the
                        // schedule-based monthly so they match the per-space steps.
                        var basePsqm = isFixed ? 0 : (Number(cs.price_per_sqm) || Number(effectiveRentPerSqm) || 0);
                        var steppedPsqm = isFixed ? 0 : (spArea > 0 ? steppedMonthly / spArea : 0);
                        var cpiPsqm = steppedPsqm * cpiRatio;

                        return (
                          <div key={cs.space_id} className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-700">{spName}</span>
                                <span className="text-slate-500">{spArea} מ&quot;ר</span>
                                {hasCustomCpi && <span className="text-orange-500 text-xs">📈 מדד נפרד</span>}
                              </div>
                              <span className="font-bold text-green-700">{fmtMoney(hasCpiData ? cpiMonthly : steppedMonthly)}/חודש</span>
                            </div>
                            {/* Per-sqm breakdown for sqm-based units */}
                            {!isFixed && spArea > 0 && (
                              <div className="flex gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                                {hasCpiData ? (
                                  <span>{fmtMoney(cpiPsqm)}/מ&quot;ר צמוד</span>
                                ) : hasStepped ? (
                                  <span>{fmtMoney(steppedPsqm)}/מ&quot;ר</span>
                                ) : (
                                  <span>{fmtMoney(basePsqm)}/מ&quot;ר</span>
                                )}
                                {(hasStepped || hasCpiData) && basePsqm !== (hasCpiData ? cpiPsqm : steppedPsqm) && (
                                  <span className="text-slate-400">
                                    {currentInOption
                                      ? `(בסיס באופציה: ${fmtMoney(steppedPsqm)}/מ"ר | מקורי: ${fmtMoney(basePsqm)}/מ"ר)`
                                      : `(בסיס: ${fmtMoney(basePsqm)}/מ"ר)`}
                                  </span>
                                )}
                              </div>
                            )}
                            {/* Fixed rent breakdown */}
                            {isFixed && (hasStepped || hasCpiData) && (
                              <div className="flex gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                                <span>{currentInOption ? "מקורי" : "בסיס"}: {fmtMoney(rawMonthly)}</span>
                                {hasStepped && <span>→ {currentInOption ? "באופציה" : "שנה " + currentContractYear}: {fmtMoney(steppedMonthly)}</span>}
                                {hasCpiData && <span>→ צמוד: {fmtMoney(cpiMonthly)}</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Parking subscriptions */}
                      {parkingSubs.filter(function(p:any){return !p.is_included_in_rent && p.subscription_type !== "visitor";}).map(function(p: any) {
                        var monthly = (Number(p.monthly_fee) || 0) * (Number(p.quantity) || 1);
                        return (
                          <div key={p.id} className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-blue-500">🅿️</span>
                              <span className="font-semibold text-slate-700">{p.quantity} חניות {p.is_marked && p.spot_number ? "(" + p.spot_number + ")" : "מינוי"}</span>
                              <span className="text-slate-500">{fmtMoney(Number(p.monthly_fee) || 0)} × {p.quantity}</span>
                            </div>
                            <span className="font-bold text-blue-700">{fmtMoney(monthly)}/חודש</span>
                          </div>
                        );
                      })}
                      {parkingSubs.filter(function(p:any){return p.subscription_type === "visitor";}).map(function(p: any) {
                        var freqLabel = p.billing_frequency === "monthly" ? "חודשי" : p.billing_frequency === "quarterly" ? "רבעוני" : p.billing_frequency === "semi_annual" ? "חצי שנתי" : p.billing_frequency === "with_cpi" ? "עם הפרשי הצמדה" : "שנתי";
                        return (
                          <div key={p.id} className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2 text-sm">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-purple-500">🎫</span>
                                <span className="font-semibold text-slate-700">חניות אורחים מזדמנים{p.visitor_codes_count ? " (" + p.visitor_codes_count + " מדבקות)" : ""}</span>
                              </div>
                              <span className="text-purple-700 text-xs font-semibold">{p.visitor_discount_pct}% הנחה</span>
                            </div>
                            <div className="text-xs text-purple-600 mt-1">חיוב לפי שימוש בפועל • תדירות: {freqLabel}{p.next_billing_date ? " • חיוב הבא: " + fmtDate(p.next_billing_date) : ""}</div>
                          </div>
                        );
                      })}
                      <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-center">
                        <span className="text-base font-black text-green-800">{fmtMoney(displayRent)}/חודש</span>
                        <span className="text-sm text-green-600 mr-2">סה&quot;כ {parkingMonthlyTotal > 0 ? "(יחידות + חניות)" : "כל היחידות"}{cpiAdjustedRent > 0 ? " (כולל הצמדה)" : ""}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Amendments History — clear before/after */}
              {amendments.length > 0 && (
                <div className="rounded-xl border-2 border-yellow-300 bg-yellow-50/50 shadow-sm p-5">
                  <div className="text-base font-bold text-yellow-800 mb-4 flex items-center gap-2">📝 תוספות להסכם ({amendments.length})</div>
                  <div className="space-y-4">
                    {amendments.map(function(am: any, amIdx: number) {
                      // Calculate amendment rent
                      var amSpaces = am.contract_spaces || [];
                      var amRent = 0;
                      amSpaces.forEach(function(cs: any) {
                        if (cs.charge_method === "fixed" && cs.fixed_rent) amRent += Number(cs.fixed_rent);
                        else amRent += (Number(cs.price_per_sqm) || Number(am.rent_per_sqm) || 0) * (cs.spaces?.area || 0);
                      });
                      if (amRent === 0) amRent = (Number(am.rent_per_sqm) || 0) * (Number(am.charged_area) || 0);

                      // Compare with PREVIOUS state (previous amendment or original contract)
                      var prevSpaces = amIdx > 0 && amendments[amIdx-1].contract_spaces?.length > 0
                        ? amendments[amIdx-1].contract_spaces
                        : (selContract.contract_spaces || []);
                      var prevSpaceIds = prevSpaces.map(function(cs: any){return cs.space_id;});
                      var amSpaceIds = amSpaces.map(function(cs: any){return cs.space_id;});
                      var addedSpaces = amSpaces.filter(function(cs: any){ return !prevSpaceIds.includes(cs.space_id); });
                      var removedSpaces = prevSpaces.filter(function(cs: any){ return !amSpaceIds.includes(cs.space_id); });

                      // Previous rent for comparison
                      var prevRent = 0;
                      prevSpaces.forEach(function(cs: any) {
                        if (cs.charge_method === "fixed" && cs.fixed_rent) prevRent += Number(cs.fixed_rent);
                        else prevRent += (Number(cs.price_per_sqm) || Number(selContract.rent_per_sqm) || 0) * (cs.spaces?.area || 0);
                      });
                      if (prevRent === 0) prevRent = (Number(selContract.rent_per_sqm) || 0) * (Number(selContract.charged_area) || 0);

                      return (
                        <div key={am.id} className="rounded-xl border border-yellow-300 bg-white p-4">
                          {/* Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-yellow-400 text-white flex items-center justify-center text-sm font-bold">{am.amendment_number || amIdx+1}</div>
                              <div>
                                <div className="text-base font-bold text-slate-800">תוספת {am.amendment_number || amIdx+1}</div>
                                <div className="text-sm text-slate-500">{am.amendment_notes || "—"}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-left">
                                <div className="text-base font-bold text-yellow-700">{am.amendment_date ? fmtDate(am.amendment_date) : fmtDate(am.start_date)}</div>
                                <div className="text-xs text-slate-400">תאריך תוקף</div>
                              </div>
                              {am.document_url && (
                                <a href={am.document_url} target="_blank" rel="noopener noreferrer" onClick={function(e){e.stopPropagation();}}
                                  className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100" title="צפה במסמך התוספת">📄</a>
                              )}
                              <button onClick={function(e){e.stopPropagation(); router.push("/contracts/"+am.id+"/edit");}}
                                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">✏️</button>
                              <button onClick={async function(e){
                                e.stopPropagation();
                                if(!confirm("למחוק תוספת "+( am.amendment_number||"")+"? כל הנתונים הקשורים יימחקו והמצב יחזור לתוספת הקודמת.")) return;
                                try {
                                  // Determine the PREVIOUS state (before this amendment)
                                  // to revert space statuses correctly
                                  var amSpaceIds = (am.contract_spaces || []).map(function(cs: any) { return cs.space_id; });
                                  var prevAmend = amendments.filter(function(a: any) {
                                    return (a.amendment_number || 0) < (am.amendment_number || 0);
                                  }).sort(function(a: any, b: any) { return (b.amendment_number || 0) - (a.amendment_number || 0); })[0];
                                  var prevSpaceIds = prevAmend?.contract_spaces?.length > 0
                                    ? prevAmend.contract_spaces.map(function(cs: any) { return cs.space_id; })
                                    : (selContract.contract_spaces || []).map(function(cs: any) { return cs.space_id; });
                                  // Spaces added in this amendment (not in previous) → mark vacant
                                  var addedInAmend = amSpaceIds.filter(function(sid: string) { return !prevSpaceIds.includes(sid); });
                                  // Spaces removed in this amendment (in previous but not here) → mark occupied
                                  var removedInAmend = prevSpaceIds.filter(function(sid: string) { return !amSpaceIds.includes(sid); });

                                  // Delete ALL related data + contract record
                                  await deleteContractData(am.id);
                                  await supabase.from("contracts").delete().eq("id", am.id);
                                  // Revert space statuses: spaces added → vacant, spaces removed → occupied
                                  if (addedInAmend.length > 0) {
                                    await supabase.from("spaces").update({ status: "vacant" }).in("id", addedInAmend);
                                  }
                                  if (removedInAmend.length > 0) {
                                    await supabase.from("spaces").update({ status: "occupied" }).in("id", removedInAmend);
                                  }
                                  // Renumber remaining amendments
                                  var { data: remaining } = await supabase.from("contracts")
                                    .select("id, amendment_number")
                                    .eq("parent_contract_id", selContract.id)
                                    .eq("is_amendment", true)
                                    .order("amendment_date");
                                  if (remaining) {
                                    for (var ri = 0; ri < remaining.length; ri++) {
                                      await supabase.from("contracts").update({ amendment_number: ri + 1 }).eq("id", remaining[ri].id);
                                    }
                                  }
                                  await logAudit({ entity_type: "contract", entity_id: am.id, action: "delete", notes: "מחיקת תוספת " + (am.amendment_number || "") });
                                  loadContracts();
                                } catch (err: any) { alert("שגיאה במחיקת תוספת: " + (err?.message || err)); }
                              }}
                                className="rounded border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50">🗑</button>
                            </div>
                          </div>

                          {/* New rent — big and clear */}
                          <div className="rounded-xl bg-green-50 border border-green-200 p-3 mb-3 text-center">
                            <div className="text-2xl font-black text-green-800">{fmtMoney(amRent)}/חודש</div>
                            <div className="text-sm text-green-600">שכ&quot;ד חודשי אחרי התוספת</div>
                            {prevRent > 0 && amRent !== prevRent && (
                              <div className="text-sm text-slate-500 mt-1">
                                לפני: {fmtMoney(prevRent)} | הפרש: <span className={amRent > prevRent ? "text-red-600 font-bold" : "text-green-600 font-bold"}>{amRent > prevRent ? "+" : ""}{fmtMoney(amRent - prevRent)}</span>
                              </div>
                            )}
                          </div>

                          {/* Changes summary */}
                          <div className="space-y-2">
                            {/* Added spaces */}
                            {addedSpaces.length > 0 && (
                              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2">
                                <div className="text-sm font-bold text-green-700 mb-1">➕ יחידות שנוספו</div>
                                {addedSpaces.map(function(cs: any) {
                                  var rent = cs.charge_method === "fixed" ? Number(cs.fixed_rent) : (Number(cs.price_per_sqm)||0) * (cs.spaces?.area||0);
                                  return (
                                    <div key={cs.space_id} className="flex justify-between text-sm">
                                      <span className="text-slate-700">{cs.spaces?.space_name} ({cs.spaces?.area} מ&quot;ר)</span>
                                      <span className="font-bold text-green-700">{fmtMoney(rent)}/חודש</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Removed spaces */}
                            {removedSpaces.length > 0 && (
                              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                                <div className="text-sm font-bold text-red-700 mb-1">➖ יחידות שהוסרו</div>
                                {removedSpaces.map(function(cs: any) {
                                  return (
                                    <div key={cs.space_id} className="text-sm text-red-600 line-through">
                                      {cs.spaces?.space_name} ({cs.spaces?.area} מ&quot;ר)
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* End date change */}
                            {am.end_date && am.end_date !== selContract.end_date && (
                              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 flex justify-between text-sm">
                                <span className="text-blue-700 font-bold">📅 הארכת תקופה</span>
                                <span className="text-blue-800">עד {fmtEndDate(am.end_date, am.start_date || selContract.start_date)}</span>
                              </div>
                            )}

                            {/* Current spaces list */}
                            <div className="text-xs text-slate-500 mt-1">
                              יחידות בתוספת: {amSpaces.map(function(cs: any){return cs.spaces?.space_name;}).filter(Boolean).join(", ")}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Construction investments (השקעות בינוי) — the landlord funds
                  fit-out works for the tenant and recovers it as a rent
                  addition. Shown whenever there are TI records OR the contract
                  carries an investment rent addition, so the "+ תוספת" above is
                  never unexplained. */}
              {((selContract.contract_ti??[]).length > 0 || Number(selContract.investment_addition) > 0) && (
                <div className="rounded-xl border border-purple-200 bg-purple-50/40 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold text-purple-700">🏗 השקעות בינוי ({(selContract.contract_ti??[]).length})</div>
                    {Number(selContract.investment_addition) > 0 && (
                      <div className="text-xs font-bold text-purple-800">תוספת שכ&quot;ד: {fmtMoney(Number(selContract.investment_addition))}/חודש</div>
                    )}
                  </div>
                  <div className="text-[11px] text-purple-600 mb-3 leading-relaxed">
                    השקעות שביצע המשכיר במושכר עבור השוכר (התאמות/בינוי), שתמורתן משולמת תוספת לשכ&quot;ד. התוספת צמודה למדד ככל שאר שכ&quot;ד.
                  </div>
                  {(selContract.contract_ti??[]).length === 0 ? (
                    /* No itemised detail — the rent addition alone is enough for
                       the system to bill correctly, so show WHAT IS PAID and note
                       the (optional) missing detail. */
                    <div className="rounded-lg border border-purple-200 bg-white px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-700">סכום המשולם בגין השקעות</span>
                        <span className="text-sm font-black text-purple-800">
                          {fmtMoney(Number(selContract.investment_addition))}/חודש
                          <span className="text-[11px] font-semibold text-purple-500"> · {fmtMoney(Number(selContract.investment_addition) * 12)}/שנה</span>
                        </span>
                      </div>
                      <div className="text-[11px] text-green-700 mt-1">✓ התוספת כלולה בחישוב שכ&quot;ד ובמקדמות, וצמודה למדד לפי הגדרות ההסכם.</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">לא הוזן פירוט השקעות (סכום ההשקעה, מועד ההחזר) — אופציונלי, ניתן להשלים בעריכת החוזה.</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(selContract.contract_ti??[]).map(function(ti: any) {
                        var TRIG: Record<string,string> = { on_completion: "עם השלמת העבודות", on_handover: "במסירת המושכר", on_opening: "עם פתיחת העסק", fixed_date: "בתאריך קבוע", installments: "בתשלומים" };
                        var trig = TRIG[ti.payment_trigger] || ti.payment_trigger || "";
                        var when = (ti.payment_days_after ? ti.payment_days_after + " ימים " : "") + trig;
                        return (
                          <div key={ti.id} className="rounded-lg border border-purple-200 bg-white p-3">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div className="font-semibold text-slate-800 text-sm">{ti.description || "השקעת בינוי"}</div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{fmtMoney(Number(ti.ti_amount) || 0)}</span>
                                {ti.paid_at
                                  ? <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ שולם {fmtDate(ti.paid_at)}</span>
                                  : <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">ממתין לתשלום</span>}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-[11px] text-slate-600 mt-1.5">
                              {when && <div><span className="text-slate-400">מועד תשלום: </span>{when}</div>}
                              {ti.payment_due_date && <div><span className="text-slate-400">תאריך יעד: </span>{fmtDate(ti.payment_due_date)}</div>}
                              {ti.payment_installments > 0 && <div><span className="text-slate-400">תשלומים: </span>{ti.payment_installments}</div>}
                              {Number(ti.recovery_amount_monthly) > 0 && <div><span className="text-slate-400">החזר חודשי: </span>{fmtMoney(Number(ti.recovery_amount_monthly))}</div>}
                              {ti.recovery_start_date && <div><span className="text-slate-400">תחילת החזר: </span>{fmtDate(ti.recovery_start_date)}</div>}
                              {ti.paid_amount != null && <div><span className="text-slate-400">שולם בפועל: </span>{fmtMoney(Number(ti.paid_amount))}</div>}
                            </div>
                            {(ti.requires_report || ti.requires_invoice) && (
                              <div className="text-[10px] text-amber-700 mt-1.5">
                                📋 התשלום כנגד {[ti.requires_report ? "דו&quot;ח עבודות מוסדר" : "", ti.requires_invoice ? "חשבונית" : ""].filter(Boolean).join(" + ")}
                              </div>
                            )}
                            {(ti.payment_notes || ti.notes) && <div className="text-[11px] text-slate-500 mt-1">{ti.payment_notes || ti.notes}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Options — enhanced */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
                <div className="text-xs font-bold text-slate-500 mb-3">🔄 אופציות ({(selContract.contract_options??[]).length})</div>
                {(selContract.contract_options??[]).length===0 ? <div className="text-xs text-slate-400">אין אופציות</div> : (
                  <div className="space-y-2">
                    {(selContract.contract_options??[]).sort((a:any,b:any) => a.option_number - b.option_number).map(function(opt:any) {
                      const optYears = opt.duration_years || (opt.duration_months ? Math.round(opt.duration_months / 12) : 0);
                      // Notice to exercise/decline an option is due before the CURRENT
                      // term ends — i.e. before the option COMMENCES (opt.start_date),
                      // NOT before the option's own end. (Counting back from the option
                      // END produced a notice date years too late: an option starting
                      // 1.9.2027 showed 'notice by 31.8.2029'. It should count back from
                      // 1.9.2027.) opt.start_date = the term-end boundary the notice
                      // precedes; fall back to the contract end for a first option.
                      const noticeRef = opt.start_date ? new Date(opt.start_date)
                        : (selContract.end_date ? new Date(selContract.end_date) : null);
                      const noticeDate = noticeRef && opt.notice_days_before_end
                        ? new Date(noticeRef.getTime() - opt.notice_days_before_end * 86400000)
                        : null;
                      const noticePassed = noticeDate ? new Date() > noticeDate : false;
                      const isExercised = opt.is_exercised || opt.status === "exercised";
                      const isDeclined = opt.status === "declined";
                      const needsAttention = noticePassed && !isExercised && !isDeclined && opt.status !== "expired";
                      const penalty = penaltyTermsFromRow(opt);
                      return (
                        <div key={opt.id} className={"rounded-lg border p-3 " + (needsAttention ? "border-red-300 bg-red-50" : isExercised ? "border-green-200 bg-green-50" : isDeclined ? "border-rose-200 bg-rose-50" : opt.option_group ? "border-purple-200 bg-purple-50/30" : "border-slate-100")}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-slate-700">אופציה {opt.option_number} — {optYears} שנים</span>
                              {opt.option_group && <span className="rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[9px] font-bold">חלופה {opt.option_group}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                                (isExercised ? "bg-green-100 text-green-700" : isDeclined ? "bg-rose-100 text-rose-700" : opt.status==="expired" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}>
                                {isExercised ? "✓ מומשה" : isDeclined ? "✗ לא מומשה" : opt.status==="expired" ? "פגה" : "ממתינה"}
                              </span>
                              {!isExercised && !isDeclined && opt.status !== "expired" && (
                                <button onClick={async (e) => { e.stopPropagation(); if (confirm("לסמן אופציה כמומשת?")) await handleExerciseOption(opt.id, true); }}
                                  className="text-xs border border-green-300 bg-green-50 text-green-700 rounded px-2 py-0.5 hover:bg-green-100 font-semibold">
                                  סמן מימוש
                                </button>
                              )}
                              {!isExercised && !isDeclined && opt.status !== "expired" && (
                                <button disabled={declining === opt.id}
                                  onClick={async (e) => { e.stopPropagation(); await handleDeclineOption(opt); }}
                                  className="text-xs border border-rose-300 bg-rose-50 text-rose-700 rounded px-2 py-0.5 hover:bg-rose-100 font-semibold disabled:opacity-50">
                                  {declining === opt.id ? "מחשב…" : "סמן אי-מימוש"}
                                </button>
                              )}
                              {isDeclined && (
                                <button onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!confirm("לבטל את סימון אי-המימוש?\n(חיוב הפיצוי שנוצר לא יימחק — יש לבטלו במסך החיובים)")) return;
                                  await supabase.from("contract_options").update({ status: "pending", declined_at: null }).eq("id", opt.id);
                                  await loadContracts();
                                }}
                                  className="text-xs border border-slate-200 text-slate-500 rounded px-2 py-0.5 hover:bg-slate-50">
                                  בטל
                                </button>
                              )}
                              {isExercised && (
                                <button onClick={async (e) => { e.stopPropagation(); if (confirm("לבטל מימוש?")) await handleExerciseOption(opt.id, false); }}
                                  className="text-xs border border-slate-200 text-slate-500 rounded px-2 py-0.5 hover:bg-slate-50">
                                  בטל
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-slate-500 space-y-0.5">
                            {opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct && (
                              <div>קפיצת מחיר: +{opt.rent_increase_pct}%</div>
                            )}
                            {opt.rent_mechanism === "new_value" && opt.new_rent_value && (
                              <div>{selContract.rent_type === "revenue_pct" ? "מינימום חדש" : "מחיר חדש"}: {fmtMoney(opt.new_rent_value)}/מ&quot;ר</div>
                            )}
                            {noticeDate && (
                              <div className={"font-semibold " + (noticePassed && !isExercised ? "text-red-600" : "text-slate-600")}>
                                {noticePassed && !isExercised ? "⚠️ " : "📅 "}
                                מועד אחרון להודעה: {fmtDate(noticeDate.toISOString())}
                                {noticePassed && !isExercised && " — עבר!"}
                              </div>
                            )}
                          </div>
                          {hasPenalty(penalty) && (
                            <div className="mt-1.5 rounded bg-rose-50 border border-rose-200 px-2 py-1.5 text-xs text-rose-700">
                              <div className="font-semibold">⚖️ פיצוי על אי מימוש: {describePenaltyTerms(penalty, selContract, opt)}</div>
                              {penalty.type === "per_sqm_month" && (function() {
                                const area = contractArea(selContract);
                                const months = penaltyMonths(penalty, selContract, opt);
                                if (!(area > 0 && months > 0)) return null;
                                return (
                                  <div className="text-[11px] text-rose-600">
                                    אומדן לפני הצמדה ומע&quot;מ: {fmtMoney(Number(penalty.value) * area * months)}
                                    {" "}({penalty.value} × {area.toLocaleString("he-IL")} מ&quot;ר × {months} ח&apos;)
                                  </div>
                                );
                              })()}
                              {penalty.notes && <div className="text-[11px] text-rose-500 mt-0.5">{penalty.notes}</div>}
                            </div>
                          )}
                          {isDeclined && (
                            <div className="mt-1.5 rounded bg-rose-100 border border-rose-200 px-2 py-1.5 text-xs text-rose-700 font-semibold">
                              ✗ סומנה כלא ממומשת{opt.declined_at ? " ב-" + fmtDate(opt.declined_at) : ""}
                              {opt.non_exercise_charge_id ? " · נוצר חיוב פיצוי (מסך חיובים)" : ""}
                            </div>
                          )}
                          {needsAttention && (
                            <div className="mt-1.5 rounded bg-red-100 border border-red-200 px-2 py-1.5 text-xs text-red-700 font-semibold">
                              ⚠️ מועד ההודעה עבר ולא סומן מימוש — האם לסמן כמומשה או כלא ממומשת?
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Guarantees */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
                <div className="text-xs font-bold text-slate-500 mb-3">🏦 ערבויות ({(selContract.guarantees??[]).length})</div>
                {(selContract.guarantees??[]).length===0 ? <div className="text-xs text-slate-400">אין ערבויות</div> : (
                  <div className="space-y-2">
                    {selContract.guarantees.map(function(g:any){
                      const diff = (g.amount_actual??0) - (g.amount_required??0);
                      const isExpired = g.end_date && new Date(g.end_date) < new Date();
                      const daysToExpiry = g.end_date ? Math.ceil((new Date(g.end_date).getTime() - Date.now()) / 86400000) : null;
                      const GTYPE: Record<string,string> = { bank:"🏦 בנקאית", check:"📝 שיקים", cash:"💵 מזומן", insurance:"🛡️ ביטוח", personal:"👤 אישית" };
                      return (
                        <div key={g.id} className={"rounded-lg border p-2.5 " + (isExpired ? "border-red-300 bg-red-50" : g.status !== "active" ? "border-slate-200 bg-slate-50" : "border-green-200 bg-green-50/30")}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-slate-700">{GTYPE[g.guarantee_type] ?? g.guarantee_type}</span>
                            <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                              (isExpired ? "bg-red-100 text-red-700" : g.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                              {isExpired ? "⚠️ לא בתוקף" : g.status === "active" ? "✓ בתוקף" : "לא פעיל"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-xs text-slate-600">
                            <div className="flex justify-between">
                              <span className="text-slate-400">נדרש:</span>
                              <span className="font-semibold">{fmtMoney(g.amount_required??0)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">בפועל:</span>
                              <span className={"font-semibold " + (diff < 0 ? "text-red-600" : "text-green-600")}>{fmtMoney(g.amount_actual??0)}</span>
                            </div>
                            {g.bank && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">בנק:</span>
                                <span>{g.bank}</span>
                              </div>
                            )}
                            {g.end_date && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">פקיעה:</span>
                                <span className={"font-semibold " + (isExpired ? "text-red-600" : daysToExpiry !== null && daysToExpiry <= 60 ? "text-yellow-600" : "")}>
                                  {fmtDate(g.end_date)}
                                  {isExpired && " (פג!)"}
                                  {!isExpired && daysToExpiry !== null && daysToExpiry <= 60 && ` (${daysToExpiry} יום)`}
                                </span>
                              </div>
                            )}
                          </div>
                          {diff < 0 && (
                            <div className="text-xs text-red-600 font-bold mt-1">⚠️ פער: {fmtMoney(Math.abs(diff))}</div>
                          )}
                          {g.document_url && (
                            <a href={g.document_url} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-blue-500 hover:underline mt-1 block">📄 צפה במסמך ערבות</a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* ═══ Amendment Modal ═══ */}
      {/* Record the actual handover. Everything downstream — the lease term, the
          rent steps' contract years, a derived base index — hangs off this date,
          so it is applied in one place rather than edited field by field. */}
      {showHandover && selContract && (function(){
        var planned = (selContract.planned_handover_date || "").slice(0,10);
        var prevStart = (selContract.start_date || "").slice(0,10);
        var prevEnd = (selContract.end_date || "").slice(0,10);
        // The lease keeps its agreed length: the end date moves by the same
        // number of days the start moved.
        var shiftDays = (handoverDate && prevStart)
          ? Math.round((new Date(handoverDate).getTime() - new Date(prevStart).getTime()) / 86400000) : 0;
        var newEnd = "";
        if (prevEnd && shiftDays !== 0) {
          var e = new Date(prevEnd); e.setDate(e.getDate() + shiftDays);
          newEnd = e.toISOString().slice(0,10);
        } else { newEnd = prevEnd; }
        var rule = baseIndexRuleFromRow(selContract);
        var newBase = rule.mode === "derived"
          ? resolveBaseIndexMonth({ rule: rule, contract: { ...selContract, actual_handover_date: handoverDate } })
          : null;
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={function(){ if(!handoverSaving) setShowHandover(false); }}>
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" dir="rtl" onClick={function(e:any){e.stopPropagation();}}>
              <div className="text-lg font-bold text-slate-800 mb-1">📦 מסירה בפועל</div>
              <div className="text-xs text-slate-500 mb-4">
                {selContract.tenants?.name} — {selContract.properties?.name}
                {planned && <span> · יעד מסירה: {new Date(planned).toLocaleDateString("he-IL")}</span>}
              </div>

              <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך המסירה בפועל</label>
              <input type="date" value={handoverDate} onChange={function(e){setHandoverDate(e.target.value);}}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3" />

              {handoverDate && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1 mb-4">
                  <div className="font-semibold text-slate-700">מה יתעדכן:</div>
                  <div>· תחילת שכירות: <b>{prevStart ? new Date(prevStart).toLocaleDateString("he-IL") : "—"}</b> ← <b className="text-green-700">{new Date(handoverDate).toLocaleDateString("he-IL")}</b></div>
                  {newEnd && newEnd !== prevEnd && (
                    <div>· סיום חוזה: <b>{new Date(prevEnd).toLocaleDateString("he-IL")}</b> ← <b className="text-green-700">{new Date(newEnd).toLocaleDateString("he-IL")}</b> <span className="text-slate-400">(אותה תקופה, {shiftDays > 0 ? "+" : ""}{shiftDays} ימים)</span></div>
                  )}
                  {newBase?.ok && (
                    <div>· מדד בסיס נגזר: <b className="text-green-700">{newBase.baseLabel}</b> <span className="text-slate-400">({describeBaseIndexRule(rule)})</span></div>
                  )}
                  <div className="text-slate-400">· שנות החוזה למדרגות שכ&quot;ד/מינימום ייספרו מהתאריך החדש</div>
                </div>
              )}

              <div className="flex gap-2">
                <button disabled={!handoverDate || handoverSaving}
                  onClick={async function(){
                    setHandoverSaving(true);
                    try {
                      var patch: any = { actual_handover_date: handoverDate, start_date: handoverDate };
                      if (newEnd) patch.end_date = newEnd;
                      if (newBase?.ok) { patch.index_base_date = newBase.baseDateForDb; }
                      var { error } = await supabase.from("contracts").update(patch).eq("id", selContract.id);
                      if (error) throw new Error(error.message);
                      await logAudit({ entity_type:"contract", entity_id:selContract.id, action:"handover" });
                      setShowHandover(false);
                      await loadContracts();
                    } catch(e:any) { alert("שגיאה: " + e?.message); }
                    finally { setHandoverSaving(false); }
                  }}
                  className="flex-1 rounded-lg bg-green-600 text-white px-4 py-2 text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                  {handoverSaving ? "⏳ שומר..." : "✓ אשר מסירה ועדכן"}
                </button>
                <button onClick={function(){setShowHandover(false);}} disabled={handoverSaving}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
              </div>
            </div>
          </div>
        );
      })()}

      {showAmendModal && selContract && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={function(){setShowAmendModal(false);}}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}}>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800">📝 תוספת להסכם</h2>
                <button onClick={function(){setShowAmendModal(false);}} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
              </div>
              <div className="text-xs text-slate-500 mb-4">
                {selContract.tenants?.name} | {selContract.properties?.name} | {fmtDate(selContract.start_date)} — {fmtEndDate(selContract.end_date, selContract.start_date)}
              </div>

              {/* Step 1: Choose amendment type */}
              {!amendType && (
                <div className="space-y-2">
                  <div className="text-sm font-bold text-slate-700 mb-3">מה מטרת התוספת?</div>
                  {[
                    { v: "swap_units", l: "החלפת יחידות", desc: "הורדת יחידה/ות והוספת אחרות במקום", icon: "🔄" },
                    { v: "add_units", l: "הוספת יחידות", desc: "הוספת יחידות חדשות להסכם הקיים", icon: "➕" },
                    { v: "remove_units", l: "הורדת יחידות", desc: "הסרת יחידות מההסכם", icon: "➖" },
                    { v: "extend", l: "הארכת תקופה", desc: "שינוי תאריך סיום להסכם", icon: "📅" },
                    { v: "price_change", l: "שינוי מחירים", desc: "עדכון מחירים ליחידות קיימות", icon: "💰" },
                    { v: "parking_subscription", l: "תוספת חניות מינוי", desc: "חניות קבועות בתשלום חודשי", icon: "🅿️" },
                    { v: "parking_visitor", l: "חניות אורחים מזדמנים", desc: "מנוי דרך מקומות / קודים בהנחה", icon: "🎫" },
                    { v: "other", l: "שינוי אחר", desc: "פתיחת כל האפשרויות (אשף מלא)", icon: "📋" },
                  ].map(function(opt) {
                    return (
                      <button key={opt.v} onClick={function(){ if (opt.v==="other") { router.push("/contracts/new?amendment_of="+selContract.id); setShowAmendModal(false); return; } setAmendType(opt.v); }}
                        className="w-full rounded-xl border border-slate-200 p-3 flex items-center gap-3 hover:bg-slate-50 hover:border-blue-300 transition-all text-right">
                        <span className="text-2xl">{opt.icon}</span>
                        <div className="flex-1">
                          <div className="text-sm font-bold text-slate-700">{opt.l}</div>
                          <div className="text-xs text-slate-400">{opt.desc}</div>
                        </div>
                        <span className="text-slate-300">←</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Step 2: Amendment details based on type */}
              {amendType && (
                <div className="space-y-4">
                  <button onClick={function(){setAmendType(null);}} className="text-xs text-blue-600 hover:underline">← חזור לבחירת סוג</button>

                  {/* Amendment date — shared by all types */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">תאריך תוקף התוספת *</label>
                    <input type="date" value={amendDate} onChange={function(e){setAmendDate(e.target.value);}}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </div>

                  {/* ── SWAP UNITS ── */}
                  {(amendType === "swap_units" || amendType === "remove_units") && (
                    <div>
                      <label className="block text-sm font-bold text-red-600 mb-2">יחידות להסרה (מצב נוכחי)</label>
                      <div className="grid grid-cols-2 gap-2">
                        {effectiveSpaces.map(function(cs: any) {
                          var sp = cs.spaces;
                          var isRem = amendRemoveSpaces.includes(cs.space_id);
                          return (
                            <button key={cs.space_id} type="button"
                              onClick={function(){ setAmendRemoveSpaces(function(p){ return isRem ? p.filter(function(x){return x!==cs.space_id;}) : [...p, cs.space_id]; }); }}
                              className={"rounded-lg border p-2 text-center text-xs transition-all " +
                                (isRem ? "border-red-500 bg-red-50 text-red-700 font-bold" : "border-slate-200 hover:bg-slate-50")}>
                              <div className="font-semibold">{sp?.space_name}</div>
                              <div className="text-slate-400">{sp?.area} מ&quot;ר</div>
                              {isRem && <div className="text-red-500 text-[10px] mt-0.5">✕ מסומנת להסרה</div>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {(amendType === "swap_units" || amendType === "add_units") && (
                    <div>
                      <label className="block text-sm font-bold text-green-600 mb-2">יחידות להוספה</label>
                      <div className="grid grid-cols-2 gap-2">
                        {allPropertySpaces.filter(function(s) {
                          // Show spaces NOT in current effective state (or removed)
                          var inEffective = effectiveSpaces.some(function(cs: any){return cs.space_id===s.id;});
                          var wasRemoved = amendRemoveSpaces.includes(s.id);
                          return !inEffective || wasRemoved;
                        }).map(function(s) {
                          var isAdd = amendAddSpaces.includes(s.id);
                          return (
                            <button key={s.id} type="button"
                              onClick={function(){ setAmendAddSpaces(function(p){ return isAdd ? p.filter(function(x){return x!==s.id;}) : [...p, s.id]; }); }}
                              className={"rounded-lg border p-2 text-center text-xs transition-all " +
                                (isAdd ? "border-green-500 bg-green-50 text-green-700 font-bold" : "border-slate-200 hover:bg-slate-50")}>
                              <div className="font-semibold">{s.space_name}</div>
                              <div className="text-slate-400">{s.area} מ&quot;ר</div>
                              {isAdd && <div className="text-green-500 text-[10px] mt-0.5">✓ נוספת</div>}
                            </button>
                          );
                        })}
                      </div>
                      {/* Rents + CPI base for added spaces */}
                      {amendAddSpaces.length > 0 && (
                        <div className="mt-3 space-y-3">
                          <div className="text-sm font-bold text-slate-700">מחיר והצמדה ליחידות שנוספו</div>
                          {selContract.index_base_value && (
                            <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                              מדד בסיס מקורי של ההסכם: <span className="font-bold">{selContract.index_base_value}</span>
                              {selContract.index_base_date && <span> (מתאריך {fmtDate(selContract.index_base_date)})</span>}
                            </div>
                          )}
                          {amendAddSpaces.map(function(sid) {
                            var sp = allPropertySpaces.find(function(s){return s.id===sid;});
                            var cpiMode = amendCpiMode[sid] || "original";
                            return (
                              <div key={sid} className="rounded-lg border border-green-200 bg-green-50/30 p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-slate-700">{sp?.space_name}</span>
                                  <span className="text-xs text-slate-500">{sp?.area} מ&quot;ר</span>
                                </div>
                                {/* Rent input */}
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-slate-600 w-16">מחיר:</label>
                                  <input type="number" value={amendAddRents[sid]||""} placeholder={selContract.rent_per_sqm?"₪/מ\"ר":"₪/חודש"}
                                    onChange={function(e){setAmendAddRents(function(p){return {...p,[sid]:e.target.value};});}}
                                    className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                                  <span className="text-xs text-slate-500">₪/מ&quot;ר</span>
                                </div>
                                {/* CPI base toggle */}
                                <div>
                                  <label className="text-xs text-slate-600 block mb-1">בסיס הצמדה למדד:</label>
                                  <div className="flex gap-2">
                                    <button type="button" onClick={function(){setAmendCpiMode(function(p){return {...p,[sid]:"original"};});}}
                                      className={"rounded-lg border px-3 py-1.5 text-xs font-bold transition-all " + (cpiMode==="original" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                                      📊 מדד מקורי ({selContract.index_base_value || "—"})
                                    </button>
                                    <button type="button" onClick={function(){setAmendCpiMode(function(p){return {...p,[sid]:"custom"};});}}
                                      className={"rounded-lg border px-3 py-1.5 text-xs font-bold transition-all " + (cpiMode==="custom" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                                      📈 מדד חדש
                                    </button>
                                  </div>
                                  {cpiMode === "custom" && (
                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                      <div>
                                        <label className="text-[10px] text-slate-500 block mb-0.5">ערך מדד בסיס</label>
                                        <input type="number" step="0.1" value={amendCpiValue[sid]||""}
                                          onChange={function(e){setAmendCpiValue(function(p){return {...p,[sid]:e.target.value};});}}
                                          placeholder="לדוגמה: 105.2"
                                          className="w-full rounded border border-orange-300 px-2 py-1.5 text-sm" />
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-slate-500 block mb-0.5">תאריך מדד בסיס</label>
                                        <input type="date" value={amendCpiDate[sid]||""}
                                          onChange={function(e){setAmendCpiDate(function(p){return {...p,[sid]:e.target.value};});}}
                                          className="w-full rounded border border-orange-300 px-2 py-1.5 text-sm" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── EXTEND PERIOD ── */}
                  {amendType === "extend" && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">תאריך סיום חדש</label>
                      <div className="text-xs text-slate-400 mb-2">סיום נוכחי: {fmtEndDate(selContract.end_date, selContract.start_date)}</div>
                      <input type="date" value={amendNewEndDate} onChange={function(e){setAmendNewEndDate(e.target.value);}}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                  )}

                  {/* ── PRICE CHANGE ── */}
                  {amendType === "price_change" && (
                    <div className="space-y-3">
                      <label className="block text-sm font-bold text-slate-700">עדכון מחירים והצמדה</label>
                      {selContract.index_base_value && (
                        <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                          מדד בסיס מקורי: <span className="font-bold">📊 מדד {selContract.index_base_date ? baseIndexLabel(selContract.index_base_date) + " = " : "= "}{selContract.index_base_value}</span>
                        </div>
                      )}
                      <div className="space-y-3">
                        {effectiveSpaces.map(function(cs: any) {
                          var sp = cs.spaces;
                          var isFixed = cs.charge_method === "fixed";
                          var curVal = isFixed ? (cs.fixed_rent||0) : (cs.price_per_sqm || effectiveRentPerSqm || 0);
                          var cpiMode = amendCpiMode[cs.space_id] || "original";
                          return (
                            <div key={cs.space_id} className="rounded-lg border border-slate-200 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-bold text-slate-700">{sp?.space_name} <span className="font-normal text-slate-500">({sp?.area} מ&quot;ר)</span></span>
                                <span className="text-xs text-slate-500">נוכחי: {fmtMoney(curVal)}{isFixed?"/חודש":"/מ\"ר"}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-600">מחיר חדש:</label>
                                <input type="number" value={amendPriceChanges[cs.space_id]||""}
                                  onChange={function(e){setAmendPriceChanges(function(p){return {...p,[cs.space_id]:e.target.value};});}}
                                  placeholder={String(curVal)}
                                  className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                                <span className="text-xs text-slate-500">{isFixed?"₪/חודש":"₪/מ\"ר"}</span>
                              </div>
                              {/* CPI base option */}
                              <div>
                                <label className="text-xs text-slate-600 block mb-1">בסיס הצמדה:</label>
                                <div className="flex gap-2">
                                  <button type="button" onClick={function(){setAmendCpiMode(function(p){return {...p,[cs.space_id]:"original"};});}}
                                    className={"rounded-lg border px-3 py-1.5 text-xs font-bold transition-all " + (cpiMode==="original" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                                    📊 מדד מקורי
                                  </button>
                                  <button type="button" onClick={function(){setAmendCpiMode(function(p){return {...p,[cs.space_id]:"custom"};});}}
                                    className={"rounded-lg border px-3 py-1.5 text-xs font-bold transition-all " + (cpiMode==="custom" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                                    📈 מדד חדש
                                  </button>
                                </div>
                                {cpiMode === "custom" && (
                                  <div className="grid grid-cols-2 gap-2 mt-2">
                                    <div>
                                      <label className="text-[10px] text-slate-500 block mb-0.5">ערך מדד</label>
                                      <input type="number" step="0.1" value={amendCpiValue[cs.space_id]||""}
                                        onChange={function(e){setAmendCpiValue(function(p){return {...p,[cs.space_id]:e.target.value};});}}
                                        placeholder="105.2"
                                        className="w-full rounded border border-orange-300 px-2 py-1.5 text-sm" />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-slate-500 block mb-0.5">תאריך מדד</label>
                                      <input type="date" value={amendCpiDate[cs.space_id]||""}
                                        onChange={function(e){setAmendCpiDate(function(p){return {...p,[cs.space_id]:e.target.value};});}}
                                        className="w-full rounded border border-orange-300 px-2 py-1.5 text-sm" />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── PARKING SUBSCRIPTION ── */}
                  {amendType === "parking_subscription" && (
                    <div className="rounded-xl border-2 border-blue-200 bg-blue-50/30 p-4 space-y-3">
                      <div className="text-sm font-bold text-blue-800">🅿️ פרטי חניות מינוי</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">כמות חניות *</label>
                          <input type="number" min="1" value={amendParkQty} onChange={function(e){setAmendParkQty(e.target.value);}}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">תשלום חודשי לחניה (₪)</label>
                          <input type="number" value={amendParkFee} onChange={function(e){setAmendParkFee(e.target.value);}}
                            placeholder="0 = כלול בשכ&quot;ד"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={amendParkMarked} onChange={function(e){setAmendParkMarked(e.target.checked);}} className="w-4 h-4" />
                          <span className="text-slate-700">חניות מסומנות (מספר ספציפי)</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={amendParkIncluded} onChange={function(e){setAmendParkIncluded(e.target.checked);}} className="w-4 h-4" />
                          <span className="text-slate-700">כלול בשכ&quot;ד</span>
                        </label>
                      </div>
                      {amendParkMarked && (
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">מספרי חניות (מופרדים בפסיק)</label>
                          <input type="text" value={amendParkSpotNumber} onChange={function(e){setAmendParkSpotNumber(e.target.value);}}
                            placeholder="לדוגמה: 12, 13, 14"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                      )}
                      {Number(amendParkQty) > 0 && Number(amendParkFee) > 0 && (
                        <div className="rounded-lg bg-blue-100 border border-blue-300 p-2 text-sm text-blue-800 text-center">
                          סה&quot;כ: {amendParkQty} חניות × {fmtMoney(Number(amendParkFee))} = <span className="font-bold">{fmtMoney(Number(amendParkQty) * Number(amendParkFee))}/חודש</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── VISITOR PARKING ── */}
                  {amendType === "parking_visitor" && (
                    <div className="rounded-xl border-2 border-purple-200 bg-purple-50/30 p-4 space-y-3">
                      <div className="text-sm font-bold text-purple-800">🎫 מינוי חניות אורחים מזדמנים</div>
                      <div className="text-xs text-purple-600">השוכר מקבל הנחה על תעריף החניון. החיוב נעשה לפי שימוש בפועל בתדירות שתוגדר. המערכת תשלח התראה למנהל לפני כל מועד חיוב.</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">אחוז הנחה ממחירון החניון (%) *</label>
                          <input type="number" min="0" max="100" value={amendVisitorDiscount} onChange={function(e){setAmendVisitorDiscount(e.target.value);}}
                            placeholder="לדוגמה: 50"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">תדירות חיוב *</label>
                          <select value={amendVisitorFreq} onChange={function(e){setAmendVisitorFreq(e.target.value);}}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            <option value="monthly">חודשי</option>
                            <option value="quarterly">רבעוני</option>
                            <option value="semi_annual">חצי שנתי</option>
                            <option value="annual">שנתי</option>
                            <option value="with_cpi">יחד עם הפרשי הצמדה</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">כמות מדבקות / קודים (אופציונלי)</label>
                          <input type="number" min="0" value={amendVisitorCodes} onChange={function(e){setAmendVisitorCodes(e.target.value);}}
                            placeholder="לדוגמה: 50"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">תעריף חניון מלא — להתייחסות (₪/שעה)</label>
                          <input type="number" step="0.5" value={amendVisitorTariff} onChange={function(e){setAmendVisitorTariff(e.target.value);}}
                            placeholder="לדוגמה: 8"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                      </div>
                      {Number(amendVisitorDiscount) > 0 && (
                        <div className="rounded-lg bg-purple-100 border border-purple-300 p-3 text-sm text-purple-800 space-y-1">
                          <div>הנחה לשוכר: <strong>{amendVisitorDiscount}%</strong> ממחירון החניון</div>
                          {Number(amendVisitorTariff) > 0 && (
                            <div className="text-xs">תעריף בפועל: {fmtMoney(Number(amendVisitorTariff) * (1 - Number(amendVisitorDiscount)/100))}/שעה (במקום {fmtMoney(Number(amendVisitorTariff))})</div>
                          )}
                          <div className="text-xs">חיוב בפועל: <strong>{amendVisitorFreq === "monthly" ? "חודשי" : amendVisitorFreq === "quarterly" ? "רבעוני" : amendVisitorFreq === "semi_annual" ? "חצי שנתי" : amendVisitorFreq === "annual" ? "שנתי" : "יחד עם הפרשי הצמדה"}</strong> לפי שימוש בפועל</div>
                          <div className="text-xs text-purple-600 mt-1">📢 המערכת תשלח התראה למנהל לפני כל מועד חיוב להוצאת חיוב על השימוש בפועל</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Document URL */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">📄 קישור למסמך התוספת (Dropbox / Google Drive)</label>
                    <input type="url" value={amendDocUrl} onChange={function(e){setAmendDocUrl(e.target.value);}}
                      placeholder="https://www.dropbox.com/... או https://drive.google.com/..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-left" dir="ltr" />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">הערות</label>
                    <textarea value={amendNotes} onChange={function(e){setAmendNotes(e.target.value);}}
                      placeholder="תיאור השינוי..." rows={2}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-right" />
                  </div>

                  {/* Save */}
                  <button disabled={amendSaving} onClick={async function() {
                    if (!amendDate) { alert("נא להזין תאריך תוקף"); return; }
                    // ── Overlap validation + cross-tenant swap ──
                    var crossSwapContracts: any[] = []; // contracts that need a mirror amendment
                    if (amendAddSpaces.length > 0) {
                      var { data: existOverlap } = await supabase
                        .from("contract_spaces")
                        .select("space_id, contracts!inner(id, status, start_date, end_date, is_amendment, parent_contract_id, tenants(name))")
                        .in("space_id", amendAddSpaces)
                        .in("contracts.status", ["active", "extended"]);
                      var amendEnd = selContract.end_date;
                      var overlapHits = (existOverlap ?? []).filter(function(o: any) {
                        if (o.contracts.is_amendment) return false;
                        if (o.contracts.id === selContract.id) return false;
                        var oS = new Date(o.contracts.start_date);
                        var oE = new Date(o.contracts.end_date);
                        return oS < new Date(amendEnd) && oE > new Date(amendDate);
                      });
                      if (overlapHits.length > 0 && amendRemoveSpaces.length > 0) {
                        // Potential cross-tenant swap: we're removing spaces AND adding occupied ones
                        var conflictContractIds = Array.from(new Set(overlapHits.map(function(o: any) { return o.contracts.id; })));
                        var conflictSpaceIds = overlapHits.map(function(o: any) { return o.space_id; });
                        var conflictNames = overlapHits.map(function(o: any) {
                          var spName = allPropertySpaces.find(function(s: any) { return s.id === o.space_id; })?.space_name || o.space_id;
                          return spName + " ← " + (o.contracts.tenants?.name || "—");
                        });
                        var removedNames = amendRemoveSpaces.map(function(sid: string) {
                          return allPropertySpaces.find(function(s: any) { return s.id === sid; })?.space_name || sid;
                        });
                        var swapMsg = "יחידות שאתה מוסיף שייכות לשוכר אחר:\n" +
                          conflictNames.join("\n") +
                          "\n\nהאם לבצע החלפה צולבת?\n" +
                          "• אצלך: הוסר " + removedNames.join(", ") + " → הוסף " + conflictSpaceIds.map(function(sid: string) { return allPropertySpaces.find(function(s: any) { return s.id === sid; })?.space_name || sid; }).join(", ") +
                          "\n• אצל השוכר השני: תיווצר תוספת שמחליפה בכיוון ההפוך" +
                          "\n\nלאשר?";
                        if (!confirm(swapMsg)) return;
                        // Mark contracts for cross-swap
                        for (var cid of conflictContractIds) {
                          var hit = overlapHits.find(function(o: any) { return o.contracts.id === cid; });
                          crossSwapContracts.push({
                            contractId: cid,
                            tenantName: (hit?.contracts as any)?.tenants?.name || "—",
                            spacesToRemove: conflictSpaceIds.filter(function(sid: string) {
                              return overlapHits.some(function(o: any) { return o.space_id === sid && o.contracts.id === cid; });
                            }),
                            spacesToAdd: amendRemoveSpaces, // they get our removed spaces
                          });
                        }
                      } else if (overlapHits.length > 0) {
                        // No swap possible (not removing anything) — just block
                        var conflictNames2 = overlapHits.map(function(o: any) {
                          return (o.contracts.tenants?.name || "—") + " (עד " + fmtEndDate(o.contracts.end_date, o.contracts.start_date) + ")";
                        });
                        alert("שגיאה: יחידות כבר משויכות לחוזה פעיל חופף:\n" + Array.from(new Set(conflictNames2)).join("\n"));
                        return;
                      }
                    }
                    setAmendSaving(true);
                    try {
                      // Count existing amendments
                      var { count } = await supabase.from("contracts")
                        .select("id", { count: "exact", head: true })
                        .eq("parent_contract_id", selContract.id).eq("is_amendment", true);

                      // Build new spaces list from EFFECTIVE state (latest amendment or original)
                      var currentSpaces = effectiveSpaces.map(function(cs: any){return cs;});
                      var newSpaces = currentSpaces.filter(function(cs: any){ return !amendRemoveSpaces.includes(cs.space_id); });

                      // Calculate new end date from effective
                      var newEnd = amendType === "extend" ? amendNewEndDate : effectiveEndDate;

                      // Calculate totals for the amendment record
                      var totalArea = 0;
                      newSpaces.forEach(function(cs: any) { totalArea += cs.spaces?.area || 0; });
                      amendAddSpaces.forEach(function(sid) {
                        var sp = allPropertySpaces.find(function(s){return s.id===sid;});
                        if (sp) totalArea += sp.area || 0;
                      });

                      // Build amendment contract record
                      var amendPayload: any = {
                        tenant_id: selContract.tenant_id,
                        property_id: selContract.property_id,
                        contract_type: selContract.contract_type,
                        start_date: amendDate,
                        end_date: newEnd,
                        lease_period_value: selContract.lease_period_value,
                        lease_period_unit: selContract.lease_period_unit,
                        rent_per_sqm: selContract.rent_per_sqm || null,
                        charged_area: totalArea || selContract.charged_area,
                        vat_type: selContract.vat_type,
                        payment_frequency: selContract.payment_frequency,
                        payment_method: selContract.payment_method,
                        payment_day: selContract.payment_day,
                        indexation_method: selContract.indexation_method,
                        index_base_value: selContract.index_base_value,
                        index_base_date: selContract.index_base_date,
                        status: "active",
                        parent_contract_id: selContract.id,
                        is_amendment: true,
                        amendment_number: (count ?? 0) + 1,
                        amendment_date: amendDate,
                        document_url: amendDocUrl || null,
                        amendment_notes: amendNotes || (amendType === "swap_units" ? "החלפת יחידות" : amendType === "add_units" ? "הוספת יחידות" : amendType === "remove_units" ? "הורדת יחידות" : amendType === "extend" ? "הארכת תקופה" : amendType === "price_change" ? "שינוי מחירים" : amendType === "parking_subscription" ? "תוספת חניות מינוי" : amendType === "parking_visitor" ? "חניות אורחים מזדמנים" : "שינוי אחר"),
                      };

                      var { data: newContract, error } = await supabase.from("contracts").insert(amendPayload).select().single();
                      if (error) throw error;

                      // Insert spaces for the amendment
                      var spacesToInsert: any[] = [];
                      // Keep existing (not removed) with potential price/CPI changes
                      newSpaces.forEach(function(cs: any) {
                        var priceChanged = amendPriceChanges[cs.space_id] && Number(amendPriceChanges[cs.space_id]) !== (cs.charge_method === "fixed" ? Number(cs.fixed_rent) : Number(cs.price_per_sqm || selContract.rent_per_sqm));
                        var cpiMode = amendCpiMode[cs.space_id] || "original";
                        var spaceEntry: any = {
                          contract_id: newContract.id,
                          space_id: cs.space_id,
                          charge_method: cs.charge_method || "per_sqm",
                          price_per_sqm: cs.charge_method === "fixed" ? null : (priceChanged ? Number(amendPriceChanges[cs.space_id]) : cs.price_per_sqm),
                          fixed_rent: cs.charge_method === "fixed" ? (priceChanged ? Number(amendPriceChanges[cs.space_id]) : cs.fixed_rent) : null,
                          use_original_index: cpiMode === "original",
                        };
                        if (cpiMode === "custom") {
                          spaceEntry.index_base_value = Number(amendCpiValue[cs.space_id]) || null;
                          spaceEntry.index_base_date = amendCpiDate[cs.space_id] || null;
                        }
                        spacesToInsert.push(spaceEntry);
                      });
                      // Add new spaces with CPI base
                      amendAddSpaces.forEach(function(sid) {
                        var rent = Number(amendAddRents[sid]) || Number(selContract.rent_per_sqm) || 0;
                        var cpiMode = amendCpiMode[sid] || "original";
                        var spaceEntry: any = {
                          contract_id: newContract.id,
                          space_id: sid,
                          charge_method: "per_sqm",
                          price_per_sqm: rent,
                          fixed_rent: null,
                          use_original_index: cpiMode === "original",
                        };
                        if (cpiMode === "custom") {
                          spaceEntry.index_base_value = Number(amendCpiValue[sid]) || null;
                          spaceEntry.index_base_date = amendCpiDate[sid] || null;
                        }
                        spacesToInsert.push(spaceEntry);
                      });
                      if (spacesToInsert.length > 0) {
                        await supabase.from("contract_spaces").insert(spacesToInsert);
                      }

                      // ── Cross-tenant swap: create mirror amendments for other contracts ──
                      for (var swapInfo of crossSwapContracts) {
                        // Load the other contract's effective spaces
                        var { data: otherContract } = await supabase.from("contracts")
                          .select("*, tenants(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,index_base_value,index_base_date,use_original_index,spaces(space_name,area))")
                          .eq("id", swapInfo.contractId).single();
                        if (!otherContract) continue;
                        // Get latest amendment's spaces for the other contract
                        var { data: otherAmends } = await supabase.from("contracts")
                          .select("id, contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,index_base_value,index_base_date,use_original_index,spaces(space_name,area))")
                          .eq("parent_contract_id", swapInfo.contractId).eq("is_amendment", true)
                          .order("amendment_number", { ascending: false }).limit(1);
                        var otherEffSpaces = (otherAmends && otherAmends.length > 0 && otherAmends[0].contract_spaces?.length > 0)
                          ? otherAmends[0].contract_spaces : (otherContract.contract_spaces || []);
                        // Build the other contract's new spaces: remove swapped-out, add swapped-in
                        var otherNewSpaces = otherEffSpaces.filter(function(cs: any) {
                          return !swapInfo.spacesToRemove.includes(cs.space_id);
                        });
                        // Count amendments for the other contract
                        var { count: otherAmendCount } = await supabase.from("contracts")
                          .select("id", { count: "exact", head: true })
                          .eq("parent_contract_id", swapInfo.contractId).eq("is_amendment", true);
                        // Calculate new total area for the mirror amendment
                        var otherNewArea = 0;
                        otherNewSpaces.forEach(function(cs: any) { otherNewArea += Number(cs.spaces?.area) || 0; });
                        swapInfo.spacesToAdd.forEach(function(sid: string) {
                          var sp = allPropertySpaces.find(function(s: any) { return s.id === sid; });
                          otherNewArea += Number(sp?.area) || 0;
                        });
                        // Create mirror amendment
                        var otherPayload: any = {
                          tenant_id: otherContract.tenant_id,
                          property_id: otherContract.property_id,
                          contract_type: otherContract.contract_type,
                          start_date: amendDate,
                          end_date: otherContract.end_date,
                          lease_period_value: otherContract.lease_period_value,
                          lease_period_unit: otherContract.lease_period_unit,
                          rent_per_sqm: otherContract.rent_per_sqm,
                          charged_area: otherNewArea || otherContract.charged_area,
                          vat_type: otherContract.vat_type,
                          payment_frequency: otherContract.payment_frequency,
                          payment_method: otherContract.payment_method,
                          payment_day: otherContract.payment_day,
                          indexation_method: otherContract.indexation_method,
                          index_base_value: otherContract.index_base_value,
                          index_base_date: otherContract.index_base_date,
                          status: "active",
                          parent_contract_id: swapInfo.contractId,
                          is_amendment: true,
                          amendment_number: (otherAmendCount ?? 0) + 1,
                          amendment_date: amendDate,
                          amendment_notes: "החלפה צולבת עם " + (selContract.tenants?.name || "") + ": " +
                            swapInfo.spacesToRemove.map(function(sid: string) { return allPropertySpaces.find(function(s: any){return s.id===sid;})?.space_name || sid; }).join(", ") +
                            " → " + swapInfo.spacesToAdd.map(function(sid: string) { return allPropertySpaces.find(function(s: any){return s.id===sid;})?.space_name || sid; }).join(", "),
                        };
                        var { data: otherNewContract } = await supabase.from("contracts").insert(otherPayload).select().single();
                        if (otherNewContract) {
                          var otherSpacesToInsert: any[] = [];
                          // Keep existing spaces (not swapped out)
                          otherNewSpaces.forEach(function(cs: any) {
                            otherSpacesToInsert.push({
                              contract_id: otherNewContract.id, space_id: cs.space_id,
                              charge_method: cs.charge_method || "per_sqm",
                              price_per_sqm: cs.price_per_sqm, fixed_rent: cs.fixed_rent,
                              use_original_index: cs.use_original_index ?? true,
                            });
                          });
                          // Add new spaces (from our removed)
                          swapInfo.spacesToAdd.forEach(function(sid: string) {
                            otherSpacesToInsert.push({
                              contract_id: otherNewContract.id, space_id: sid,
                              charge_method: "per_sqm",
                              price_per_sqm: otherContract.rent_per_sqm || 0,
                              use_original_index: true,
                            });
                          });
                          if (otherSpacesToInsert.length > 0) {
                            await supabase.from("contract_spaces").insert(otherSpacesToInsert);
                          }
                          await logAudit({ entity_type: "contract", entity_id: otherNewContract.id, action: "create",
                            notes: "החלפה צולבת אוטומטית עם " + (selContract.tenants?.name || "") });
                        }
                      }

                      // Update parent end date if extended
                      if (amendType === "extend" && amendNewEndDate > selContract.end_date) {
                        await supabase.from("contracts").update({ end_date: amendNewEndDate }).eq("id", selContract.id);
                      }

                      // Mark new spaces as occupied, removed as vacant
                      if (amendAddSpaces.length > 0) {
                        await supabase.from("spaces").update({ status: "occupied" }).in("id", amendAddSpaces);
                      }
                      if (amendRemoveSpaces.length > 0) {
                        await supabase.from("spaces").update({ status: "vacant" }).in("id", amendRemoveSpaces);
                      }

                      // Parking subscription
                      if (amendType === "parking_subscription") {
                        await supabase.from("parking_subscriptions").insert({
                          property_id: selContract.property_id,
                          tenant_id: selContract.tenant_id,
                          contract_id: newContract.id,
                          subscription_type: "monthly",
                          quantity: Number(amendParkQty) || 1,
                          monthly_fee: Number(amendParkFee) || 0,
                          is_marked: amendParkMarked,
                          spot_number: amendParkMarked ? amendParkSpotNumber || null : null,
                          is_included_in_rent: amendParkIncluded,
                          start_date: amendDate,
                          status: "active",
                        });
                      }

                      // Visitor parking — usage-based billing
                      if (amendType === "parking_visitor") {
                        // Calculate first billing date based on frequency
                        var nextBilling = new Date(amendDate);
                        if (amendVisitorFreq === "monthly") nextBilling.setMonth(nextBilling.getMonth() + 1);
                        else if (amendVisitorFreq === "quarterly") nextBilling.setMonth(nextBilling.getMonth() + 3);
                        else if (amendVisitorFreq === "semi_annual") nextBilling.setMonth(nextBilling.getMonth() + 6);
                        else if (amendVisitorFreq === "annual" || amendVisitorFreq === "with_cpi") nextBilling.setFullYear(nextBilling.getFullYear() + 1);
                        var nextBillingStr = nextBilling.toISOString().split("T")[0];

                        var { data: parkSub } = await supabase.from("parking_subscriptions").insert({
                          property_id: selContract.property_id,
                          tenant_id: selContract.tenant_id,
                          contract_id: newContract.id,
                          subscription_type: "visitor",
                          quantity: Number(amendVisitorCodes) || 1,
                          monthly_fee: 0,
                          visitor_codes_count: Number(amendVisitorCodes) || null,
                          visitor_discount_pct: Number(amendVisitorDiscount) || null,
                          visitor_lot_tariff: Number(amendVisitorTariff) || null,
                          billing_frequency: amendVisitorFreq,
                          next_billing_date: nextBillingStr,
                          is_marked: false,
                          start_date: amendDate,
                          status: "active",
                        }).select().single();

                        // Create initial alert for first billing
                        await supabase.from("alerts").insert({
                          title: "חיוב חניות אורחים — " + (selContract.tenants?.name || ""),
                          message: "הגיע מועד הוצאת חיוב על שימוש בחניות אורחים מזדמנים (" + amendVisitorDiscount + "% הנחה). יש לאסוף נתוני שימוש בפועל ולהוציא חיוב.",
                          alert_type: "visitor_parking_billing",
                          severity: "medium",
                          entity_type: "parking_subscription",
                          entity_id: parkSub?.id || null,
                          contract_id: newContract.id,
                          due_date: nextBillingStr,
                        });
                      }

                      await logAudit({ entity_type: "contract", entity_id: newContract.id, action: "create", notes: "תוספת להסכם: " + (amendNotes || amendType) });
                      setShowAmendModal(false);
                      loadContracts();
                    } catch (e: any) {
                      alert("שגיאה: " + (e.message || e));
                    } finally {
                      setAmendSaving(false);
                    }
                  }}
                    className="w-full rounded-xl bg-yellow-600 px-4 py-3 text-sm font-bold text-white hover:bg-yellow-700 disabled:opacity-50 transition-all">
                    {amendSaving ? "שומר..." : "💾 שמור תוספת"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
