"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit-log";
import { fetchCpiAdjusted, fetchCpiAdjustedWithRetry, fetchHighestChainedCpiWithRetry } from "@/lib/cpi-server";
import { fetchHighestCPI } from "@/lib/cpi-utils";
import { formatPeriod } from "@/lib/cpi-utils";
import CalcProgress, { CalcProgressState } from "./CalcProgress";
import CalcBreakdown from "./CalcBreakdown";
import { tierAppliesAtYear, buildSpaceRentSchedule, rentAtDate } from "@/lib/contract-utils";
import { getVatPctForDate } from "@/lib/vat";
import { fetchHighestChainedCpi } from "@/lib/cpi-server";

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
  spaceId: string;
  tenantName: string;
  spaceName: string;
  spaceArea: number;
  baseRentMonthly: number;
  indexedRentMonthly: number;
  mgmtAdvanceMonthly: number;
  parkingMonthly: number;
  parkingSpots: number;
  totalMonthly: number;
  cpiBaseValue: number;
  cpiBaseDate: string;
  cbsFromDate: string;  // CBS actual from-index period (e.g. "2021-7")
  cpiCurrentValue: number;
  cpiCurrentDate: string;
  cpiRatio: number;
  indexationMethod: string;
  startDate: string;
  rentChangeDate?: string;   // date of step-rent increase within year
  rentBefore?: number;       // rent before step-rent increase
  rentAfter?: number;        // rent after step-rent increase
  // Full rent change schedule for this space (drives the "show your work"
  // breakdown panel). Each entry = one moment in contract life where the
  // space's monthly rent changed, with the source: "base" / "tier_yN" /
  // "opt_N_base" / "opt_N_yN". Optional: undefined for rows loaded from
  // saved data prior to this feature.
  rentSchedule?: Array<{ date: string; rentMonthly: number; source: string }>;
  // CPI peak month (filled when highest_in_period override fires)
  cpiPeakMonth?: string;
  vatPct?: number;
  isQuarterly?: boolean;
  // Error / suspicion flags — when set, the row CANNOT be saved without
  // user action. These are the trust-layer that prevents silent failures.
  cpiError?: string;            // CBS API failed after retries
  cpiInconsistent?: string;     // ratio differs from sibling spaces in same group
  cpiSuspicious?: string;       // ratio = 1 on an indexed contract (almost certainly a bug)
  checks: CheckRow[];
}

export default function AdvancesTab({ properties }: { properties: any[] }) {
  const currentYear = new Date().getFullYear();
  const [propId, setPropId] = useState("");
  const [contractFilter, setContractFilter] = useState("all");
  const [availableContracts, setAvailableContracts] = useState<any[]>([]);
  const [year, setYear] = useState(currentYear + 1);
  const [cpiCalcDate, setCpiCalcDate] = useState(currentYear + "-11-15");
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState<CalcProgressState | null>(null);
  const [results, setResults] = useState<AdvanceRow[]>([]);
  const [creatingCharges, setCreatingCharges] = useState(false);
  const [creatingLetters, setCreatingLetters] = useState(false);

  // Saved advances state
  const [savedMode, setSavedMode] = useState(false); // true = showing saved data
  const [savedInfo, setSavedInfo] = useState<{ count: number; savedAt: string; cpiCalcDate: string; otherDates: string[] } | null>(null);
  const [checkingSaved, setCheckingSaved] = useState(false);
  // Which rows have their "show your work" breakdown expanded (by index)
  const [expandedBreakdowns, setExpandedBreakdowns] = useState<Record<number, boolean>>({});

  // Load available contracts when property changes
  function loadAvailableContracts(pid: string) {
    if (!pid) { setAvailableContracts([]); return; }
    supabase.from("contracts")
      .select("id, tenants(name), payment_method, contract_spaces(spaces(space_name))")
      .eq("property_id", pid).in("status", ["active", "extended"]).eq("is_amendment", false)
      .then(function({ data }) {
        setAvailableContracts((data ?? []).filter(function(c: any) { return c.payment_method === "checks_advance"; }));
      });
  }

  // Check for saved advances when property/year changes
  async function checkSavedAdvances(pid: string, yr: number, cFilter: string) {
    if (!pid) { setSavedInfo(null); return; }
    setCheckingSaved(true);
    try {
      var query = supabase.from("advance_payments")
        .select("id, contract_id, space_id, tenant_name, space_name, space_area, period, check_date, base_rent, indexed_rent, management_advance, parking_monthly, total_before_vat, vat_amount, total_with_vat, cpi_base_value, cpi_at_payment, cpi_ratio, cbs_from_date, cpi_current_date, cpi_calc_date, status, created_at")
        .eq("property_id", pid).eq("year", yr)
        .order("tenant_name").order("space_name").order("check_date");
      if (cFilter !== "all") query = query.eq("contract_id", cFilter);
      var { data: saved } = await query;
      if (saved && saved.length > 0) {
        // Convert saved data to display format (grouped by tenant+space)
        var grouped: Record<string, any[]> = {};
        saved.forEach(function(s: any) {
          var key = s.contract_id + "|" + s.space_id;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(s);
        });
        // Build AdvanceRow[] from saved data
        var rows: AdvanceRow[] = [];
        Object.values(grouped).forEach(function(items: any[]) {
          var first = items[0];
          var checks: CheckRow[] = items.map(function(s: any) {
            return {
              label: s.period, months: 1, partialDays: 0, totalDaysInMonth: 30,
              checkDate: s.check_date, rentBeforeVat: Number(s.indexed_rent) || 0,
              mgmtBeforeVat: Number(s.management_advance) || 0,
              totalBeforeVat: Number(s.total_before_vat) || 0,
              vat: Number(s.vat_amount) || 0, totalWithVat: Number(s.total_with_vat) || 0,
            };
          });
          rows.push({
            contractId: first.contract_id, spaceId: first.space_id,
            tenantName: first.tenant_name || "—", spaceName: first.space_name || "—",
            spaceArea: Number(first.space_area) || 0,
            baseRentMonthly: Number(first.base_rent) || 0,
            indexedRentMonthly: Number(first.indexed_rent) || 0,
            mgmtAdvanceMonthly: Number(first.management_advance) || 0,
            parkingMonthly: Number(first.parking_monthly) || 0, parkingSpots: 0,
            totalMonthly: Number(first.total_with_vat) || 0,
            cpiBaseValue: Number(first.cpi_base_value) || 0, cpiBaseDate: "",
            cbsFromDate: first.cbs_from_date || "",
            cpiCurrentValue: Number(first.cpi_at_payment) || 0,
            cpiCurrentDate: first.cpi_current_date || "",
            cpiRatio: Number(first.cpi_ratio) || 1, indexationMethod: "",
            startDate: first.check_date || "", checks: checks,
          });
        });
        setResults(rows);
        setSavedMode(true);
        // Find saved date
        var latestCreated = saved.reduce(function(latest: string, s: any) {
          return s.created_at > latest ? s.created_at : latest;
        }, "");
        // Check for other dates (different calc dates)
        var { data: otherSaved } = await supabase.from("advance_payments")
          .select("created_at").eq("property_id", pid).eq("year", yr)
          .not("created_at", "eq", latestCreated).limit(1);
        var calcDate = saved[0]?.cpi_calc_date || "";
        setSavedInfo({
          count: saved.length,
          savedAt: latestCreated,
          cpiCalcDate: calcDate,
          otherDates: (otherSaved || []).length > 0 ? ["קיימות מקדמות נוספות מתאריך אחר"] : [],
        });
      } else {
        setSavedInfo(null);
        setSavedMode(false);
        setResults([]);
      }
    } catch (e) { console.error(e); }
    finally { setCheckingSaved(false); }
  }

  // Auto-check when property/year/filter changes
  useEffect(function() {
    if (propId) checkSavedAdvances(propId, year, contractFilter);
  }, [propId, year, contractFilter]);

  async function compute() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    setComputing(true);
    setResults([]);
    var calcStart = Date.now();
    setProgress({ current: 0, total: 0, label: "טוען נתוני חוזים...", startedAt: calcStart });
    try {
      // Load contracts
      var query = supabase.from("contracts")
        .select("id, rent_per_sqm, charged_area, investment_addition, payment_method, payment_frequency, vat_type, indexation_method, index_mechanism, index_base_date, index_base_value, start_date, end_date, is_amendment, grace_months, grace_type, grace_discount_pct, rent_type, minimum_rent, mgmt_included_in_revenue, tenants(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,index_base_date,index_base_value,use_original_index,spaces(space_name,area))")
        .eq("property_id", propId)
        .in("status", ["active", "extended"])
        .eq("is_amendment", false);
      if (contractFilter !== "all") query = query.eq("id", contractFilter);
      var { data: contracts } = await query;

      contracts = (contracts ?? []).filter(function(c: any) {
        if (c.payment_method !== "checks_advance") return false;
        // Skip revenue-only contracts with no minimum rent AND mgmt included
        // (nothing to advance — everything is % of revenue)
        if (c.rent_type === "revenue_pct" && (!c.minimum_rent || Number(c.minimum_rent) === 0) && c.mgmt_included_in_revenue) return false;
        return true;
      });
      if (contracts.length === 0) { alert("אין חוזים עם שיקים מראש"); setComputing(false); return; }

      // Load price tiers for step-rent detection
      var contractIds = contracts.map(function(c: any) { return c.id; });
      var { data: allTiers } = await supabase.from("contract_price_tiers")
        .select("*").in("contract_id", contractIds).order("tier_number");

      // Load exercised contract options (for mid-year price changes from options)
      var { data: allOptions } = await supabase.from("contract_options")
        .select("*").in("contract_id", contractIds)
        .eq("is_exercised", true)
        .order("start_date", { ascending: true });

      // Load amendments (for per-unit entry/exit dates)
      var { data: allAmendments } = await supabase.from("contracts")
        .select("id, parent_contract_id, amendment_date, start_date, end_date, contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,index_base_date,index_base_value,use_original_index,spaces(space_name,area))")
        .in("parent_contract_id", contractIds)
        .eq("is_amendment", true)
        .order("amendment_date", { ascending: true });

      // Load parking subscriptions (for adding parking fees to advances)
      // Need to check both base contracts AND their amendments for parking
      var allContractAndAmendIds = [...contractIds];
      (allAmendments ?? []).forEach(function(am: any) { allContractAndAmendIds.push(am.id); });
      var { data: allParking } = await supabase.from("parking_subscriptions")
        .select("contract_id, subscription_type, monthly_fee, quantity, is_included_in_rent")
        .in("contract_id", allContractAndAmendIds)
        .eq("status", "active");

      // Build per-base-contract parking monthly total + spot count
      var contractParkingMonthly: Record<string, number> = {};
      var contractParkingSpots: Record<string, number> = {};
      for (var pk of (allParking ?? [])) {
        if (pk.is_included_in_rent) continue;
        if (pk.subscription_type === "visitor") continue;
        var fee = (Number(pk.monthly_fee) || 0) * (Number(pk.quantity) || 1);
        var spots = Number(pk.quantity) || 1;
        var baseForParking = pk.contract_id;
        var amForParking = (allAmendments ?? []).find(function(a: any) { return a.id === pk.contract_id; });
        if (amForParking) baseForParking = amForParking.parent_contract_id;
        contractParkingMonthly[baseForParking] = (contractParkingMonthly[baseForParking] || 0) + fee;
        contractParkingSpots[baseForParking] = (contractParkingSpots[baseForParking] || 0) + spots;
      }

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

      // VAT rate that applied in the billed year (year-end), from the single
      // configured source — so re-running a past year uses the historical rate.
      var vatPct = await getVatPctForDate(year + "-12-31");

      // CPI date: use user-specified date (not today)
      var toCbs = formatDateForCbs(cpiCalcDate);

      var rows: AdvanceRow[] = [];
      var totalContracts = contracts.length;
      var contractIdx = 0;

      for (var c of contracts) {
        contractIdx++;
        setProgress({
          current: contractIdx,
          total: totalContracts,
          label: "מחשב מקדמות — " + ((c.tenants as any)?.name || "—"),
          startedAt: calcStart,
        });
        var isVat = c.vat_type === "taxable";
        var isQuarterly = c.payment_frequency === "quarterly";

        // Build per-space timeline: entry_date = earliest date the space appeared,
        // exit_date = earliest amendment date that removed it (null if still active).
        var cAmends = (allAmendments ?? []).filter(function(a: any) { return a.parent_contract_id === c.id; });
        // Chronological snapshots: [{date, spaceIds, spaces}]
        var snapshots: any[] = [
          { date: new Date(c.start_date), spaceIds: new Set((c.contract_spaces || []).map(function(x: any){return x.space_id;})), spaces: c.contract_spaces || [] }
        ];
        for (var am of cAmends) {
          var amDate = new Date(am.amendment_date || am.start_date);
          snapshots.push({ date: amDate, spaceIds: new Set((am.contract_spaces || []).map(function(x: any){return x.space_id;})), spaces: am.contract_spaces || [] });
        }
        // Build entry_date / exit_date per space_id
        var spaceEntry: Record<string, Date> = {};
        var spaceExit: Record<string, Date | null> = {};
        for (var i = 0; i < snapshots.length; i++) {
          var snap = snapshots[i];
          var prevIds = i > 0 ? snapshots[i-1].spaceIds : new Set();
          // New spaces = in this snap but not previously seen ever
          snap.spaceIds.forEach(function(sid: string) {
            if (spaceEntry[sid] === undefined) spaceEntry[sid] = snap.date;
          });
          // Spaces removed in this amendment (present in prev, absent now)
          if (i > 0) {
            prevIds.forEach(function(sid: string) {
              if (!snap.spaceIds.has(sid) && spaceExit[sid] === undefined) {
                spaceExit[sid] = snap.date;
              }
            });
          }
        }

        // Determine the "active" snapshot = latest snapshot whose date <= cutoff
        // Use cpiCalcDate (the user-specified calculation date) as the cutoff,
        // so only units that actually entered before that date are included.
        var cutoffDate = new Date(cpiCalcDate);
        var yearEndForSnap = new Date(year, 11, 31);
        var snapCutoff = cutoffDate < yearEndForSnap ? cutoffDate : yearEndForSnap;
        var activeSnapshot = snapshots[0];
        for (var s of snapshots) {
          if (s.date <= snapCutoff) activeSnapshot = s;
        }
        var spacesToProcess = activeSnapshot.spaces || [];
        var parkingMonthly = contractParkingMonthly[c.id] || 0;
        var parkingAddedToFirstSpace = false;

        // Process EACH space separately (per-unit view)
        for (var cs of spacesToProcess) {
          var area = cs.spaces?.area || 0;
          var spaceName = cs.spaces?.space_name || "—";
          // Add parking to first space only (to avoid double-counting)
          var thisParkingMonthly = 0;
          var thisParkingSpots = 0;
          if (!parkingAddedToFirstSpace && parkingMonthly > 0) {
            thisParkingMonthly = parkingMonthly;
            thisParkingSpots = contractParkingSpots[c.id] || 0;
            parkingAddedToFirstSpace = true;
          }

          // Base monthly rent for this space — detect step-rent changes
          var baseRentPerSqm = Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0;
          var isFixed = cs.charge_method === "fixed";
          var baseMonthly = isFixed ? Number(cs.fixed_rent) || 0 : baseRentPerSqm * area;
          var contractStartDate = new Date(c.start_date);

          // ─── SINGLE SOURCE OF TRUTH ───
          // Delegate the "what rent does the contract require at date X" question
          // to lib/contract-utils.ts. Same helper is used by CpiDiffTab fallback
          // and (eventually) by every screen that needs to know the contract's
          // effective rent at a point in time. Handles per-space tiers,
          // contract-level tiers, exercised options (new_value / increase_pct /
          // no_change), AND each option's internal price_tiers JSONB.
          var contractTiers = (allTiers ?? []).filter(function(t: any) { return t.contract_id === c.id && !t.space_id; });
          var spaceTiers = (allTiers ?? []).filter(function(t: any) { return t.contract_id === c.id && t.space_id === cs.space_id; });
          var contractOptions = (allOptions ?? []).filter(function(o: any) { return o.contract_id === c.id && o.is_exercised; });

          var schedule = buildSpaceRentSchedule({
            contractStartDate: c.start_date,
            spaceArea: area,
            isFixed: isFixed,
            spaceBaseRent: baseMonthly,
            spaceTiers: spaceTiers,
            contractTiers: contractTiers,
            exercisedOptions: contractOptions,
          });

          var yearStart = new Date(year, 0, 1);
          var yearEnd = new Date(year, 11, 31);
          var rentBeforeAnniversary = rentAtDate(schedule, yearStart);
          var rentAfterAnniversary = rentAtDate(schedule, yearEnd);

          // Anniversary = first schedule entry whose date falls in target year.
          // If no change in year, fall back to contract anniversary (used by
          // hasRentChange test below; if rentBefore === rentAfter the date is
          // irrelevant).
          var firstChangeInYear = schedule.find(function(e) {
            return e.date.getTime() >= yearStart.getTime() && e.date.getTime() <= yearEnd.getTime();
          });
          var anniversaryInYear = firstChangeInYear
            ? firstChangeInYear.date
            : new Date(year, contractStartDate.getMonth(), contractStartDate.getDate());

          // hasRentChange uses `>=` for Jan 1 contracts: an anniversary that
          // falls on Jan 1 still means the whole year is at the post-change rate.
          var hasRentChange = Math.abs(rentAfterAnniversary - rentBeforeAnniversary) > 0.01
            && anniversaryInYear.getTime() >= yearStart.getTime()
            && anniversaryInYear.getTime() <= yearEnd.getTime();

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
          var cbsFromDate = ""; // CBS's actual from-index period (e.g. "2021-7")
          var cbsVerifyUrl = "";
          var cpiPeakMonth: string | undefined = undefined;
          var cpiErrorMsg: string | undefined = undefined;

          if (c.indexation_method !== "none" && fromCbs && toCbs) {
            // Use retry wrapper — transient CBS failures (timeout / 5xx / brief
            // outage) auto-retried 3× with backoff before giving up. If we
            // still fail, the row gets a `cpiError` flag and the save-button
            // is blocked downstream. NO silent fallback to ratio=1.
            var cpiData = await fetchCpiAdjustedWithRetry({ value: 10000, fromDate: fromCbs, toDate: toCbs });
            if (!cpiData.success) {
              cpiErrorMsg = "CBS API נכשל אחרי 3 ניסיונות: " + (cpiData.error || "—");
            } else {
              try {
                cpiRatio = Number(cpiData.adjustedRentPerSqm) / 10000;
                cpiCurrentValue = Number(cpiData.toIndexValue) || 0;
                cpiCurrentDate = cpiData.toDate || "";
                cbsFromDate = cpiData.fromDate || "";
                if (!cpiBaseValue) cpiBaseValue = Number(cpiData.fromIndexValue) || 0;
                if (cpiData.fromIndexValue) cpiBaseValue = Number(cpiData.fromIndexValue);
                cbsVerifyUrl = cpiData.verificationUrl || "";

                // "מדד גבוה ביותר" / "no_drop" — CPI never decreases.
                // Use fetchHighestChainedCpi (server-side, scans CBS calculator
                // month-by-month for the PRECISE chained peak). Raw-value
                // comparison via the old fetchHighestCPI returned null when
                // CBS rejected the URL, AND would have given wrong peaks
                // across base-year boundaries (Israeli CPI re-bases every 2
                // years — raw values are not comparable across bases).
                var isHighest = c.indexation_method === "highest_in_period"
                  || c.index_mechanism === "highest_in_period"
                  || c.indexation_method === "no_drop"
                  || c.index_mechanism === "no_drop";
                if (isHighest && cpiBaseDate) {
                  var bD = new Date(cpiBaseDate);
                  var pD = new Date(cpiCalcDate);
                  if (pD.getDate() < 16) pD.setMonth(pD.getMonth() - 2);
                  else pD.setMonth(pD.getMonth() - 1);
                  var peak = await fetchHighestChainedCpiWithRetry({
                    baseFromDate: fromCbs!,
                    scanFromYear: bD.getFullYear(),
                    scanFromMonth: bD.getMonth() + 1,
                    scanToYear: pD.getFullYear(),
                    scanToMonth: pD.getMonth() + 1,
                  });
                  if (peak.success && peak.peakRatio && peak.peakRatio > cpiRatio) {
                    cpiRatio = peak.peakRatio;
                    cpiCurrentDate = `${peak.peakYear}-${String(peak.peakMonth).padStart(2, "0")}`;
                    cpiPeakMonth = `${peak.peakYear}-${String(peak.peakMonth).padStart(2, "0")}`;
                  } else if (!peak.success) {
                    // Highest scan failed — fall back to standard ratio (already
                    // computed above) but flag it: for highest contracts the
                    // standard ratio is approximate.
                    cpiErrorMsg = "סריקת שיא מדד נכשלה: " + (peak.error || "—") + " (משתמש ביחס t-2 בלבד)";
                  }
                }

                console.log("CBS for " + spaceName + ": ratio=" + cpiRatio.toFixed(6));
              } catch (e: any) {
                cpiErrorMsg = "שגיאת חישוב מדד: " + (e?.message || String(e));
              }
            }
          }

          // Indexed rent for before/after anniversary
          var indexedBefore = rentBeforeAnniversary * cpiRatio;
          var indexedAfter = rentAfterAnniversary * cpiRatio;
          var indexedMonthly = hasRentChange ? indexedAfter : rentAfterAnniversary * cpiRatio;
          var totalMonthly = indexedMonthly + mgmtMonthly + thisParkingMonthly;

          // Determine start date for this unit in the target year.
          // Each space has its own entry_date (= earliest date it appeared in the
          // contract, base start or amendment that added it). Likewise exit_date.
          var contractStart = new Date(c.start_date);
          var unitEntry = spaceEntry[cs.space_id] || contractStart;
          var yearStart = new Date(year, 0, 1);
          var yearEnd = new Date(year, 11, 31);
          var effectiveStart = unitEntry > yearStart ? unitEntry : yearStart;

          // Grace period: compute the end-date of grace from contract start
          var graceEndDate: Date | null = null;
          if (c.grace_months && Number(c.grace_months) > 0 && c.grace_type) {
            graceEndDate = new Date(contractStart);
            graceEndDate.setMonth(graceEndDate.getMonth() + Number(c.grace_months));
          }
          var graceDiscountPct = Number(c.grace_discount_pct) || 0;

          // If contract ends before year end, use contract end
          var contractEnd = c.end_date ? new Date(c.end_date) : yearEnd;
          var effectiveEnd = contractEnd < yearEnd ? contractEnd : yearEnd;
          // If unit was removed via amendment, cap at exit date — BUT only
          // for amendments that already exist as of the CPI calc date.
          // Future amendments (effective after cpiCalcDate) don't exist yet
          // from the perspective of the advance checks we're preparing now;
          // we must treat the unit as still belonging to the contract for
          // the full year, exactly mirroring the unit-entry cutoff above.
          var unitExit = spaceExit[cs.space_id];
          if (unitExit && unitExit < effectiveEnd && unitExit.getTime() <= cutoffDate.getTime()) {
            effectiveEnd = unitExit;
          }

          if (effectiveStart > effectiveEnd) continue; // Not active in this year
          // Skip units that enter AFTER the CPI calc date — those units didn't
          // exist yet when the advances were being prepared, so they can't be
          // part of this year's check book.
          if (unitEntry > cutoffDate) continue;

          // Grace helper: given a period [pStart, pEnd], compute how much of
          // the rent and management should actually be charged.
          // Returns {rentFactor, mgmtFactor} where 0 = fully in grace, 1 = no grace.
          var graceFactors = function(pStart: Date, pEnd: Date): { rentFactor: number; mgmtFactor: number; inGrace: boolean } {
            if (!graceEndDate || pStart >= graceEndDate) return { rentFactor: 1, mgmtFactor: 1, inGrace: false };
            // Period is fully or partially in grace
            var totalMs = pEnd.getTime() - pStart.getTime();
            if (totalMs <= 0) return { rentFactor: 1, mgmtFactor: 1, inGrace: false };
            var graceMs = Math.min(graceEndDate.getTime(), pEnd.getTime()) - pStart.getTime();
            if (graceMs <= 0) return { rentFactor: 1, mgmtFactor: 1, inGrace: false };
            var graceRatio = graceMs / totalMs; // portion of the period in grace
            var normalRatio = 1 - graceRatio;

            if (c.grace_type === "full") {
              // Full grace: no rent, no management during grace portion
              return { rentFactor: normalRatio, mgmtFactor: normalRatio, inGrace: true };
            } else if (c.grace_type === "rent_only") {
              // Grace on rent only: no rent, but management is charged normally
              return { rentFactor: normalRatio, mgmtFactor: 1, inGrace: true };
            } else if (c.grace_type === "partial") {
              // Partial discount on rent during grace, management normal
              var discountFactor = 1 - (graceDiscountPct / 100);
              return { rentFactor: normalRatio + graceRatio * discountFactor, mgmtFactor: 1, inGrace: true };
            }
            return { rentFactor: 1, mgmtFactor: 1, inGrace: false };
          };

          // Generate checks based on payment frequency
          var checks: CheckRow[] = [];

          if (isQuarterly) {
            for (var q = 0; q < 4; q++) {
              var qStart = new Date(year, q * 3, 1);
              var qEnd = new Date(year, (q + 1) * 3, 0);

              if (qEnd < effectiveStart) continue;
              if (qStart > effectiveEnd) continue;

              var periodStart = qStart < effectiveStart ? effectiveStart : qStart;
              var periodEnd = qEnd > effectiveEnd ? effectiveEnd : qEnd;

              var totalDaysInQuarter = Math.round((qEnd.getTime() - qStart.getTime()) / 86400000) + 1;
              var actualDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;

              // Handle rent change mid-quarter (step-rent on anniversary)
              var rentBV = 0;
              var labelExtra = "";
              var isFullQuarter = (actualDays === totalDaysInQuarter);

              if (hasRentChange && anniversaryInYear > periodStart && anniversaryInYear <= periodEnd) {
                // Split: month-by-month calculation within the quarter
                // Full months before/after the change date get full monthly rate
                // The month containing the change gets pro-rata by days
                rentBV = 0;
                var changeMonth = anniversaryInYear.getMonth(); // 0-indexed
                var changeDay = anniversaryInYear.getDate();
                for (var qm = 0; qm < 3; qm++) {
                  var monthIdx = q * 3 + qm; // 0-indexed month in year
                  var mStartD = new Date(year, monthIdx, 1);
                  var mEndD = new Date(year, monthIdx + 1, 0);
                  if (mEndD < periodStart || mStartD > periodEnd) continue;
                  var daysInThisMonth = daysInMonth(year, monthIdx + 1);
                  if (monthIdx === changeMonth) {
                    // Split month: days before change at old rate, days from change at new rate
                    var daysOld = changeDay - 1; // days 1 to (changeDay-1) at old rate
                    var daysNew = daysInThisMonth - daysOld; // from changeDay to end at new rate
                    rentBV += indexedBefore * daysOld / daysInThisMonth + indexedAfter * daysNew / daysInThisMonth;
                  } else if (monthIdx < changeMonth) {
                    rentBV += indexedBefore; // full month at old rate
                  } else {
                    rentBV += indexedAfter; // full month at new rate
                  }
                }
                var daysBefore = Math.round((anniversaryInYear.getTime() - periodStart.getTime()) / 86400000);
                var daysAfter = actualDays - daysBefore;
                labelExtra = " (עליית שכ\"ד " + fmtDate(anniversaryInYear.toISOString().split("T")[0]) + ": " + daysBefore + "+" + daysAfter + " ימים)";
              } else if (hasRentChange && anniversaryInYear <= periodStart) {
                // After anniversary — use new rate × exact months (not day-based)
                if (isFullQuarter) {
                  rentBV = indexedAfter * 3;
                } else {
                  rentBV = indexedAfter * 3 * actualDays / totalDaysInQuarter;
                }
              } else {
                // Before anniversary or no change — use old/base rate × exact months
                var useRate = hasRentChange ? indexedBefore : indexedMonthly;
                if (isFullQuarter) {
                  rentBV = useRate * 3;
                } else {
                  rentBV = useRate * 3 * actualDays / totalDaysInQuarter;
                }
              }

              var ratio = actualDays / totalDaysInQuarter;
              // Apply grace period adjustments
              var gf = graceFactors(periodStart, periodEnd);
              rentBV = rentBV * gf.rentFactor;
              var mgmtBV = mgmtMonthly * 3 * ratio * gf.mgmtFactor;
              var parkingBV = thisParkingMonthly * 3 * ratio;
              var totalBV = rentBV + mgmtBV + parkingBV;
              var vat = isVat ? totalBV * vatPct : 0;

              var checkDate = year + "-" + String(q * 3 + 1).padStart(2, "0") + "-01";
              var partialLabel = ratio < 0.99 ? " (חלקי — " + actualDays + " ימים)" : "";
              var graceLabel = gf.inGrace ? " (גרייס)" : "";

              // Round check total to whole shekels (banks don't accept agorot on checks)
              var rawTotal = totalBV + vat;
              var roundedTotal = Math.round(rawTotal);
              checks.push({
                label: "רבעון " + (q + 1) + partialLabel + labelExtra + graceLabel,
                months: 3,
                partialDays: ratio < 0.99 ? actualDays : 0,
                totalDaysInMonth: totalDaysInQuarter,
                checkDate: checkDate,
                rentBeforeVat: rentBV,
                mgmtBeforeVat: mgmtBV,
                totalBeforeVat: totalBV,
                vat: vat,
                totalWithVat: roundedTotal,
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

              // Handle rent change mid-month
              var rentBVM = 0;
              var labelExtraM = "";
              var isFullMonth = (actualDaysM === totalDaysMonth);
              if (hasRentChange && anniversaryInYear > periodStartM && anniversaryInYear <= periodEndM) {
                var daysBeforeM = Math.round((anniversaryInYear.getTime() - periodStartM.getTime()) / 86400000);
                var daysAfterM = actualDaysM - daysBeforeM;
                var dailyBeforeM = indexedBefore / totalDaysMonth;
                var dailyAfterM = indexedAfter / totalDaysMonth;
                rentBVM = dailyBeforeM * daysBeforeM + dailyAfterM * daysAfterM;
                labelExtraM = " (עליית שכ\"ד: " + daysBeforeM + "+" + daysAfterM + " ימים)";
              } else if (hasRentChange && anniversaryInYear <= periodStartM) {
                rentBVM = isFullMonth ? indexedAfter : indexedAfter * actualDaysM / totalDaysMonth;
              } else {
                var useRateM = hasRentChange ? indexedBefore : indexedMonthly;
                rentBVM = isFullMonth ? useRateM : useRateM * actualDaysM / totalDaysMonth;
              }

              // Apply grace period adjustments
              var gfM = graceFactors(periodStartM, periodEndM);
              rentBVM = rentBVM * gfM.rentFactor;
              var mgmtBVM = mgmtMonthly * ratioM * gfM.mgmtFactor;
              var parkingBVM = thisParkingMonthly * ratioM;
              var totalBVM = rentBVM + mgmtBVM + parkingBVM;
              var vatM = isVat ? totalBVM * vatPct : 0;

              var checkDateM = year + "-" + String(m + 1).padStart(2, "0") + "-01";
              var partialLabelM = ratioM < 0.99 ? " (חלקי — " + actualDaysM + " ימים)" : "";
              var graceLabelM = gfM.inGrace ? " (גרייס)" : "";

              // Round check total to whole shekels (banks don't accept agorot on checks)
              var rawTotalM = totalBVM + vatM;
              var roundedTotalM = Math.round(rawTotalM);
              checks.push({
                label: "חודש " + (m + 1) + partialLabelM + labelExtraM + graceLabelM,
                months: 1,
                partialDays: ratioM < 0.99 ? actualDaysM : 0,
                totalDaysInMonth: totalDaysMonth,
                checkDate: checkDateM,
                rentBeforeVat: rentBVM,
                mgmtBeforeVat: mgmtBVM,
                totalBeforeVat: totalBVM,
                vat: vatM,
                totalWithVat: roundedTotalM,
              });
            }
          }

          if (checks.length > 0) {
            rows.push({
              contractId: c.id,
              spaceId: cs.space_id,
              tenantName: (c.tenants as any)?.name || "—",
              spaceName: spaceName,
              spaceArea: area,
              // Use the year's effective rate (post-anniversary if mid-year
              // change, or the stable rate if no change). Previously this
              // fell back to `baseMonthly` (= contract-start rate), which
              // misleadingly displayed e.g. ₪40/m² for ג'ובניל 2026 even
              // though the option had bumped it to ₪42.5/m² in 2025.
              // The calculation always used rentAfter/rentBefore correctly;
              // only the displayed "שכ"ד בסיס" was wrong.
              baseRentMonthly: hasRentChange ? rentBeforeAnniversary : rentAfterAnniversary,
              indexedRentMonthly: hasRentChange ? indexedAfter : indexedMonthly,
              rentChangeDate: hasRentChange ? anniversaryInYear.toISOString().split("T")[0] : undefined,
              rentBefore: hasRentChange ? rentBeforeAnniversary : undefined,
              rentAfter: hasRentChange ? rentAfterAnniversary : undefined,
              rentSchedule: schedule.map(function(e) { return { date: e.date.toISOString().split("T")[0], rentMonthly: e.rentMonthly, source: e.source }; }),
              cpiPeakMonth: cpiPeakMonth,
              cpiError: cpiErrorMsg,
              vatPct: vatPct,
              isQuarterly: isQuarterly,
              mgmtAdvanceMonthly: mgmtMonthly,
              parkingMonthly: thisParkingMonthly,
              parkingSpots: thisParkingSpots,
              totalMonthly: totalMonthly,
              cpiBaseValue: cpiBaseValue,
              cpiBaseDate: cpiBaseDate,
              cbsFromDate: cbsFromDate,
              cpiCurrentValue: cpiCurrentValue,
              cpiCurrentDate: cpiCurrentDate,
              cpiRatio: cpiRatio,
              indexationMethod: c.indexation_method || "standard",
              startDate: effectiveStart.toISOString().split("T")[0],
              checks: checks,
            });
          }
        }
      }
      // Deduplicate: if the same space appears in multiple contracts
      // (e.g., standalone + amendment), keep only the first occurrence
      var seenSpaceIds = new Set<string>();
      rows = rows.filter(function(r) {
        if (seenSpaceIds.has(r.spaceId)) return false;
        seenSpaceIds.add(r.spaceId);
        return true;
      });

      // ─── TRUST LAYER: post-compute validation ───
      // Catches silent-failure patterns the calculation might have produced.
      // After this pass the user CANNOT save unless every row passes:
      //
      //   (1) Cross-space consistency: spaces in the same contract that
      //       share an index_base_date MUST get the same cpiRatio. A
      //       difference means at least one CBS call failed mid-batch.
      //
      //   (2) Suspicious ratio=1 on an indexed contract — the only way
      //       this should happen is if CBS itself returns identical from
      //       and to indices, which is virtually impossible for a real
      //       contract with multi-year span.
      var consistencyGroups: Record<string, AdvanceRow[]> = {};
      rows.forEach(function(r: AdvanceRow) {
        if (!r.cbsFromDate && !r.cpiBaseDate) return;
        var key = r.contractId + "|" + (r.cbsFromDate || r.cpiBaseDate);
        if (!consistencyGroups[key]) consistencyGroups[key] = [];
        consistencyGroups[key].push(r);
      });
      Object.values(consistencyGroups).forEach(function(group) {
        if (group.length < 2) return;
        var ratios = group.map(function(r) { return r.cpiRatio || 0; });
        var maxR = Math.max(...ratios);
        var minR = Math.min(...ratios);
        if (maxR - minR > 0.001) {
          group.forEach(function(r) {
            r.cpiInconsistent = "אי-עקביות בין יחידות עם אותו בסיס מדד (יחסים: " + minR.toFixed(6) + " — " + maxR.toFixed(6) + "). סביר שאחת הקריאות ל-CBS נכשלה — לחץ 'חשב מחדש'.";
          });
        }
      });
      rows.forEach(function(r: AdvanceRow) {
        if (r.indexationMethod && r.indexationMethod !== "none"
          && r.cpiRatio && Math.abs(r.cpiRatio - 1) < 0.0001
          && !r.cpiError) {
          r.cpiSuspicious = "יחס מדד = 1.0 על חוזה מוצמד — כמעט תמיד באג. לחץ 'חשב מחדש'.";
        }
      });

      setResults(rows);
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setComputing(false); setProgress(null); }
  }

  async function createCharges() {
    if (savedMode) {
      if (!confirm("המקדמות הנוכחיות נטענו מנתונים שמורים. שמירה תדרוס את הנתונים הקיימים. האם להמשיך?\n\nמומלץ: לחץ 'חשב מחדש' לפני שמירה כדי לחשב CPI מהלמ\"ס.")) return;
    }
    setCreatingCharges(true);
    var saveStart = Date.now();
    // Total = sum of checks across all spaces (one DB upsert per check)
    var totalChecks = results.reduce(function(s, r) { return s + r.checks.length; }, 0);
    setProgress({ current: 0, total: totalChecks, label: "שומר מקדמות...", startedAt: saveStart });
    try {
      var count = 0;
      for (var r of results) {
        for (var p of r.checks) {
          await supabase.from("advance_payments").upsert({
            contract_id: r.contractId,
            space_id: r.spaceId,
            property_id: propId,
            tenant_name: r.tenantName,
            space_name: r.spaceName,
            space_area: r.spaceArea,
            year: year,
            period: p.label.split(" (")[0],
            base_rent: r.baseRentMonthly * p.months,
            indexed_rent: p.rentBeforeVat,
            management_advance: p.mgmtBeforeVat,
            parking_monthly: r.parkingMonthly || 0,
            total_before_vat: p.totalBeforeVat,
            vat_amount: p.vat,
            total_with_vat: p.totalWithVat,
            check_date: p.checkDate,
            cpi_base_value: r.cpiBaseValue,
            cpi_at_payment: r.cpiCurrentValue,
            cpi_ratio: r.cpiRatio,
            cbs_from_date: r.cbsFromDate,
            cpi_current_date: r.cpiCurrentDate,
            cpi_calc_date: cpiCalcDate,
            status: "pending",
          }, { onConflict: "contract_id,space_id,year,period" });
          count++;
          setProgress({
            current: count,
            total: totalChecks,
            label: "שומר מקדמות — " + r.tenantName + " · " + r.spaceName,
            startedAt: saveStart,
          });
        }
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_advances", notes: count + " מקדמות" });
      alert("✅ נוצרו " + count + " מקדמות");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setCreatingCharges(false); setProgress(null); }
  }

  async function createLetters() {
    setCreatingLetters(true);
    try {
      // Load company details (property owner)
      var { data: propData } = await supabase.from("properties")
        .select("name, company_id, companies(company_name, address, city, phone, email, logo_url, bank_name, bank_branch, bank_account)")
        .eq("id", propId).single();
      var company = (propData?.companies as any) || {};
      var companyName = company.company_name || propData?.name || "";
      var companyAddress = [company.address, company.city].filter(Boolean).join(", ");
      var companyPhone = company.phone || "";
      var bankLine = "";
      if (company.bank_name && company.bank_account) {
        bankLine = "את ההמחאות יש לרשום לפקודת " + companyName + " חשבון " + company.bank_account + " סניף " + (company.bank_branch || "") + " " + company.bank_name + ".";
      }
      var logoUrl = company.logo_url || "";

      // Group rows by contract
      var byContract: Record<string, AdvanceRow[]> = {};
      for (var r of results) {
        if (!byContract[r.contractId]) byContract[r.contractId] = [];
        byContract[r.contractId].push(r);
      }
      var propName = propData?.name || "";
      var count = 0;
      var letterStart = Date.now();
      var contractIds = Object.keys(byContract);
      setProgress({ current: 0, total: contractIds.length, label: "יוצר מכתבי דרישה...", startedAt: letterStart });
      for (var [cid, unitRows] of Object.entries(byContract)) {
        var firstRow = unitRows[0];
        setProgress({
          current: count + 1,
          total: contractIds.length,
          label: "יוצר מכתב — " + firstRow.tenantName,
          startedAt: letterStart,
        });
        var tenantName = firstRow.tenantName;

        // Consolidate checks by date
        var checksByDate: Record<string, { date: string; total: number }> = {};
        var grandTotal = 0;
        for (var ur of unitRows) {
          for (var ch of ur.checks) {
            if (!checksByDate[ch.checkDate]) checksByDate[ch.checkDate] = { date: ch.checkDate, total: 0 };
            checksByDate[ch.checkDate].total += ch.totalWithVat;
            grandTotal += ch.totalWithVat;
          }
        }
        var sortedChecks = Object.values(checksByDate).sort(function(a, b) { return a.date.localeCompare(b.date); });
        var checksTable = "";
        sortedChecks.forEach(function(ck, i) {
          checksTable += (i + 1) + "\t" + fmtDate(ck.date) + "\t" + fmtMoney(ck.total) + "\n";
        });

        // Build appendix with full details
        var appendix = "";
        for (var ur2 of unitRows) {
          appendix += "UNIT_START|" + ur2.spaceName + "|" + ur2.spaceArea + '\n';
          appendix += "שטח מחויב: " + ur2.spaceArea + ' מ"ר\n';
          appendix += "שכ\"ד בסיס: " + fmtMoney(ur2.baseRentMonthly) + "/חודש";
          if (ur2.spaceArea > 0) appendix += " (" + (ur2.baseRentMonthly / ur2.spaceArea).toFixed(2) + '₪/מ"ר)';
          appendix += "\n";
          appendix += "שכ\"ד צמוד למדד: " + fmtMoney(ur2.indexedRentMonthly) + "/חודש";
          if (ur2.spaceArea > 0) appendix += " (" + (ur2.indexedRentMonthly / ur2.spaceArea).toFixed(2) + '₪/מ"ר)';
          appendix += "\n";
          appendix += "מקדמת דמי ניהול: " + fmtMoney(ur2.mgmtAdvanceMonthly) + "/חודש";
          if (ur2.spaceArea > 0) appendix += " (" + (ur2.mgmtAdvanceMonthly / ur2.spaceArea).toFixed(2) + '₪/מ"ר)';
          appendix += "\n";
          if (ur2.parkingMonthly > 0) {
            appendix += "🅿️ חניה: " + fmtMoney(ur2.parkingMonthly) + "/חודש";
            if (ur2.parkingSpots > 0) appendix += " (" + ur2.parkingSpots + " מקומות)";
            appendix += "\n";
          }
          // CPI details with month names
          var cpiBaseLabel = ur2.cbsFromDate || "";
          var cpiCurrentLabel = ur2.cpiCurrentDate || "";
          appendix += "מדד בסיס: " + (ur2.cpiBaseValue || "—");
          if (cpiBaseLabel) {
            var bParts = String(cpiBaseLabel).split("-");
            if (bParts.length >= 2) {
              var hebMonths = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
              appendix += " (" + (hebMonths[Number(bParts[1])] || bParts[1]) + " " + bParts[0] + ")";
            }
          }
          appendix += "\n";
          appendix += "מדד לחישוב: " + (ur2.cpiCurrentValue || "—");
          if (cpiCurrentLabel) {
            var cParts = String(cpiCurrentLabel).split("-");
            if (cParts.length >= 2) {
              var hebMonths2 = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
              appendix += " (" + (hebMonths2[Number(cParts[1])] || cParts[1]) + " " + cParts[0] + ")";
            }
          }
          appendix += "\n";
          appendix += "יחס הצמדה: " + (ur2.cpiRatio || 1).toFixed(6) + "\n";
          if (ur2.rentChangeDate) appendix += "⬆ עליית שכ\"ד מ-" + fmtDate(ur2.rentChangeDate) + "\n";
          appendix += "UNIT_END\n";
        }

        var unitsList = unitRows.map(function(u) { return u.spaceName; }).join(", ");

        // Build letter body
        var body = "לכבוד\n" + tenantName + "\n\nשלום רב,\n\n";
        body += "הנדון: המחאות עבור שנת שכירות " + year + "\n\n";
        body += "בהתאם להסכם השכירות ביננו נבקשכם להעביר אלינו:\n\n";
        body += sortedChecks.length + " המחאות עבור שנת שכירות " + year + ", כמפורט להלן:\n";
        body += "מקדמות עבור: " + propName + " — " + unitsList + "\n\n";
        body += "המחאה\tלתאריך\tבסכום בש\"ח\n";
        body += checksTable;
        body += "\nסה\"כ: " + fmtMoney(grandTotal) + "\n\n";
        body += "תחשיב סכום כל המחאה מפורט בנספח א'.\n\n";
        if (bankLine) body += bankLine + "\n\n";
        body += "בכבוד רב ובברכה,\n\n" + companyName;

        var propertyId = propId;
        var { error: insertErr } = await supabase.from("letters").insert({
          contract_id: cid,
          property_id: propertyId,
          letter_type: "demand",
          title: "דרישת מקדמות שכ\"ד ודמי ניהול " + year,
          content_json: {
            body: body,
            appendix: appendix,
            year: year,
            tenant: tenantName,
            companyName: companyName,
            companyAddress: companyAddress,
            companyPhone: companyPhone,
            logoUrl: logoUrl,
            bankLine: bankLine,
          },
          billing_year: year,
          billing_type: "advances",
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_advance_letters", notes: count + " מכתבים" });
      alert("✅ נוצרו " + count + " מכתבי דרישה");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setCreatingLetters(false); setProgress(null); }
  }

  var totalAllChecks = results.reduce(function(s, r) { return s + r.checks.reduce(function(ss, p) { return ss + p.totalWithVat; }, 0); }, 0);
  var totalRentOnly = results.reduce(function(s, r) { return s + r.checks.reduce(function(ss, p) { return ss + p.rentBeforeVat; }, 0); }, 0);
  var totalMgmtOnly = results.reduce(function(s, r) { return s + r.checks.reduce(function(ss, p) { return ss + p.mgmtBeforeVat; }, 0); }, 0);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">📋 מקדמות שכ&quot;ד — חישוב שייקים</h2>
        <p className="text-sm text-slate-500 mb-4">חישוב סכומי שייקים מראש לפי יחידה, כולל שכ&quot;ד צמוד למדד ומקדמת דמי ניהול. תומך ביחידות שמתחילות באמצע שנה (פרו-רטה).</p>

        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
            <select value={propId} onChange={function(e) { var v = e.target.value; setPropId(v); setContractFilter("all"); setResults([]); loadAvailableContracts(v); }} className={ic}>
              <option value="">— בחר נכס —</option>
              {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">הסכם / שוכר</label>
            <select value={contractFilter} onChange={function(e) { setContractFilter(e.target.value); setResults([]); }} className={ic}>
              <option value="all">כל ההסכמים</option>
              {availableContracts.map(function(c: any) {
                var spNames = (c.contract_spaces || []).map(function(cs: any) { return cs.spaces?.space_name; }).filter(Boolean).join(", ");
                return <option key={c.id} value={c.id}>{(c.tenants as any)?.name || "—"}{spNames ? " — " + spNames : ""}</option>;
              })}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שנת שכירות</label>
            <input type="number" value={year} onChange={function(e) { setYear(Number(e.target.value)); setResults([]); }} className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך חישוב מדד</label>
            <input type="date" value={cpiCalcDate} onChange={function(e) { setCpiCalcDate(e.target.value); if (!savedMode) setResults([]); }} className={ic} />
            <div className="text-xs text-slate-400 mt-0.5">המערכת תיקח את המדד הידוע בתאריך זה (t-2)</div>
          </div>
        </div>

        {/* Saved advances banner */}
        {savedInfo && savedMode && (
          <div className="rounded-lg bg-green-50 border border-green-300 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-green-600 text-xl">✅</span>
              <div>
                <div className="font-bold text-green-800 text-sm">נמצאו מקדמות שמורות לשנת {year}</div>
                <div className="text-xs text-green-600">{savedInfo.count} שייקים | נשמר ב-{fmtDate(savedInfo.savedAt)} | תאריך ערך מדד: {savedInfo.cpiCalcDate ? fmtDate(savedInfo.cpiCalcDate) : "—"}</div>
                {savedInfo.otherDates.length > 0 && (
                  <div className="text-xs text-amber-600 mt-0.5">⚠️ {savedInfo.otherDates[0]}</div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={function() { setSavedMode(false); setResults([]); setSavedInfo(null); }}
                className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">
                🔄 חשב מחדש
              </button>
            </div>
          </div>
        )}

        {!savedMode && (
          <button onClick={function() { setSavedMode(false); compute(); }} disabled={computing || !propId}
            className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {computing ? "מחשב..." : "חשב מקדמות"}
          </button>
        )}

        {progress && (
          <div className="mt-3">
            <CalcProgress {...progress} />
          </div>
        )}

        {checkingSaved && <div className="text-center py-4 text-slate-400 text-sm">בודק מקדמות שמורות...</div>}

        {results.length > 0 && (function() {
          var problemRows = results.filter(function(r: any) { return r.cpiError || r.cpiInconsistent || r.cpiSuspicious; });
          if (problemRows.length === 0) return null;
          return (
            <div className="mt-5 rounded-xl border-2 border-red-300 bg-red-50 p-4">
              <div className="font-bold text-red-800 mb-2">⚠️ נמצאו {problemRows.length} בעיות בחישוב — לא ניתן לשמור</div>
              <div className="text-xs text-red-700 space-y-1 mb-3">
                {problemRows.slice(0, 8).map(function(r: any, i: number) {
                  var msg = r.cpiError || r.cpiInconsistent || r.cpiSuspicious;
                  return (
                    <div key={i} className="border-r-2 border-red-300 pr-2">
                      <span className="font-semibold">{r.tenantName} — {r.spaceName}:</span> {msg}
                    </div>
                  );
                })}
                {problemRows.length > 8 && <div className="text-red-600">+ עוד {problemRows.length - 8} בעיות...</div>}
              </div>
              <div className="text-xs text-red-700">
                💡 הסיבה הנפוצה: כשל זמני של API הלמ"ס.
                לחץ <span className="font-bold">"חשב מחדש"</span> כדי לנסות שוב.
                ה-API נוסה אוטומטית 3 פעמים — אם זה עדיין נכשל, ייתכן עומס בצד הלמ"ס.
              </div>
            </div>
          );
        })()}

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
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-bold text-slate-800 text-sm">{r.tenantName}</div>
                      <div className="text-xs text-slate-500">📐 {r.spaceName} | {r.spaceArea} מ&quot;ר | תחילה: {fmtDate(r.startDate)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={function() {
                        setExpandedBreakdowns(function(prev) {
                          var next = Object.assign({}, prev);
                          next[ri] = !prev[ri];
                          return next;
                        });
                      }}
                      className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap"
                      title="הצג את כל שלבי החישוב — בסיס, עליות, מדד, ניהול, חניה, מע&quot;מ"
                    >
                      {expandedBreakdowns[ri] ? "🔼 הסתר חישוב" : "🔍 תראה לי איך חישבת"}
                    </button>
                    <div className="text-left">
                      <div className="text-sm font-bold text-green-700">{fmtMoney(unitTotal)}</div>
                      <div className="text-xs text-slate-500">סה&quot;כ שנתי כולל מע&quot;מ</div>
                    </div>
                  </div>

                  {/* "Show your work" breakdown panel */}
                  {expandedBreakdowns[ri] && (
                    <CalcBreakdown row={r as any} targetYear={year} />
                  )}

                  {/* Contract details */}
                  <div className="px-5 py-2 grid grid-cols-5 gap-2 text-xs border-b border-slate-100 bg-blue-50/30">
                    <div>
                      <div className="text-slate-500">שכ&quot;ד בסיס</div>
                      <div className="font-bold text-slate-800">{fmtMoney(r.baseRentMonthly)}/חודש</div>
                      {r.spaceArea > 0 && <div className="text-xs text-slate-400">(בסיס: {(r.baseRentMonthly / r.spaceArea).toFixed(2)}₪/מ&quot;ר)</div>}
                      {r.rentChangeDate && r.rentAfter && (
                        <div className="text-orange-600 mt-0.5">→ {fmtMoney(r.rentAfter)} מ-{fmtDate(r.rentChangeDate)}
                        {r.spaceArea > 0 && <span className="text-xs"> ({(r.rentAfter / r.spaceArea).toFixed(2)}₪/מ&quot;ר)</span>}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-slate-500">שכ&quot;ד צמוד</div>
                      <div className="font-bold text-green-700">{fmtMoney(r.indexedRentMonthly)}/חודש</div>
                      {r.spaceArea > 0 && <div className="text-xs text-green-600">(צמוד: {(r.indexedRentMonthly / r.spaceArea).toFixed(2)}₪/מ&quot;ר)</div>}
                    </div>
                    <div>
                      <div className="text-slate-500">מקדמת ד.נ.</div>
                      <div className="font-bold text-slate-800">{fmtMoney(r.mgmtAdvanceMonthly)}/חודש</div>
                    </div>
                    {r.parkingMonthly > 0 && (
                    <div>
                      <div className="text-slate-500">🅿️ חניה</div>
                      <div className="font-bold text-slate-800">{fmtMoney(r.parkingMonthly)}/חודש</div>
                      {r.parkingSpots > 0 && <div className="text-xs text-slate-400">({r.parkingSpots} מקומות × {fmtMoney(r.parkingMonthly / r.parkingSpots)})</div>}
                    </div>
                    )}
                    <div>
                      <div className="text-slate-500">מדד בסיס</div>
                      <div className="font-bold text-slate-800">{r.cpiBaseValue || "—"}</div>
                      {r.cpiBaseValue ? (
                        <div className="text-xs text-blue-600 font-semibold">📊 מדד {r.cbsFromDate ? (function() {
                          var parts = r.cbsFromDate.split("-");
                          return parts.length >= 2 ? formatPeriod(Number(parts[0]), Number(parts[1])) : r.cbsFromDate;
                        })() : (r.cpiBaseDate ? formatPeriod(new Date(r.cpiBaseDate).getFullYear(), new Date(r.cpiBaseDate).getMonth()+1) : "")}</div>
                      ) : null}
                    </div>
                    <div>
                      <div className="text-slate-500">מדד לחישוב</div>
                      <div className="font-bold text-slate-800">{r.cpiCurrentValue || "—"}</div>
                      {r.cpiCurrentValue ? (
                        <div className="text-xs text-blue-600 font-semibold">📊 מדד {r.cpiCurrentDate ? (function() {
                          var parts = String(r.cpiCurrentDate).split("-");
                          return parts.length >= 2 ? formatPeriod(Number(parts[0]), Number(parts[1])) : r.cpiCurrentDate;
                        })() : ""}</div>
                      ) : null}
                      {r.cpiBaseValue > 0 && r.cpiCurrentValue > 0 && (
                        <div className="text-blue-600 mt-0.5">יחס: {(r.cpiRatio || 1).toFixed(6)}</div>
                      )}
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

            {/* ═══ Consolidated check tables per CONTRACT ═══ */}
            {(function() {
              // Group results by contractId
              var byContract: Record<string, AdvanceRow[]> = {};
              results.forEach(function(r) {
                if (!byContract[r.contractId]) byContract[r.contractId] = [];
                byContract[r.contractId].push(r);
              });
              var contractGroups = Object.entries(byContract).filter(function(e) { return e[1].length > 0; });
              if (contractGroups.length === 0) return null;
              return (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-slate-800 border-t-2 border-slate-300 pt-4 mt-4">📋 טבלה מרכזת לפי הסכם — סכומי שייקים</h3>
                  <p className="text-sm text-slate-500">סיכום כל היחידות לכל הסכם — השוכר רושם שייק אחד לכל תקופה</p>

                  {contractGroups.map(function([cid, unitRows]) {
                    var tenantName = unitRows[0].tenantName;
                    var spaceNames = unitRows.map(function(r) { return r.spaceName; }).join(", ");
                    // Merge checks across units for same period
                    var periodMap: Record<string, { label: string; checkDate: string; rent: number; mgmt: number; total: number; vat: number; withVat: number; }> = {};
                    unitRows.forEach(function(r) {
                      r.checks.forEach(function(ch) {
                        var key = ch.checkDate;
                        if (!periodMap[key]) periodMap[key] = { label: ch.label.split(" (")[0], checkDate: ch.checkDate, rent: 0, mgmt: 0, total: 0, vat: 0, withVat: 0 };
                        periodMap[key].rent += ch.rentBeforeVat;
                        periodMap[key].mgmt += ch.mgmtBeforeVat;
                        periodMap[key].total += ch.totalBeforeVat;
                        periodMap[key].vat += ch.vat;
                        periodMap[key].withVat += ch.totalWithVat;
                      });
                    });
                    var consolidatedChecks = Object.values(periodMap).sort(function(a, b) { return a.checkDate.localeCompare(b.checkDate); });
                    var contractTotal = consolidatedChecks.reduce(function(s, ch) { return s + ch.withVat; }, 0);

                    return (
                      <div key={cid} className="rounded-xl border-2 border-blue-300 bg-blue-50/30 shadow-sm overflow-hidden">
                        <div className="px-5 py-3 bg-blue-100 border-b border-blue-300 flex items-center justify-between">
                          <div>
                            <div className="font-bold text-blue-900 text-base">{tenantName}</div>
                            <div className="text-xs text-blue-700">{spaceNames} ({unitRows.length} יחידות)</div>
                          </div>
                          <div className="text-left">
                            <div className="text-lg font-black text-blue-900">{fmtMoney(contractTotal)}</div>
                            <div className="text-xs text-blue-700">סה&quot;כ שנתי כולל מע&quot;מ</div>
                          </div>
                        </div>
                        <table className="w-full text-sm text-right">
                          <thead className="bg-blue-50 text-xs">
                            <tr>
                              <th className="px-4 py-2 font-bold text-blue-800">תקופה</th>
                              <th className="px-4 py-2 font-bold text-blue-800">תאריך שייק</th>
                              <th className="px-4 py-2 font-bold text-blue-800">שכ&quot;ד צמוד</th>
                              <th className="px-4 py-2 font-bold text-blue-800">ד.נ.</th>
                              <th className="px-4 py-2 font-bold text-blue-800">לפני מע&quot;מ</th>
                              <th className="px-4 py-2 font-bold text-blue-800">מע&quot;מ</th>
                              <th className="px-4 py-2 font-bold text-blue-800">סכום שייק</th>
                            </tr>
                          </thead>
                          <tbody>
                            {consolidatedChecks.map(function(ch, ci) {
                              return (
                                <tr key={ci} className="border-t border-blue-200 hover:bg-blue-50">
                                  <td className="px-4 py-2.5 font-bold text-blue-900">{ch.label}</td>
                                  <td className="px-4 py-2.5 text-slate-700">{fmtDate(ch.checkDate)}</td>
                                  <td className="px-4 py-2.5 text-green-700 font-semibold">{fmtMoney(ch.rent)}</td>
                                  <td className="px-4 py-2.5 text-slate-600">{fmtMoney(ch.mgmt)}</td>
                                  <td className="px-4 py-2.5 text-slate-800">{fmtMoney(ch.total)}</td>
                                  <td className="px-4 py-2.5 text-slate-500">{fmtMoney(ch.vat)}</td>
                                  <td className="px-4 py-2.5 font-black text-blue-800 text-base">{fmtMoney(ch.withVat)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-blue-100 border-t-2 border-blue-300">
                            <tr>
                              <td className="px-4 py-2.5 font-black text-blue-900" colSpan={2}>סה&quot;כ שנתי</td>
                              <td className="px-4 py-2.5 font-bold text-green-800">{fmtMoney(consolidatedChecks.reduce(function(s,c){return s+c.rent;},0))}</td>
                              <td className="px-4 py-2.5 font-bold text-slate-700">{fmtMoney(consolidatedChecks.reduce(function(s,c){return s+c.mgmt;},0))}</td>
                              <td className="px-4 py-2.5 font-bold text-slate-800">{fmtMoney(consolidatedChecks.reduce(function(s,c){return s+c.total;},0))}</td>
                              <td className="px-4 py-2.5 font-bold text-slate-500">{fmtMoney(consolidatedChecks.reduce(function(s,c){return s+c.vat;},0))}</td>
                              <td className="px-4 py-2.5 font-black text-blue-900 text-lg">{fmtMoney(contractTotal)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Grand total */}
            <div className="rounded-xl bg-purple-50 border-2 border-purple-200 p-4 text-center">
              <div className="text-2xl font-black text-purple-800">{fmtMoney(totalAllChecks)}</div>
              <div className="text-sm text-purple-600">סה&quot;כ מקדמות לכל היחידות — שנת {year}</div>
            </div>

            {/* Progress shown right above the action buttons so the user
                doesn't need to scroll back up during long save / letter
                operations. Same `progress` state as the one near compute. */}
            {progress && (
              <CalcProgress {...progress} />
            )}

            <div className="flex gap-3">
              {(function() {
                var hasProblems = results.some(function(r: any) {
                  return r.cpiError || r.cpiInconsistent || r.cpiSuspicious;
                });
                return (
                  <>
                    <button onClick={createCharges} disabled={creatingCharges || hasProblems}
                      title={hasProblems ? "לא ניתן לשמור כאשר יש בעיות חישוב — לחץ 'חשב מחדש'" : ""}
                      className={"rounded-lg px-5 py-2.5 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed " + (savedMode ? "border-2 border-green-500 bg-green-50 text-green-700 hover:bg-green-100" : "bg-blue-700 text-white hover:bg-blue-800")}>
                      {creatingCharges ? "שומר..." : hasProblems ? "🚫 לא ניתן לשמור — יש בעיות חישוב" : savedMode ? "✅ נשמר — לחץ לשמור מחדש" : "💾 שמור מקדמות"}
                    </button>
                    <button onClick={createLetters} disabled={creatingLetters || hasProblems}
                      title={hasProblems ? "לא ניתן ליצור מכתבים כאשר יש בעיות חישוב" : ""}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed">
                      {creatingLetters ? "יוצר..." : "📄 צור מכתבי דרישה"}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
