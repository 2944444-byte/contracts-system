"use client";
import React, { useState } from "react";
import { graceFactorsFor } from "@/lib/store-opening";
import { standingDiscount, applyStanding } from "@/lib/concessions";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit-log";
import { fetchCpiAdjusted, fetchHighestChainedCpi, fetchCpiAdjustedWithRetry, fetchHighestChainedCpiWithRetry } from "@/lib/cpi-server";
import { getGraceDaysForProperty, dueDateFromGrace } from "@/lib/grace-days";
import { getVatPct, getVatRates, vatPctAt, getVatTypeMap, applyVat } from "@/lib/vat";
import CalcProgress, { CalcProgressState } from "./CalcProgress";
import { tierAppliesAtYear, buildSpaceRentSchedule, rentAtDate } from "@/lib/contract-utils";

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
    // Marks periods where a contract amendment changed which units are
    // active. Filled with human-readable notes like "+ קומה 3 (1.2.2026)"
    // or "↔ חנות 4 → חנות 6 (13.3.2026)". Undefined = no change.
    amendmentNote?: string;
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
  const [vatPct, setVatPct] = useState(0.18);
  const [vatTypeMap, setVatTypeMap] = useState<Record<string, string>>({});
  React.useEffect(function(){ getVatPct().then(setVatPct); }, []);
  React.useEffect(function(){ if (results.length) getVatTypeMap(results.map(function(r:any){ return r.contractId; })).then(setVatTypeMap); }, [results]);
  const [actualPaidInputs, setActualPaidInputs] = useState<Record<string, Record<string, string>>>({});
  const [creatingCharges, setCreatingCharges] = useState(false);
  const [creatingLetters, setCreatingLetters] = useState(false);
  const [existingCpiCharges, setExistingCpiCharges] = useState<any[]>([]);
  const [savedMode, setSavedMode] = useState(false);
  const [savedInfo, setSavedInfo] = useState<{ count: number; savedAt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Option for combined letter
  const [includeAdvances, setIncludeAdvances] = useState(true);
  const [nextYear, setNextYear] = useState(currentYear + 1);

  // Auto-load saved on property/year change
  React.useEffect(function() {
    if (propId) { checkSavedDiff(); loadExistingCpiCharges(); }
    else setExistingCpiCharges([]);
  }, [propId, year]);

  async function loadExistingCpiCharges() {
    if (!propId) { setExistingCpiCharges([]); return; }
    var { data } = await supabase.from("charges")
      .select("id, total_amount, status, contract_id, notes, contracts!charges_contract_id_fkey(property_id, tenants(name))")
      .eq("charge_type", "cpi_diff")
      .eq("billing_period_start", year + "-01-01");
    setExistingCpiCharges((data ?? []).filter(function(x:any){ return x.contracts?.property_id === propId; }));
  }

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
    var saveStart = Date.now();
    setProgress({ current: 0, total: 0, label: "שומר חישובי הפרשי הצמדה...", startedAt: saveStart });
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
    finally { setSaving(false); setProgress(null); }
  }

  async function compute() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    setComputing(true);
    setResults([]);
    var calcStart = Date.now();
    setProgress({ current: 0, total: 0, label: "טוען נתוני חוזים...", startedAt: calcStart });
    try {
      var { data: contracts } = await supabase.from("contracts")
        .select("id, rent_per_sqm, charged_area, investment_addition, payment_method, payment_frequency, vat_type, indexation_method, index_mechanism, index_base_date, index_base_value, start_date, end_date, is_amendment, grace_months, grace_days, grace_type, grace_discount_pct, grace_mgmt_discount_pct, grace_ends_on_opening, planned_handover_date, actual_handover_date, planned_opening_date, actual_opening_date, rent_type, minimum_rent, mgmt_included_in_revenue, tenants(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))")
        .eq("property_id", propId)
        .in("status", ["active", "extended"])
        .eq("is_amendment", false);

      // Standing concessions apply as each period is computed, exactly like the
      // grace — a discount agreed for a period must reach the rent itself, not
      // wait to be waived off a charge afterwards.
      var contractIds = (contracts ?? []).map(function(x: any){ return x.id; });
      var concByContract: Record<string, any[]> = {};
      if (contractIds.length > 0) {
        var { data: concRows } = await supabase.from("concessions")
          .select("*").eq("scope", "standing").eq("status", "active").in("contract_id", contractIds);
        (concRows ?? []).forEach(function(x: any){
          if (x.contract_id) (concByContract[x.contract_id] = concByContract[x.contract_id] || []).push(x);
        });
      }

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

      // Full VAT history → each period's "correct" amount is taxed at the rate
      // in effect on that period's actual REDEMPTION date (see periodVat in the
      // loop). The reconciliation against the amount actually paid then captures
      // any VAT-rate gap; the diff charge isn't re-taxed (it's already inclusive).
      var vatRates = await getVatRates();

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

      // Load amendments to detect mid-year unit changes. Each amendment
      // carries its own snapshot of contract_spaces. Unlike AdvancesTab
      // (which freezes the snapshot at cpiCalcDate), CpiDiff DOES want
      // to respect mid-year amendments — the diff calc reflects what
      // each unit ACTUALLY required at each moment in time.
      var { data: allAmendments } = await supabase.from("contracts")
        .select("id, parent_contract_id, amendment_date, amendment_notes, start_date, end_date, contract_spaces(space_id, charge_method, fixed_rent, price_per_sqm, spaces(space_name, area))")
        .in("parent_contract_id", contractIds)
        .eq("is_amendment", true)
        .order("amendment_date", { ascending: true });

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
        // ─── SINGLE SOURCE OF TRUTH ───
        // Same helper AdvancesTab uses — guarantees rent base agreement
        // across screens. Handles per-space tiers, contract-level tiers,
        // options (new_value / increase_pct / no_change), and the option's
        // internal price_tiers JSONB.
        var contractStartDate = new Date(c.start_date);
        var contractTiers = (allTiers ?? []).filter(function(t: any) { return t.contract_id === c.id && !t.space_id; });
        var contractOptions = (allOptions ?? []).filter(function(o: any) { return o.contract_id === c.id && o.is_exercised; });

        // Amendment-aware snapshots — base + each amendment carries its
        // own contract_spaces. We use them to determine which units are
        // active at each moment during the target year. CpiDiff DOES want
        // to reflect mid-year amendments (unlike AdvancesTab which freezes
        // at cpiCalcDate) — at year-end reconciliation the diff captures
        // what the tenant actually owed each month based on real unit state.
        type Snapshot = { date: Date; spaces: any[]; notes: string | null; prevSpaceIds: Set<string> | null };
        var cAmendments = (allAmendments ?? []).filter(function(a: any) { return a.parent_contract_id === c.id; });
        var snapshots: Snapshot[] = [{ date: new Date(c.start_date), spaces: c.contract_spaces || [], notes: null, prevSpaceIds: null }];
        cAmendments.forEach(function(am: any) {
          snapshots.push({
            date: new Date(am.amendment_date || am.start_date),
            spaces: am.contract_spaces || [],
            notes: am.amendment_notes || null,
            prevSpaceIds: null,
          });
        });
        snapshots.sort(function(a, b) { return a.date.getTime() - b.date.getTime(); });
        for (var si = 1; si < snapshots.length; si++) {
          snapshots[si].prevSpaceIds = new Set(snapshots[si-1].spaces.map(function(s: any) { return s.space_id; }));
        }
        var activeSnapshotAt = function(date: Date): Snapshot {
          var active = snapshots[0];
          for (var s of snapshots) {
            if (s.date.getTime() <= date.getTime()) active = s;
          }
          return active;
        };
        var describeSnapshotChange = function(snap: Snapshot): string {
          if (!snap.prevSpaceIds) return "שינוי בהסכם";
          var currentIds = new Set(snap.spaces.map(function(s: any) { return s.space_id; }));
          var added: string[] = [];
          snap.spaces.forEach(function(s: any) {
            if (!snap.prevSpaceIds!.has(s.space_id)) added.push(s.spaces?.space_name || "יחידה חדשה");
          });
          var removedCount = 0;
          snap.prevSpaceIds.forEach(function(id: string) {
            if (!currentIds.has(id)) removedCount++;
          });
          var dateStr = snap.date.toLocaleDateString("he-IL");
          var parts: string[] = [];
          if (added.length) parts.push("+ " + added.join(", "));
          if (removedCount > 0) parts.push("− " + removedCount + " יחידות");
          if (snap.notes) parts.push("(" + snap.notes.substring(0, 40) + ")");
          return (parts.length > 0 ? parts.join(" / ") : "שינוי בהסכם") + " — " + dateStr;
        };

        // Helper: compute rent + mgmt for a given snapshot at a given date.
        // Each space uses buildSpaceRentSchedule (same as AdvancesTab).
        var computeSnapshotRentAt = function(snap: Snapshot, atDate: Date): { rent: number; mgmt: number } {
          var totalRent = 0;
          var totalMgmt = 0;
          (snap.spaces || []).forEach(function(cs: any) {
            var area = Number(cs.spaces?.area) || 0;
            var isFixed = cs.charge_method === "fixed";
            var baseRentPerSqm = Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0;
            var spaceStart = isFixed ? (Number(cs.fixed_rent) || 0) : baseRentPerSqm * area;
            var spaceTiers = (allTiers ?? []).filter(function(t: any) { return t.contract_id === c.id && t.space_id === cs.space_id; });
            var sched = buildSpaceRentSchedule({
              contractStartDate: c.start_date,
              spaceArea: area,
              isFixed: isFixed,
              spaceBaseRent: spaceStart,
              spaceTiers: spaceTiers,
              contractTiers: contractTiers,
              exercisedOptions: contractOptions,
            });
            totalRent += rentAtDate(sched, atDate);
            var mgmtRate = spaceMgmtRate[cs.space_id] ?? defaultMgmtRate;
            totalMgmt += mgmtRate * area;
          });
          return { rent: totalRent, mgmt: totalMgmt };
        };

        var yearStart = new Date(year, 0, 1);
        var yearEnd = new Date(year, 11, 31);

        var startMonthly = 0;
        var rentBeforeAnniversary = 0;
        var rentAfterAnniversary = 0;
        var anniversaryInYear = new Date(year, contractStartDate.getMonth(), contractStartDate.getDate());

        (c.contract_spaces || []).forEach(function(cs: any) {
          var area = Number(cs.spaces?.area) || 0;
          var isFixed = cs.charge_method === "fixed";
          var baseRentPerSqm = Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0;
          var spaceStart = isFixed ? (Number(cs.fixed_rent) || 0) : baseRentPerSqm * area;
          startMonthly += spaceStart;

          var spaceTiers = (allTiers ?? []).filter(function(t: any) { return t.contract_id === c.id && t.space_id === cs.space_id; });
          var schedule = buildSpaceRentSchedule({
            contractStartDate: c.start_date,
            spaceArea: area,
            isFixed: isFixed,
            spaceBaseRent: spaceStart,
            spaceTiers: spaceTiers,
            contractTiers: contractTiers,
            exercisedOptions: contractOptions,
          });

          rentBeforeAnniversary += rentAtDate(schedule, yearStart);
          rentAfterAnniversary += rentAtDate(schedule, yearEnd);

          // First per-space change inside target year → contract-level anniversary
          var firstChangeInYear = schedule.find(function(e) {
            return e.date.getTime() >= yearStart.getTime() && e.date.getTime() <= yearEnd.getTime();
          });
          if (firstChangeInYear && firstChangeInYear.date.getTime() !== anniversaryInYear.getTime()) {
            // If multiple spaces have different change dates, prefer the EARLIEST
            // (so the split-month logic handles the first transition; later ones
            // are rare and handled by re-running fresh advances if needed).
            if (firstChangeInYear.date.getTime() < anniversaryInYear.getTime() || !rentBeforeAnniversary) {
              anniversaryInYear = firstChangeInYear.date;
            }
          }
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

        // Grace period: compute end-date from contract start
        var graceEndDate: Date | null = null;
        if (c.grace_months && Number(c.grace_months) > 0 && c.grace_type) {
          graceEndDate = new Date(contractStartDate);
          graceEndDate.setMonth(graceEndDate.getMonth() + Number(c.grace_months));
        }
        var graceDiscountPct = Number(c.grace_discount_pct) || 0;

        // One grace implementation for the whole system (lib/store-opening.ts):
        // it knows the fit-out window, that the store opening can cut the grace
        // short, and the management-fee discount. Behaviour for a contract with
        // no opening milestone is identical to what this block did before.
        var graceFactors = function(pStart: Date, pEnd: Date): { rentFactor: number; mgmtFactor: number } {
          var f = graceFactorsFor({ contract: c, periodStart: pStart, periodEnd: pEnd });
          return { rentFactor: f.rentFactor, mgmtFactor: f.mgmtFactor };
        };

        var periods: CpiDiffRow["periods"] = [];

        for (var pi = 0; pi < periodsCount; pi++) {
          var payMonth = isQuarterly ? pi * 3 + 1 : pi + 1;
          var paymentDate = year + "-" + String(payMonth).padStart(2, "0") + "-01";
          var label = isQuarterly ? "רבעון " + (pi + 1) : "חודש " + payMonth;

          // VAT tax-point: rent is taxed at the rate in effect when the cheque is
          // actually REDEEMED. Use the matching advance's redemption/clearing date
          // if known, else the scheduled payment date. So the "correct" amount
          // (shouldPay) carries the redemption-date rate, while actualPaid keeps
          // the rate it was paid at — the difference therefore captures any VAT
          // gap (e.g. base 100 paid 117 at 17%, redeemed when 18% → 1 owed).
          // No rate change in the window ⇒ periodVat == today's rate (a no-op).
          var periodAdvForVat = (savedAdvances ?? []).filter(function(a: any){ return a.contract_id === c.id && a.period === label; });
          var redemptionDates = periodAdvForVat
            .map(function(a: any){ return a.clearing_date || a.actual_paid_date || a.deposited_date || a.received_date; })
            .filter(Boolean)
            .sort();
          var vatDateForPeriod = redemptionDates.length ? redemptionDates[redemptionDates.length - 1] : paymentDate;
          var periodVat = vatPctAt(vatRates, vatDateForPeriod);

          // Period boundaries
          var periodStart = new Date(year, isQuarterly ? pi * 3 : pi, 1);
          var periodEnd = new Date(year, isQuarterly ? (pi + 1) * 3 : pi + 1, 0);
          var daysInPeriod = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;

          // ── Snapshot-aware: pick active spaces at period start ──
          // For periods affected by an amendment (later than the contract
          // base or any prior amendment), recompute rent + mgmt from the
          // ACTIVE snapshot's spaces. This is how CpiDiff captures mid-year
          // unit additions/removals as additional differences against the
          // saved advance amounts.
          var activeSnap = activeSnapshotAt(periodStart);
          var prevPeriodStart = new Date(year, isQuarterly ? (pi - 1) * 3 : pi - 1, 1);
          var prevActiveSnap = pi > 0 ? activeSnapshotAt(prevPeriodStart) : null;
          var snapshotChangedThisPeriod = prevActiveSnap != null && activeSnap.date.getTime() !== prevActiveSnap.date.getTime();
          var amendmentNote: string | undefined = undefined;
          if (snapshotChangedThisPeriod && activeSnap.prevSpaceIds) {
            amendmentNote = describeSnapshotChange(activeSnap);
          }

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

          // ── Snapshot override ──
          // If an amendment is active for this period (different snapshot
          // than the contract base), recompute periodBaseRent + mgmt from
          // that snapshot's actual spaces. Uses the same buildSpaceRentSchedule
          // helper as AdvancesTab — so unit additions add their rent and
          // unit removals subtract theirs.
          var snapshotMgmtPeriod: number | null = null;
          if (activeSnap.date.getTime() > new Date(c.start_date).getTime()) {
            var snapMonthly = computeSnapshotRentAt(activeSnap, periodStart);
            periodBaseRent = snapMonthly.rent * monthsPerPeriod;
            snapshotMgmtPeriod = snapMonthly.mgmt * monthsPerPeriod;
          }

          var baseRentPeriodWithVat = periodBaseRent * (isVat ? 1 + periodVat : 1);

          // Get CPI at payment date (t-2 known index)
          var toCbs = formatDateForCbs(paymentDate);
          var indexedRent = baseRentPeriodWithVat;
          var cpiMonth = "";
          var cpiValue = 0;
          var cpiBaseValue = Number(c.index_base_value) || 0;
          var cpiBaseMonth = cpiBaseDate ? new Date(cpiBaseDate).toLocaleDateString("he-IL", { month: "short", year: "numeric" }) : "";

          if (c.indexation_method !== "none" && fromCbs && toCbs) {
            try {
              // Retry on transient CBS failures — see lib/cpi-server.ts.
              // 3 attempts with exponential backoff; if all fail the catch
              // below records the error and the period's diff stays at the
              // saved-baseline result (ratio doesn't update).
              var cpiData = await fetchCpiAdjustedWithRetry({ value: 10000, fromDate: fromCbs, toDate: toCbs });
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
                  var peak = await fetchHighestChainedCpiWithRetry({
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

                indexedRent = periodBaseRent * ratio * (isVat ? 1 + periodVat : 1);
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
          var hasSavedRentBase = matchingAdvances.length > 0
            && matchingAdvances.every(function(a: any) {
              return Number(a.cpi_ratio) > 0 && Number(a.indexed_rent) > 0;
            });
          // If an amendment is active for THIS period, saved data (frozen at
          // cpiCalcDate) is stale for the rent base — force fresh compute.
          // actualPaid still comes from saved (= what was actually charged).
          var snapshotIsAmended = activeSnap.date.getTime() > new Date(c.start_date).getTime();
          var hasSavedRent = hasSavedRentBase && !snapshotIsAmended;

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
            indexedRent = savedRentBaseSum * ratio * (isVat ? 1 + periodVat : 1);
            // Non-rent (mgmt + parking + whatever) = saved_total minus saved rent
            var savedRentWithVat = savedRentIndexedSum * (isVat ? 1 + periodVat : 1);
            mgmtAfterGrace = savedTotalSum - savedRentWithVat;
            // actualPaid: user input > saved actual_paid > saved total_with_vat
            var savedActualPaid = matchingAdvances.reduce(function(s: number, a: any) {
              return s + (Number(a.actual_paid) || Number(a.total_with_vat) || 0);
            }, 0);
            actualPaid = userInput ? Number(userInput) : savedActualPaid;
          } else {
            // Fallback: apply grace to the fresh computation. When the
            // active snapshot is amended, use the snapshot's mgmt rate
            // instead of the base mgmt (e.g. an added unit also adds its
            // own mgmt charge).
            var gf = graceFactors(periodStart, periodEnd);
            indexedRent = indexedRent * gf.rentFactor;
            var basePeriodMgmt = snapshotMgmtPeriod !== null
              ? snapshotMgmtPeriod * (isVat ? 1 + periodVat : 1)
              : mgmtPeriod * (isVat ? 1 + periodVat : 1);
            mgmtAfterGrace = basePeriodMgmt * gf.mgmtFactor;
            var savedTotalForPeriod = matchingAdvances.reduce(function(s: number, a: any) {
              return s + (Number(a.actual_paid) || Number(a.total_with_vat) || 0);
            }, 0);
            actualPaid = userInput ? Number(userInput) : (savedTotalForPeriod > 0 ? savedTotalForPeriod : baseRentPeriodWithVat + basePeriodMgmt);
          }

          // The period's own discount: rent and management are scoped
          // separately, so "50% off rent" leaves management untouched.
          var cList = concByContract[c.id] || [];
          var dRent = standingDiscount({ concessions: cList, date: periodStart, kind: "rent" });
          var dMgmt = standingDiscount({ concessions: cList, date: periodStart, kind: "mgmt" });
          var rentAfterConc = applyStanding(indexedRent, dRent);
          var mgmtAfterConc = applyStanding(mgmtAfterGrace, dMgmt);
          var concDiscount = Math.round(((indexedRent - rentAfterConc) + (mgmtAfterGrace - mgmtAfterConc)) * 100) / 100;
          indexedRent = rentAfterConc;
          mgmtAfterGrace = mgmtAfterConc;

          var shouldPay = indexedRent + mgmtAfterGrace;
          var baseRentDisplay = hasSavedRent
            ? (matchingAdvances.reduce(function(s: number, a: any) { return s + (Number(a.indexed_rent) || 0) / Number(a.cpi_ratio); }, 0)) * (isVat ? 1 + periodVat : 1)
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
            amendmentNote: amendmentNote,
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

  // Create OR fix CPI-diff charges (update existing for the same contract+year,
  // insert for new tenants).
  async function createCharges() {
    var withDiff = results.filter(function(r) { return Math.abs(r.totalDifference) >= 1; });
    var byContract: Record<string, any> = {};
    existingCpiCharges.forEach(function(c:any){ byContract[c.contract_id] = c; });
    var willFix = withDiff.filter(function(r){ return byContract[r.contractId]; }).length;
    if (willFix > 0) {
      if (!confirm("נמצאו " + willFix + " חיובי הפרשי הצמדה קיימים לשנת " + year + ".\nלתקן אותם לפי החישוב הנוכחי? (יסומנו כמתוקנים; לשוכרים ללא חיוב ייווצר חדש)")) return;
    }
    setCreatingCharges(true);
    var chargeStart = Date.now();
    setProgress({ current: 0, total: withDiff.length, label: willFix ? "מתקן חיובי הפרשי הצמדה..." : "יוצר חיובי הפרשי הצמדה...", startedAt: chargeStart });
    try {
      var updated = 0, created = 0, idx = 0;
      var graceDays = await getGraceDaysForProperty(propId);
      var dueDateStr = dueDateFromGrace(graceDays);
      var today = new Date().toLocaleDateString("he-IL");
      var vatPct = await getVatPct();
      var vatMap = await getVatTypeMap(withDiff.map(function(r:any){ return r.contractId; }));
      for (var r of results) {
        if (Math.abs(r.totalDifference) < 1) continue;
        idx++;
        setProgress({ current: idx, total: withDiff.length, label: (willFix ? "מתקן — " : "יוצר חיוב — ") + r.tenantName, startedAt: chargeStart });
        var baseSigned = r.totalDifference > 0 ? r.totalDifference : -Math.abs(r.totalDifference);
        var v = applyVat(baseSigned, vatMap[r.contractId] === "taxable", vatPct);
        var baseNotes = "הפרשי הצמדה שכ\"ד שנת " + year + (r.totalDifference > 0 ? " — לחיוב" : " — לזיכוי");
        var ex = byContract[r.contractId];
        if (ex) {
          await supabase.from("charges").update({
            base_amount: v.base, vat_amount: v.vat, total_amount: v.total, vat_type: v.vatType,
            notes: baseNotes + " [מתוקן " + today + "]",
          }).eq("id", ex.id);
          await logAudit({ entity_type: "charge", entity_id: ex.id, action: "fix_cpi_diff_charge", notes: "סכום מעודכן " + v.total });
          updated++;
        } else {
          await supabase.from("charges").insert({
            contract_id: r.contractId, charge_type: "cpi_diff",
            base_amount: v.base, vat_amount: v.vat, total_amount: v.total,
            vat_type: v.vatType, billing_period_start: year + "-01-01",
            billing_period_end: year + "-12-31", due_date: dueDateStr,
            status: "pending", notes: baseNotes,
          });
          created++;
        }
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: willFix ? "fix_cpi_diff_charges" : "create_cpi_diff_charges", notes: "עודכנו " + updated + ", נוצרו " + created });
      await loadExistingCpiCharges();
      alert(willFix ? ("✅ תוקנו " + updated + " חיובים" + (created ? ", נוצרו " + created + " חדשים" : "")) : ("✅ נוצרו " + created + " חיובי הפרשי הצמדה"));
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setCreatingCharges(false); setProgress(null); }
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

      // Pre-fetch contract→units so titles can list units (e.g. "קומה 1, קומה 2 ועוד 2").
      // This is the disambiguator when one tenant has multiple contracts on the same property
      // (e.g. Yehonatan has both an offices contract and a logistics contract).
      var contractIds = results.map(function(r: any) { return r.contractId; });
      var spacesByContract: Record<string, string[]> = {};
      if (contractIds.length > 0) {
        var { data: csData } = await supabase
          .from("contract_spaces")
          .select("contract_id, spaces(space_name)")
          .in("contract_id", contractIds);
        (csData || []).forEach(function(cs: any) {
          var nm = (cs.spaces as any)?.space_name;
          if (!nm) return;
          if (!spacesByContract[cs.contract_id]) spacesByContract[cs.contract_id] = [];
          if (spacesByContract[cs.contract_id].indexOf(nm) === -1) spacesByContract[cs.contract_id].push(nm);
        });
      }
      var summarizeUnits = function(names: string[]): string {
        if (!names || names.length === 0) return "";
        if (names.length <= 3) return names.join(", ");
        return names.slice(0, 2).join(", ") + " ועוד " + (names.length - 2);
      };

      var count = 0;
      var letterStart = Date.now();
      setProgress({ current: 0, total: results.length, label: "יוצר מכתבי דרישה...", startedAt: letterStart });
      var letterIdx = 0;
      for (var r of results) {
        letterIdx++;
        setProgress({ current: letterIdx, total: results.length, label: "יוצר מכתב — " + r.tenantName, startedAt: letterStart });
        var liveTotal = r.periods.reduce(function(s: number, p: any) { return s + liveDifference(p, r.contractId).total; }, 0);
        var advChecks = savedAdvancesByContract[r.contractId] || [];
        if (Math.abs(liveTotal) < 1 && advChecks.length === 0) continue;

        var hebMonths = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

        // === BODY ===
        var body = "לכבוד\n" + r.tenantName + "\n\nשלום רב,\n\n";

        var titleParts = [];
        if (advChecks.length > 0) titleParts.push("המחאות מקדמות " + nextYear);
        if (Math.abs(liveTotal) >= 1) titleParts.push("הפרשי הצמדה " + year);
        // Enrich the unit list from advance_payments rows too (covers units that exist
        // for this contract but might not yet be in contract_spaces).
        var unitNamesForLetter = (spacesByContract[r.contractId] || []).slice();
        advChecks.forEach(function(a: any) {
          if (a.space_name && unitNamesForLetter.indexOf(a.space_name) === -1) unitNamesForLetter.push(a.space_name);
        });
        var unitsLabel = summarizeUnits(unitNamesForLetter);
        var letterTitle = titleParts.join(" + ") + (unitsLabel ? " — " + unitsLabel : "");

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

        // === APPENDIX — structured sections (parsed by letters/page.tsx renderer) ===
        // Format:
        //   SECTION|key|title              — start a new appendix section
        //   KV|label|value                  — key/value row (info block above table)
        //   TABLE_HEADER|col1|col2|...      — table header row
        //   TABLE_ROW|c1|c2|...             — body row
        //   TABLE_FOOTER|c1|c2|...          — total row (bold + colored)
        //
        // We emit up to two sections per letter:
        //   נספח א' — תחשיב המחאות מקדמות (only when advances are included)
        //   נספח ב' — פירוט הפרשי הצמדה (only when there's a CPI diff)
        // Numbering shifts to "א'" alone when only one section is present.
        var appendix = "";
        var appendixIdx = 0;
        var hebLetters = ["", "א'", "ב'", "ג'"];

        var hebMonthYear = function(ds: string): string {
          // Accepts "YYYY-MM", "YYYY-MM-DD", or "MM-DD-YYYY". Returns "מאי 2025".
          if (!ds) return "—";
          var parts = ds.split("-");
          var y = 0, m = 0;
          if (parts.length >= 2 && parts[0].length === 4) {
            // YYYY-MM[-DD]
            y = Number(parts[0]); m = Number(parts[1]);
          } else if (parts.length === 3 && parts[2].length === 4) {
            // MM-DD-YYYY
            m = Number(parts[0]); y = Number(parts[2]);
          } else {
            return ds;
          }
          if (!y || !m) return ds;
          return hebMonths[m] + " " + y;
        };

        // === SECTION א' — Advances (only when combined letter) ===
        if (advChecks.length > 0) {
          appendixIdx++;
          appendix += "SECTION|advances|נספח " + hebLetters[appendixIdx] + " — תחשיב המחאות מקדמות " + nextYear + "\n";

          // Group by check_date to determine payment frequency
          var datesSet: Record<string, boolean> = {};
          advChecks.forEach(function(a: any) { datesSet[a.check_date] = true; });
          var sortedAdvDates = Object.keys(datesSet).sort();
          var freqLabel = sortedAdvDates.length === 4 ? "רבעוני"
                        : sortedAdvDates.length === 12 ? "חודשי"
                        : sortedAdvDates.length === 1 ? "שנתי"
                        : sortedAdvDates.length + " תשלומים";

          var firstDate = sortedAdvDates[0];
          var firstPeriodChecks = advChecks.filter(function(a: any) { return a.check_date === firstDate; });

          // Pull VAT % from the first check (vat_amount / total_before_vat)
          var firstCheck = firstPeriodChecks[0] || advChecks[0];
          var vatPct = firstCheck && firstCheck.total_before_vat > 0
            ? Math.round((Number(firstCheck.vat_amount) / Number(firstCheck.total_before_vat)) * 100)
            : 18;

          appendix += "KV|תנאי תשלום|" + freqLabel + "\n";
          appendix += "KV|מספר המחאות|" + sortedAdvDates.length + " לשנת " + nextYear + "\n";
          appendix += "KV|מע\"מ|" + vatPct + "%\n";

          // Per-space table — includes יחס הצמדה (CPI ratio) so the tenant can verify
          // the calculation without doing the division themselves.
          appendix += "TABLE_HEADER|יחידה|שטח (מ\"ר)|שכ\"ד למ\"ר|שכ\"ד צמוד/חודש|מקדמת ניהול|חניה|מדד בסיס|מדד עדכון|יחס הצמדה|סכום לתקופה (כולל מע\"מ)\n";

          var perPeriodTotal = 0;
          firstPeriodChecks.forEach(function(a: any) {
            var rentPerSqm = a.space_area > 0 && a.base_rent
              ? (Number(a.base_rent) / Number(a.space_area)).toFixed(2)
              : "—";
            var baseLabel = a.cbs_from_date
              ? hebMonthYear(a.cbs_from_date) + " (" + (a.cpi_base_value || "—") + ")"
              : (a.cpi_base_value || "—");
            var currLabel = a.cpi_current_date
              ? hebMonthYear(a.cpi_current_date) + " (" + (a.cpi_at_payment || "—") + ")"
              : (a.cpi_at_payment || "—");
            // Prefer the stored ratio (already CBS-corrected for base-year chaining)
            // and fall back to a simple division if it's missing.
            var ratioNum = Number(a.cpi_ratio);
            if (!ratioNum && Number(a.cpi_base_value) > 0) {
              ratioNum = Number(a.cpi_at_payment) / Number(a.cpi_base_value);
            }
            var ratioStr = ratioNum ? ratioNum.toFixed(4) : "—";
            var parking = Number(a.parking_monthly) > 0 ? fmtMoney(Number(a.parking_monthly)) : "—";
            appendix += "TABLE_ROW|"
              + (a.space_name || "—") + "|"
              + (a.space_area || "—") + "|"
              + rentPerSqm + "|"
              + fmtMoney(Number(a.indexed_rent)) + "|"
              + fmtMoney(Number(a.management_advance)) + "|"
              + parking + "|"
              + baseLabel + "|"
              + currLabel + "|"
              + ratioStr + "|"
              + fmtMoney(Number(a.total_with_vat))
              + "\n";
            perPeriodTotal += Number(a.total_with_vat) || 0;
          });

          appendix += "TABLE_FOOTER|סה\"כ המחאה ל" + freqLabel.replace(/^(\S+).*$/, "$1") + "|||||||||" + fmtMoney(perPeriodTotal) + "\n";
        }

        // === SECTION ב' (or א') — CPI diff (period table) ===
        if (Math.abs(liveTotal) >= 1) {
          appendixIdx++;
          appendix += "SECTION|cpi_diff|נספח " + hebLetters[appendixIdx] + " — פירוט הפרשי הצמדה " + year + "\n";
          appendix += "TABLE_HEADER|תקופה|תאריך תשלום|שכ\"ד צמוד|מקדמת ד.נ.|סה\"כ נדרש|ששולם בפועל|הפרש|מדד בסיס|מדד תשלום|יחס|ריבית|סה\"כ\n";

          var totalDiffSum = 0;
          r.periods.forEach(function(p: any) {
            var live = liveDifference(p, r.contractId);
            var actualPaidVal = actualPaidInputs[r.contractId]?.[p.label]
              ? Number(actualPaidInputs[r.contractId][p.label])
              : p.actualPaid;
            var rate = interestRates[r.contractId]?.[p.label] || 0;
            var interestStr = live.interest !== 0
              ? rate + "% (" + fmtMoney(live.interest) + ")"
              : "—";
            // יחס הצמדה לתקופה — כך הלקוח רואה ישירות שהמדד עלה X% מבסיס לתקופת התשלום
            var pRatio = (Number(p.cpiBaseValue) > 0)
              ? (Number(p.cpiValue) / Number(p.cpiBaseValue))
              : 0;
            var pRatioStr = pRatio ? pRatio.toFixed(4) : "—";
            appendix += "TABLE_ROW|"
              + p.label + "|"
              + fmtDate(p.paymentDate) + "|"
              + fmtMoney(p.indexedRent) + "|"
              + fmtMoney(p.mgmtAdvance) + "|"
              + fmtMoney(p.shouldPay) + "|"
              + fmtMoney(actualPaidVal) + "|"
              + fmtMoney(live.diff) + "|"
              + (p.cpiBaseValue || "—") + "|"
              + (p.cpiValue || "—") + "|"
              + pRatioStr + "|"
              + interestStr + "|"
              + fmtMoney(live.total)
              + "\n";
            totalDiffSum += live.total;
          });

          appendix += "TABLE_FOOTER|סה\"כ הפרשי הצמדה |||||||||||" + fmtMoney(totalDiffSum) + "\n";
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
    finally { setCreatingLetters(false); setProgress(null); }
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
                    {(function(){
                      var taxable = vatTypeMap[r.contractId] === "taxable";
                      var vatAmt = taxable ? r.totalDifference * vatPct : 0;
                      var clr = r.totalDifference > 0 ? "text-red-700" : r.totalDifference < 0 ? "text-green-700" : "text-slate-500";
                      return (
                        <div className="text-left">
                          <div className={"text-xs " + clr}>הפרש לפני מע&quot;מ: {fmtMoney(r.totalDifference)}{taxable ? " · מע\"מ " + fmtMoney(vatAmt) : " · פטור ממע\"מ"}</div>
                          <div className={"text-sm font-bold " + clr}>כולל מע&quot;מ: {fmtMoney(r.totalDifference + vatAmt)}</div>
                        </div>
                      );
                    })()}
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
                          var hasAmendment = !!p.amendmentNote;
                          return (
                            <tr key={pi} className={"border-t border-slate-100 hover:bg-slate-50 " + (hasAmendment ? "bg-amber-50/40" : "")}>
                              <td className="px-3 py-2 font-semibold text-slate-800">
                                <div className="flex items-center gap-1.5">
                                  {hasAmendment && (
                                    <span title={p.amendmentNote} className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-bold border border-amber-200 cursor-help">
                                      🔄 שינוי
                                    </span>
                                  )}
                                  <span>{p.label}</span>
                                </div>
                                {hasAmendment && (
                                  <div className="text-[10px] text-amber-700 mt-0.5 font-normal" dir="rtl">
                                    {p.amendmentNote}
                                  </div>
                                )}
                              </td>
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

            {/* Progress shown right above the action buttons — visible
                during save / charge / letter generation without the user
                needing to scroll back up to the compute area. */}
            {progress && (
              <CalcProgress {...progress} />
            )}

            <div className="flex gap-3 flex-wrap">
              <button onClick={saveDiffCalculation} disabled={saving}
                className={"rounded-lg px-5 py-2.5 text-sm font-bold disabled:opacity-50 " + (savedMode ? "border-2 border-green-500 bg-green-50 text-green-700 hover:bg-green-100" : "bg-blue-700 text-white hover:bg-blue-800")}>
                {saving ? "שומר..." : savedMode ? "✅ נשמר — לחץ לשמור מחדש" : "💾 שמור חישוב"}
              </button>
              <button onClick={createCharges} disabled={creatingCharges}
                title={existingCpiCharges.length > 0 ? "מעדכן את חיובי ההפרשים הקיימים לפי החישוב הנוכחי (מסמן כמתוקנים)" : "יוצר חיובי הפרשי הצמדה"}
                style={existingCpiCharges.length > 0 ? { backgroundColor: "#d97706", borderColor: "#d97706" } : undefined}
                className="rounded-lg bg-slate-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50">
                {creatingCharges ? "שומר..." : existingCpiCharges.length > 0 ? ("🔧 תקן חיובי הפרשים (" + existingCpiCharges.length + ")") : "📊 צור חיובי הפרשים"}
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
