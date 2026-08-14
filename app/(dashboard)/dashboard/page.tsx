"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { getScopeIds, getCompanyScopeIds, getTenantScopeIds, scopeRows, scopeGroups } from '@/lib/permissions';
import { fetchCpiAdjusted, fetchHighestChainedCpi } from '@/lib/cpi-server';
import { getKnownIndexMonth } from '@/lib/cpi-utils';
import { graceFactorsFor, describeGrace, graceWindow } from '@/lib/store-opening';
import CalcProgress, { CalcProgressState } from '@/components/CalcProgress';
import { useAccess } from '@/components/AccessProvider';
import { guaranteeInPlace } from '@/lib/guarantee-status';

function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}); }
// Headline KPI numbers: drop the agorot once the figure is big, so long sums
// (e.g. ₪1,320,563.46) fit the card instead of being clipped to "...,563.46".
// The exact value stays available via the element's title.
function fmtMoneyKpi(n: number) {
  var v = n ?? 0;
  return Math.abs(v) >= 1000
    ? "₪" + Math.round(v).toLocaleString("he-IL")
    : "₪" + v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

// A contract in its fit-out grace produces no rent this month — counting the
// full contractual figure overstates portfolio income by exactly the rent of
// every shop still being fitted out. The factor comes from the same engine the
// cheques use, so the KPI agrees with what is actually billed.
function graceFactorThisMonth(c: any): number {
  const now = new Date();
  const f = graceFactorsFor({
    contract: c,
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  });
  return f.rentFactor;
}

function inGraceNow(c: any): boolean {
  return graceFactorThisMonth(c) < 1;
}

// Calculate base monthly rent for a contract (handles per-unit pricing)
function calcContractRent(c: any): number {
  var total = 0;
  if (c.contract_spaces?.length > 0) {
    c.contract_spaces.forEach(function(cs: any) {
      if (cs.charge_method === "fixed" && cs.fixed_rent) total += Number(cs.fixed_rent);
      else total += (Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0) * (cs.spaces?.area || 0);
    });
  }
  if (total === 0) total = (Number(c.rent_per_sqm) || 0) * (Number(c.charged_area) || 0);
  // A turnover lease earns its MINIMUM on paper.
  if (total === 0 && (c.rent_type === "revenue_pct" || Number(c.revenue_pct) > 0)) {
    var mArea = (c.contract_spaces || []).reduce(function (a: number, x: any) { return a + (Number(x?.spaces?.area) || 0); }, 0) || Number(c.charged_area) || 0;
    total = Number(c.min_rent_per_sqm) > 0 ? Number(c.min_rent_per_sqm) * mArea : (Number(c.minimum_rent) || 0);
  }
  return total + (Number(c.investment_addition) || 0);
}

function contractStarted(c: any): boolean {
  return c.status !== "upcoming" && c.status !== "future";
}

// What the contract actually produces this month, after the fit-out grace.
function calcContractRentNow(c: any): number {
  return calcContractRent(c) * graceFactorThisMonth(c);
}

export default function DashboardPage() {
  const router  = useRouter();
  const { access } = useAccess();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<any[]>([]);
  const [propGroups, setPropGroups] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [guarantees, setGuarantees] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [unsentLetters, setUnsentLetters] = useState<any[]>([]);
  const [allCharges, setAllCharges] = useState<any[]>([]);
  const [advances, setAdvances] = useState<any[]>([]);
  const [cpiRatios, setCpiRatios] = useState<Record<string, number>>({});
  const [cpiProgress, setCpiProgress] = useState<CalcProgressState | null>(null);
  // Master-only banner: the nightly sync stamps a heartbeat; if it hasn't
  // beaten in 26h, the automations are down and the owner should know today.
  const [staleSync, setStaleSync] = useState<string | null>(null);

  // Filters
  const [filterGroup, setFilterGroup] = useState("all");
  const [filterProp,  setFilterProp]  = useState("all");

  const today = new Date().toLocaleDateString("he-IL", {
    weekday:"long", year:"numeric", month:"long", day:"numeric"
  });

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: pg }, { data: p }, { data: c }, { data: sp }, { data: gu }, { data: al }, { data: ch }, { data: ap }] = await Promise.all([
      supabase.from("property_groups").select("id,group_name").order("group_name"),
      supabase.from("properties").select("id,name,group_id,city,total_area,property_type"),
      supabase.from("contracts").select("id,status,rent_per_sqm,charged_area,investment_addition,property_id,end_date,start_date,index_base_date,indexation_method,index_mechanism,is_amendment,grace_months,grace_days,grace_phase2_days,grace_type,grace_discount_pct,grace_mgmt_discount_pct,grace_ends_on_opening,rent_type,revenue_pct,min_rent_per_sqm,minimum_rent,planned_handover_date,actual_handover_date,planned_opening_date,actual_opening_date,tenants(name),properties(name),contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))").in("status",["active","extended","expiring","upcoming","future"]),
      supabase.from("spaces").select("id,property_id,status,space_name,area"),
      supabase.from("guarantees").select("id,contract_id,amount_required,amount_actual,end_date,guarantee_type,status,delivered_at,document_url,documents").eq("status","active"),
      supabase.from("alerts").select("id,title,severity,due_date,entity_type,contract_id,property_id").eq("is_resolved",false).order("due_date", { ascending: true }).limit(60),
      // All charges — drives the open-charges KPI, the 12-month trend and the
      // YTD collection rate. Small table, so one fetch covers all three.
      supabase.from("charges").select("id,contract_id,total_amount,due_date,status"),
      // Rent advances/cheques — the bulk of actual monthly income, so the trend
      // reflects real cash flow rather than only the recently-created charges.
      supabase.from("advance_payments").select("id,contract_id,property_id,check_date,total_with_vat,status"),
    ]);

    // Data-level scoping: KPIs/sums must only include allowed properties.
    var scope = await getScopeIds();
    var scC = scopeRows(c ?? [], scope, function(x: any){ return x.property_id; });
    var cidOk: Record<string, boolean> = {};
    scC.forEach(function(x: any){ cidOk[x.id] = true; });
    var byCid = function(r: any){ return scope === null || !!cidOk[r.contract_id]; };
    // Rows that may be linked to a PROPERTY instead of a contract (e.g. building
    // insurance / safety alerts). Checking contract_id alone hid them from
    // scoped users even though the property is theirs.
    var byCidOrProp = function(r: any){
      if (scope === null) return true;
      if (r.property_id) return scope.indexOf(r.property_id) !== -1;
      return !!cidOk[r.contract_id];
    };
    var scP = scopeRows(p ?? [], scope, function(x: any){ return x.id; });
    setPropGroups(scopeGroups(pg ?? [], scope, scP));
    setProperties(scP);
    setContracts(scC.filter(function(c:any){return !c.is_amendment;}));
    setSpaces(scopeRows(sp ?? [], scope, function(x: any){ return x.property_id; }));
    setGuarantees((gu ?? []).filter(byCid));
    setAlerts((al ?? []).filter(byCidOrProp));
    setAllCharges((ch ?? []).filter(byCid));
    setAdvances((ap ?? []).filter(byCidOrProp));

    // Automation heartbeat (master sees a red banner when the nightly sync
    // stopped running; others just get null — the row is world-readable but
    // the banner is gated below by is_master).
    try {
      const { data: hb } = await supabase.from("system_heartbeats").select("last_run").eq("job", "sync_contracts").maybeSingle();
      if (hb && (Date.now() - new Date(hb.last_run).getTime()) > 26 * 3600 * 1000) {
        setStaleSync(new Date(hb.last_run).toLocaleString("he-IL"));
      } else {
        setStaleSync(null);
      }
    } catch (e) { /* banner is best-effort */ }

    // Letters waiting to be sent (draft + ready) — surfaced as a banner.
    const { data: ul } = await supabase.from("letters")
      .select("id,title,status,billing_type,property_id,contracts(property_id,tenants(name))")
      .in("status", ["draft", "ready"]).order("created_at", { ascending: false });
    setUnsentLetters(scopeRows(ul ?? [], scope, function(l: any){ return l.property_id || l.contracts?.property_id; }));

    // Render NOW — every KPI/table above already has its data. The CPI ratios
    // below need slow external CBS calls; they fill in progressively while the
    // dashboard is already usable (and the progress bar is visible, since it
    // renders inside the non-loading branch).
    setLoading(false);

    // Compute per-contract CPI ratios.
    // Group contracts by (base date + mechanism) to dedupe CBS calls — but
    // each contract still receives its own ratio based on its own base date
    // and indexation method. For highest_in_period / no_drop contracts, scan
    // the chained peak via CBS calculator. Standard contracts use a single
    // base→today call.
    try {
      var validContracts = (c ?? []).filter(function(x: any) {
        // A not-started lease contributes to no indexed sum — fetching its CPI
        // ratios is pure CBS latency.
        if (x.status === "upcoming" || x.status === "future") return false;
        return !x.is_amendment && x.index_base_date
          && x.indexation_method && x.indexation_method !== "none";
      });

      var toCbsDate = function(d: string): string {
        var dt = new Date(d); if (dt.getDate() === 15) dt.setDate(16);
        var mm = String(dt.getMonth()+1).padStart(2,"0");
        var dd = String(dt.getDate()).padStart(2,"0");
        return mm + "-" + dd + "-" + dt.getFullYear();
      };
      var now = new Date();
      var todayCbs = String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0")+"-"+now.getFullYear();
      var nowKnown = getKnownIndexMonth(now);

      var groupMap: Record<string, { contractIds: string[]; fromDate: string; rawBase: string; isHighest: boolean }> = {};
      validContracts.forEach(function(x: any) {
        var fromDate = toCbsDate(x.index_base_date);
        var isHighest = x.indexation_method === "highest_in_period" || x.indexation_method === "no_drop"
          || x.index_mechanism === "highest_in_period" || x.index_mechanism === "no_drop";
        var key = fromDate + "|" + (isHighest ? "H" : "S");
        if (!groupMap[key]) groupMap[key] = { contractIds: [], fromDate: fromDate, rawBase: x.index_base_date, isHighest: isHighest };
        groupMap[key].contractIds.push(x.id);
      });

      var calcStart = Date.now();
      var groupKeys = Object.keys(groupMap);
      var totalGroups = groupKeys.length;
      setCpiProgress({ current: 0, total: totalGroups, label: "מחשב יחס מדד לכל החוזים...", startedAt: calcStart });

      // Groups run CONCURRENTLY (bounded pool) instead of one-by-one: each group
      // is a base-date × mechanism pair, and a peak scan alone can be ~30 CBS
      // calls — sequentially that dominated dashboard load time. Results are
      // cached per known-index month, so revisits within the month are instant.
      var groupResults: any[] = [];
      var doneCount = 0;
      var nextIdx = 0;
      var cacheStamp = ":" + nowKnown.year + "-" + nowKnown.month;
      var readCache = function(k: string): number | null {
        try { var v = sessionStorage.getItem("cpiratio:" + k + cacheStamp); return v ? Number(v) : null; } catch (e) { return null; }
      };
      var writeCache = function(k: string, ratio: number) {
        try { sessionStorage.setItem("cpiratio:" + k + cacheStamp, String(ratio)); } catch (e) { /* quota/private mode */ }
      };
      var bump = function(label: string) {
        doneCount++;
        setCpiProgress({ current: doneCount, total: totalGroups, label: label, startedAt: calcStart });
      };

      var cpiWorker = async function(): Promise<void> {
        while (true) {
          var myIdx = nextIdx++;
          if (myIdx >= groupKeys.length) return;
          var k = groupKeys[myIdx];
          var g = groupMap[k];
          var cached = readCache(k);
          if (cached !== null && !isNaN(cached)) { groupResults.push({ key: k, ratio: cached }); bump("מדד (מטמון)..."); continue; }
          try {
            var ratio = 1;
            var got = false;
            if (g.isHighest) {
              var baseDateObj = new Date(g.rawBase);
              var peak = await fetchHighestChainedCpi({
                baseFromDate: g.fromDate,
                scanFromYear: baseDateObj.getFullYear(),
                scanFromMonth: baseDateObj.getMonth() + 1,
                scanToYear: nowKnown.year,
                scanToMonth: nowKnown.month,
              });
              if (peak.success && peak.peakRatio) { ratio = peak.peakRatio; got = true; }
            }
            if (!got) {
              var data: any = await fetchCpiAdjusted({ value: 10000, fromDate: g.fromDate, toDate: todayCbs });
              ratio = (data && data.success) ? (Number(data.adjustedRentPerSqm) || 10000) / 10000 : 1;
            }
            groupResults.push({ key: k, ratio: ratio });
            writeCache(k, ratio);
          } catch (e) { groupResults.push({ key: k, ratio: 1 }); }
          bump(g.isHighest ? "סורק שיא מדד..." : "מביא יחס מדד...");
        }
      };

      var poolSize = Math.min(4, groupKeys.length || 1);
      var workers: Promise<void>[] = [];
      for (var w = 0; w < poolSize; w++) workers.push(cpiWorker());
      await Promise.all(workers);

      var ratioMap: Record<string, number> = {};
      groupResults.forEach(function(r: any) {
        var g = groupMap[r.key];
        if (!g) return;
        g.contractIds.forEach(function(cid: string) { ratioMap[cid] = r.ratio; });
      });
      setCpiRatios(ratioMap);
    } catch(e) { /* keep ratios empty */ }
    setCpiProgress(null);
    setLoading(false);
  }

  // ─── Apply filters (group → property) ───
  var filteredProps = properties;
  if (filterGroup !== "all") filteredProps = filteredProps.filter(function(p){return p.group_id===filterGroup;});
  if (filterProp !== "all") filteredProps = filteredProps.filter(function(p){return p.id===filterProp;});
  const filteredPropIds = filteredProps.map(function(p){return p.id;});

  const filteredContracts = contracts.filter(function(c){return filteredPropIds.includes(c.property_id);});
  const filteredSpaces = spaces.filter(function(s){return filteredPropIds.includes(s.property_id);});
  const startedContracts = filteredContracts.filter(contractStarted);
  const futureContracts = filteredContracts.filter(function(c){ return !contractStarted(c); });
  const filteredGuarantees = guarantees.filter(function(g){
    return startedContracts.some(function(c){return c.id===g.contract_id;});
  });

  // ─── Calculations ───
  // Base revenue: sum of contract base rents (no CPI applied).
  // Indexed revenue: sum of (base × ratio) per contract — each contract gets
  // its own ratio based on its own base date and indexation method.
  const baseRevenue = startedContracts.reduce(function(s,c){return s+calcContractRentNow(c);},0);
  // Which contracts produce no (or reduced) rent right now, and how much rent
  // that withholds — so a lower KPI is explained rather than merely lower.
  const graced = startedContracts.filter(inGraceNow);
  const gracedWithheld = graced.reduce(function(s,c){
    return s + (calcContractRent(c) - calcContractRentNow(c));
  },0);
  const indexedRevenue = startedContracts.reduce(function(s,c){
    var r = cpiRatios[c.id] || 1;
    return s + calcContractRentNow(c) * r;
  },0);

  const totalArea = filteredSpaces.reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
  // Held = the cached flag OR any contract covering the unit — including a
  // signed lease whose term hasn't begun, which commits the unit already.
  const heldIds = new Set<string>();
  filteredContracts.forEach(function(c: any){ (c.contract_spaces || []).forEach(function(cs: any){ if (cs?.space_id) heldIds.add(cs.space_id); }); });
  const isHeld = function(s: any){ return s.status === "occupied" || heldIds.has(s.id); };
  const occupiedArea = filteredSpaces.filter(isHeld).reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
  const occupancyPct = totalArea > 0 ? Math.round(occupiedArea/totalArea*100) : 0;

  const vacantSpaces = filteredSpaces.filter(function(s){return !isHeld(s);});
  const vacantArea = vacantSpaces.reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
  const occupiedSpaces = filteredSpaces.filter(isHeld);

  // Expiring contracts in next 12 months (by date, not status)
  const oneYearMs = 365*24*60*60*1000;
  const expiringSoon = startedContracts.filter(function(c){
    if (!c.end_date) return false;
    var diff = new Date(c.end_date).getTime() - Date.now();
    return diff > 0 && diff <= oneYearMs;
  }).sort(function(a,b){return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();});

  // Expiring in next 90 days (for warning counter)
  const expiring90 = expiringSoon.filter(function(c){
    var days = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / 86400000);
    return days <= 90;
  });

  // Charges — respects the same group/property filter.
  const contractIdSet: Record<string, boolean> = {};
  filteredContracts.forEach(function(c: any){ contractIdSet[c.id] = true; });
  const filteredCharges = allCharges.filter(function(ch: any){ return contractIdSet[ch.contract_id]; });
  const filteredOpenCharges = filteredCharges.filter(function(ch: any){ return ch.status === "pending"; });
  const filteredAdvances = advances.filter(function(a: any){
    return a.property_id ? filteredPropIds.includes(a.property_id) : !!contractIdSet[a.contract_id];
  });
  const openChargesTotal = filteredOpenCharges.reduce(function(s: number, ch: any){ return s + (Number(ch.total_amount) || 0); }, 0);
  const todayIso = new Date().toISOString().split("T")[0];
  const overdueCharges = filteredOpenCharges.filter(function(ch: any){ return ch.due_date && ch.due_date < todayIso; });

  // YTD collection rate — of everything billed this year (due date already
  // passed), how much was actually collected.
  const yearStartIso = new Date().getFullYear() + "-01-01";
  const ytdDue = filteredCharges.filter(function(ch: any){ return ch.due_date && ch.due_date >= yearStartIso && ch.due_date <= todayIso; });
  const ytdBilled = ytdDue.reduce(function(s: number, ch: any){ return s + (Number(ch.total_amount) || 0); }, 0);
  const ytdPaid = ytdDue.filter(function(ch: any){ return ch.status === "paid"; })
                        .reduce(function(s: number, ch: any){ return s + (Number(ch.total_amount) || 0); }, 0);
  const collectionPct = ytdBilled > 0 ? Math.round((ytdPaid / ytdBilled) * 100) : null;

  // 12-month charge trend (paid vs still open), oldest → newest.
  const HEB_M = ["ינו","פבר","מרץ","אפר","מאי","יונ","יול","אוג","ספט","אוק","נוב","דצמ"];
  const trendMonths: Array<{ label: string; key: string; paid: number; open: number; total: number }> = [];
  (function(){
    var now = new Date();
    for (var i = 11; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      trendMonths.push({ label: HEB_M[d.getMonth()], key: key, paid: 0, open: 0, total: 0 });
    }
    var byKey: Record<string, any> = {};
    trendMonths.forEach(function(m){ byKey[m.key] = m; });
    filteredCharges.forEach(function(ch: any){
      if (!ch.due_date) return;
      var m = byKey[String(ch.due_date).slice(0, 7)];
      if (!m) return;
      var amt = Number(ch.total_amount) || 0;
      if (ch.status === "paid") m.paid += amt; else m.open += amt;
      m.total += amt;
    });
    // Rent advances/cheques by their cheque date — this is where most of the
    // monthly income actually sits, so the trend reflects real cash flow.
    filteredAdvances.forEach(function(a: any){
      if (!a.check_date) return;
      var m = byKey[String(a.check_date).slice(0, 7)];
      if (!m) return;
      var amt = Number(a.total_with_vat) || 0;
      if (a.status === "received" || a.status === "paid") m.paid += amt; else m.open += amt;
      m.total += amt;
    });
  })();
  const trendMax = trendMonths.reduce(function(mx, m){ return Math.max(mx, m.total); }, 0);

  // Per-property breakdown: income, occupancy and open debt side by side.
  const propertyRows = filteredProps.map(function(p: any){
    var pContracts = filteredContracts.filter(function(c: any){ return c.property_id === p.id; });
    var income = pContracts.filter(contractStarted).reduce(function(s: number, c: any){ return s + calcContractRentNow(c) * (cpiRatios[c.id] || 1); }, 0);
    var pSpaces = spaces.filter(function(s: any){ return s.property_id === p.id; });
    var pArea = pSpaces.reduce(function(s: number, x: any){ return s + (Number(x.area) || 0); }, 0);
    var occArea = 0;
    var held: Record<string, boolean> = {};
    pContracts.forEach(function(c: any){ (c.contract_spaces || []).forEach(function(cs: any){ if (cs.space_id) held[cs.space_id] = true; }); });
    pSpaces.forEach(function(x: any){ if (held[x.id]) occArea += Number(x.area) || 0; });
    var pOpen = filteredOpenCharges.filter(function(ch: any){
      var c = filteredContracts.find(function(x: any){ return x.id === ch.contract_id; });
      return c && c.property_id === p.id;
    }).reduce(function(s: number, ch: any){ return s + (Number(ch.total_amount) || 0); }, 0);
    return {
      id: p.id, name: p.name, income: income, open: pOpen,
      contracts: pContracts.filter(contractStarted).length,
      occPct: pArea > 0 ? Math.round((occArea / pArea) * 100) : 0,
    };
  }).sort(function(a, b){ return b.income - a.income; });

  // Action centre — upcoming obligations grouped by kind, nearest first.
  const ACTION_KINDS: Record<string, { label: string; icon: string; href: string }> = {
    insurance:        { label: "ביטוחים",        icon: "🛡️", href: "/insurances" },
    guarantee:        { label: "ערבויות",        icon: "🏦", href: "/guarantees" },
    safety:           { label: "בדיקות בטיחות",  icon: "🔒", href: "/safety" },
    arrears:          { label: "גבייה / חובות",  icon: "💳", href: "/payments" },
    contract_option:  { label: "מועדי אופציה",   icon: "🔁", href: "/contracts" },
    option:           { label: "מועדי אופציה",   icon: "🔁", href: "/contracts" },
    contract:         { label: "חוזים",          icon: "📄", href: "/contracts" },
  };
  // Alerts limited to the selected group/property (by their own property_id or
  // via their contract), so the action centre matches the filter above.
  const filteredAlerts = alerts.filter(function(a: any){
    if (a.property_id) return filteredPropIds.includes(a.property_id);
    if (a.contract_id) return !!contractIdSet[a.contract_id];
    return true;
  });
  const actionGroups = (function(){
    var acc: Record<string, { label: string; icon: string; href: string; count: number; nearest: string | null; soon: number }> = {};
    var in30 = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
    filteredAlerts.forEach(function(a: any){
      var meta = ACTION_KINDS[a.entity_type] || { label: "אחר", icon: "🔔", href: "/alerts" };
      var k = meta.label;
      if (!acc[k]) acc[k] = { label: meta.label, icon: meta.icon, href: meta.href, count: 0, nearest: null, soon: 0 };
      acc[k].count++;
      if (a.due_date && (!acc[k].nearest || a.due_date < acc[k].nearest!)) acc[k].nearest = a.due_date;
      if (a.due_date && a.due_date <= in30) acc[k].soon++;
    });
    return Object.keys(acc).map(function(k){ return acc[k]; })
      .sort(function(x, y){ return (y.soon - x.soon) || String(x.nearest).localeCompare(String(y.nearest)); });
  })();

  // Guarantee analysis
  const totalGuarantees = filteredGuarantees.reduce(function(s,g){return s+(Number(g.amount_required)||0);},0);
  // Shared gap logic (lib/guarantee-status) — a promissory note with its scan
  // attached is IN PLACE even with no amount_actual; the old inline comparison
  // counted every such note as a gap, contradicting the guarantees screen.
  const guaranteeGaps = filteredGuarantees.filter(function(g){ return !guaranteeInPlace(g); });
  const expiringGuarantees = filteredGuarantees.filter(function(g){
    if (!g.end_date) return false;
    var diff = new Date(g.end_date).getTime() - Date.now();
    return diff > 0 && diff <= oneYearMs;
  });

  // Alerts
  const urgentAlerts = alerts.filter(function(a){return a.severity==="urgent" || a.severity==="high";});

  // Available properties for dropdown based on group filter
  const propOptions = filterGroup === "all" ? properties : properties.filter(function(p){return p.group_id===filterGroup;});

  const QUICK = [
    {label:"חוזה חדש",  href:"/contracts/new", icon:"📄", bg:"bg-blue-600"    },
    {label:"חיוב חדש",  href:"/payments",       icon:"💳", bg:"bg-purple-600"  },
    {label:"ערבות",     href:"/guarantees",     icon:"🏦", bg:"bg-emerald-600" },
    {label:"התראות",    href:"/alerts",         icon:"🔔", bg:urgentAlerts.length>0?"bg-red-500":"bg-orange-500"},
    {label:"דוחות",     href:"/reports",        icon:"📋", bg:"bg-slate-600"   },
    {label:"הגדרות",    href:"/settings",       icon:"⚙️", bg:"bg-slate-500"   },
  ];

  const LINKS = [
    {label:"Timeline",  href:"/timeline",  icon:"📊"},
    {label:"תזרים",    href:"/cashflow",  icon:"💹"},
    {label:"מדד CBS",  href:"/indexation",icon:"📈"},
    {label:"לוח שנה",  href:"/calendar",  icon:"📅"},
  ];

  return (
    <div dir="rtl">
      {staleSync && !!access?.profile?.is_master && (
        <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-center justify-between flex-wrap gap-2">
          <span><b>🔴 האוטומציות לא רצות:</b> הסנכרון הלילי רץ לאחרונה ב-{staleSync}. מימוש אופציות, התראות וחיובי העברה עלולים לא להתעדכן — בדוק את ה-Cron ב-Vercel.</span>
          <a href="/errors" className="rounded-lg bg-rose-600 text-white px-3 py-1 text-xs font-bold hover:bg-rose-700 shrink-0">למסך הניטור →</a>
        </div>
      )}
      <div className="rounded-3xl bg-gradient-to-bl from-blue-700 via-blue-600 to-indigo-600 text-white p-6 mb-5 shadow-lg">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight">דשבורד</h1>
            <p className="text-blue-100 text-sm mt-1">{today}</p>
          </div>
          <div className="text-left">
            <div className="text-blue-100 text-xs font-medium">הכנסה חודשית צמודה</div>
            <div className="text-4xl font-black leading-tight">{fmtMoney(indexedRevenue)}</div>
            <div className="text-blue-200 text-xs mt-0.5">תפוסה {occupancyPct}% · {startedContracts.length} חוזים פעילים{futureContracts.length > 0 ? " · " + futureContracts.length + " עתידיים 🔜" : ""}</div>
          </div>
        </div>
        <div className="flex gap-2 items-center mt-4 flex-wrap">
          <span className="text-xs text-blue-100">סינון:</span>
          <select value={filterGroup} onChange={function(e){setFilterGroup(e.target.value); setFilterProp("all");}}
            className="rounded-lg bg-white/15 text-white border border-white/25 px-3 py-1.5 text-sm backdrop-blur [&>option]:text-slate-800">
            <option value="all">📁 כל הקבוצות</option>
            {propGroups.map(function(g){return <option key={g.id} value={g.id}>{g.group_name}</option>;})}
          </select>
          <select value={filterProp} onChange={function(e){setFilterProp(e.target.value);}}
            className="rounded-lg bg-white/15 text-white border border-white/25 px-3 py-1.5 text-sm backdrop-blur [&>option]:text-slate-800">
            <option value="all">🏢 כל הנכסים</option>
            {propOptions.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
          </select>
          {(filterGroup !== "all" || filterProp !== "all") && (
            <button onClick={function(){setFilterGroup("all"); setFilterProp("all");}}
              className="rounded-lg bg-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/30">✕ נקה</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[1,2,3,4].map(function(i){return <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse"/>;})}
        </div>
      ) : (
        <>
          {unsentLetters.length > 0 && (() => {
            var guarCount = unsentLetters.filter(function(l:any){ return l.billing_type === "guarantee"; }).length;
            return (
              <button onClick={function(){router.push("/letters");}}
                className="w-full mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3.5 text-right hover:bg-amber-100 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">✉️</span>
                  <div>
                    <div className="font-bold text-amber-800">{unsentLetters.length} מכתבים ממתינים לשליחה</div>
                    <div className="text-xs text-amber-700">
                      {guarCount > 0 ? "כולל " + guarCount + " מכתבי חידוש ערבות · " : ""}לחץ למסך המכתבים לבדיקה ושליחה
                    </div>
                  </div>
                </div>
                <span className="text-amber-600 font-bold text-sm whitespace-nowrap">למכתבים →</span>
              </button>
            );
          })()}
          {cpiProgress && (
            <div className="mb-3">
              <CalcProgress {...cpiProgress} />
            </div>
          )}
          {/* Row 1 — main KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <button onClick={function(){router.push("/cashflow");}}
              className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 text-right hover:shadow-lg hover:-translate-y-0.5 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center text-2xl shrink-0">💰</div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-500">הכנסה חודשית צמודה</div>
                  <div title={fmtMoney(indexedRevenue)} className="text-xl xl:text-2xl font-black text-emerald-700 leading-tight whitespace-nowrap tabular-nums">{fmtMoneyKpi(indexedRevenue)}</div>
                </div>
              </div>
              <div className="text-xs text-slate-400 mt-2">בסיס: {fmtMoney(baseRevenue)}</div>
              {graced.length > 0 && (
                <div className="text-[11px] text-amber-700 mt-1 leading-snug" title={graced.map(function(c:any){
                    var g = graceWindow({ contract: c });
                    return (c.tenants?.name || "—") + " — " + describeGrace(g);
                  }).join("\n")}>
                  🔨 {graced.length} {graced.length === 1 ? "חוזה" : "חוזים"} בתקופת גרייס · לא נכללו {fmtMoney(gracedWithheld)} לחודש
                </div>
              )}
            </button>

            <button onClick={function(){router.push("/units");}}
              className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 text-right hover:shadow-lg hover:-translate-y-0.5 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center text-2xl shrink-0">📐</div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-500">תפוסה (לפי מ&quot;ר)</div>
                  <div className="text-2xl font-black text-blue-700 leading-tight">{occupancyPct}%</div>
                </div>
              </div>
              <div className="text-xs text-slate-400 mt-2">{occupiedArea.toLocaleString("he-IL")}/{totalArea.toLocaleString("he-IL")} מ&quot;ר</div>
            </button>

            <button onClick={function(){router.push("/contracts");}}
              className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 text-right hover:shadow-lg hover:-translate-y-0.5 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-2xl shrink-0">📄</div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-500">חוזים פעילים</div>
                  <div className="text-2xl font-black text-slate-800 leading-tight">{startedContracts.length}</div>
                </div>
              </div>
              <div className="text-xs text-slate-400 mt-2">{expiring90.length} פוגים תוך 90 יום</div>
            </button>

            <button onClick={function(){router.push("/alerts");}}
              className={"rounded-2xl border p-4 text-right hover:shadow-lg hover:-translate-y-0.5 transition-all " + (urgentAlerts.length>0?"bg-gradient-to-br from-red-50 to-white border-red-200":"bg-gradient-to-br from-slate-50 to-white border-slate-200")}>
              <div className="flex items-center gap-3">
                <div className={"w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0 " + (urgentAlerts.length>0?"bg-red-100":"bg-slate-100")}>🔔</div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-500">התראות פתוחות</div>
                  <div className={"text-2xl font-black leading-tight " + (urgentAlerts.length>0?"text-red-700":"text-slate-400")}>{alerts.length}</div>
                </div>
              </div>
              <div className="text-xs text-slate-400 mt-2">{urgentAlerts.length} דחופות</div>
            </button>
          </div>

          {/* Row 2 — secondary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <button onClick={function(){router.push("/payments");}}
              className={"rounded-xl border p-3 text-right hover:shadow-sm " + (overdueCharges.length>0?"bg-red-50 border-red-100":"bg-white border-slate-200")}>
              <div title={fmtMoney(openChargesTotal)} className={"text-lg xl:text-xl font-black whitespace-nowrap tabular-nums " + (overdueCharges.length>0?"text-red-700":"text-slate-700")}>{fmtMoneyKpi(openChargesTotal)}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                חיובים פתוחים ({filteredOpenCharges.length})
                {overdueCharges.length > 0 && <span className="text-red-600 font-semibold"> · {overdueCharges.length} באיחור</span>}
              </div>
            </button>
            <button onClick={function(){router.push("/properties");}}
              className="rounded-xl border border-slate-200 p-3 text-right hover:shadow-sm bg-white">
              <div className="text-xl font-black text-purple-700">{filteredProps.length}</div>
              <div className="text-xs text-slate-500 mt-0.5">נכסים</div>
            </button>
            <button onClick={function(){router.push("/units");}}
              className="rounded-xl border border-slate-200 p-3 text-right hover:shadow-sm bg-white">
              <div className="text-xl font-black text-slate-700">{occupiedSpaces.length}/{filteredSpaces.length}</div>
              <div className="text-xs text-slate-500 mt-0.5">יחידות{vacantSpaces.length > 0 ? " ("+vacantSpaces.length+" פנויות)" : ""}</div>
            </button>
            <button onClick={function(){router.push("/guarantees");}}
              className={"rounded-xl border p-3 text-right hover:shadow-sm " + (guaranteeGaps.length>0?"bg-orange-50 border-orange-100":"bg-white border-slate-200")}>
              <div title={fmtMoney(totalGuarantees)} className={"text-lg xl:text-xl font-black whitespace-nowrap tabular-nums " + (guaranteeGaps.length>0?"text-orange-700":"text-slate-700")}>{fmtMoneyKpi(totalGuarantees)}</div>
              <div className="text-xs text-slate-500 mt-0.5">ערבויות{guaranteeGaps.length > 0 ? " ("+guaranteeGaps.length+" פערים)" : ""}</div>
            </button>
            <button onClick={function(){router.push("/contracts");}}
              className="rounded-xl border border-slate-200 p-3 text-right hover:shadow-sm bg-white">
              <div title={fmtMoney(indexedRevenue * 12)} className="text-lg xl:text-xl font-black text-green-700 whitespace-nowrap tabular-nums">{fmtMoneyKpi(indexedRevenue * 12)}</div>
              <div className="text-xs text-slate-500 mt-0.5">הכנסה שנתית צמודה</div>
            </button>
            <button onClick={function(){router.push("/payments");}}
              title={collectionPct === null ? "" : "נגבו " + fmtMoney(ytdPaid) + " מתוך " + fmtMoney(ytdBilled) + " שחויבו השנה"}
              className="rounded-xl border border-slate-200 p-3 text-right hover:shadow-sm bg-white">
              <div className={"text-lg xl:text-xl font-black tabular-nums " + (collectionPct === null ? "text-slate-400" : collectionPct >= 90 ? "text-green-700" : collectionPct >= 70 ? "text-amber-600" : "text-red-600")}>
                {collectionPct === null ? "—" : collectionPct + "%"}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">אחוז גבייה (השנה)</div>
            </button>
          </div>

          {/* 12-month charge trend — paid vs still open, per month. */}
          {trendMax > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 mb-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <span className="font-bold text-slate-700 text-sm">📊 תזרים 12 החודשים האחרונים</span>
                <span className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />שולם</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />פתוח</span>
                  <span className="text-slate-300">(חיובים + מקדמות שכ"ד)</span>
                </span>
              </div>
              <div className="flex items-end justify-between gap-1 h-32">
                {trendMonths.map(function(m, i){
                  var hPaid = trendMax > 0 ? (m.paid / trendMax) * 100 : 0;
                  var hOpen = trendMax > 0 ? (m.open / trendMax) * 100 : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1 group">
                      <div className="w-full flex flex-col justify-end h-full rounded-t overflow-hidden" title={m.label + ": שולם " + fmtMoney(m.paid) + " · פתוח " + fmtMoney(m.open)}>
                        {hOpen > 0 && <div className="w-full bg-amber-400 group-hover:bg-amber-500 transition-colors" style={{ height: hOpen + "%" }} />}
                        {hPaid > 0 && <div className="w-full bg-emerald-500 group-hover:bg-emerald-600 transition-colors" style={{ height: hPaid + "%" }} />}
                      </div>
                      <span className="text-[9px] text-slate-400">{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action centre + per-property breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-slate-700 text-sm">⏰ דורש טיפול</span>
                <button onClick={function(){router.push("/alerts");}} className="text-xs text-blue-600 font-semibold">הכל →</button>
              </div>
              {actionGroups.length === 0 ? (
                <div className="text-xs text-slate-400 py-6 text-center">אין משימות פתוחות 🎉</div>
              ) : (
                <div className="space-y-1.5">
                  {actionGroups.map(function(g, i){
                    return (
                      <button key={i} onClick={function(){router.push(g.href);}}
                        className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-slate-50 px-3 py-2 text-right transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg shrink-0">{g.icon}</span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-700 truncate">{g.label}</div>
                            {g.nearest && <div className="text-[11px] text-slate-400">הקרוב: {fmtDate(g.nearest)}</div>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {g.soon > 0 && <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">{g.soon} תוך 30 יום</span>}
                          <span className="text-sm font-black text-slate-700">{g.count}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-slate-700 text-sm">🏢 פילוח לפי נכס</span>
                <button onClick={function(){router.push("/properties");}} className="text-xs text-blue-600 font-semibold">הכל →</button>
              </div>
              {propertyRows.length === 0 ? (
                <div className="text-xs text-slate-400 py-6 text-center">אין נכסים להצגה</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs min-w-[420px]">
                    <thead className="text-slate-400">
                      <tr className="border-b border-slate-100">
                        <th className="py-1.5 font-semibold">נכס</th>
                        <th className="py-1.5 font-semibold">חוזים</th>
                        <th className="py-1.5 font-semibold">תפוסה</th>
                        <th className="py-1.5 font-semibold">הכנסה/חודש</th>
                        <th className="py-1.5 font-semibold">חוב פתוח</th>
                      </tr>
                    </thead>
                    <tbody>
                      {propertyRows.map(function(r){
                        return (
                          <tr key={r.id} onClick={function(){router.push("/properties");}}
                            className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer">
                            <td className="py-2 font-semibold text-slate-700 truncate max-w-[10rem]">{r.name}</td>
                            <td className="py-2 text-slate-500">{r.contracts}</td>
                            <td className="py-2">
                              <span className={"font-bold " + (r.occPct >= 90 ? "text-green-700" : r.occPct >= 70 ? "text-amber-600" : "text-red-600")}>{r.occPct}%</span>
                            </td>
                            <td className="py-2 font-semibold text-emerald-700 tabular-nums whitespace-nowrap" title={fmtMoney(r.income)}>{fmtMoneyKpi(r.income)}</td>
                            <td className={"py-2 tabular-nums whitespace-nowrap font-semibold " + (r.open > 0 ? "text-red-600" : "text-slate-300")} title={fmtMoney(r.open)}>{r.open > 0 ? fmtMoneyKpi(r.open) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Row 3 — panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {/* Quick actions */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="font-bold text-slate-700 text-sm mb-3">⚡ פעולות מהירות</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                {QUICK.map(function(q) {
                  return (
                    <button key={q.href} onClick={function(){router.push(q.href);}}
                      className={"rounded-xl py-2.5 text-white text-xs font-semibold flex flex-col items-center gap-1 transition-opacity hover:opacity-90 " + q.bg}>
                      <span className="text-lg">{q.icon}</span><span>{q.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-slate-100 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {LINKS.map(function(l) {
                  return (
                    <button key={l.href} onClick={function(){router.push(l.href);}}
                      className="rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 flex flex-col items-center gap-0.5">
                      <span>{l.icon}</span><span className="text-center leading-tight">{l.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Expiring contracts */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-700 text-sm">⏰ חוזים מסתיימים ({expiringSoon.length})</span>
                <button onClick={function(){router.push("/contracts");}} className="text-xs text-blue-600 hover:underline">הכל →</button>
              </div>
              {expiringSoon.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">אין חוזים מסתיימים השנה ✓</div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                  {expiringSoon.slice(0, 8).map(function(c: any) {
                    const mon  = calcContractRent(c);
                    const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : null;
                    const monthsLeft = days !== null ? Math.floor(days / 30) : null;
                    return (
                      <div key={c.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer" onClick={function(){router.push("/contracts");}}>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-800 text-sm truncate">{c.tenants?.name}</div>
                          <div className="text-xs text-slate-400 truncate">{c.properties?.name}</div>
                        </div>
                        <div className="text-left shrink-0 mr-2">
                          <div className={"text-sm font-black " + (days!==null&&days<=30?"text-red-600":days!==null&&days<=90?"text-orange-600":"text-slate-500")}>
                            {monthsLeft !== null && monthsLeft > 0 ? monthsLeft+" חו'" : days+" י'"}
                          </div>
                          <div className="text-xs text-green-600">{fmtMoney(mon)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Alerts */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-700 text-sm">🔔 התראות ({alerts.length})</span>
                <button onClick={function(){router.push("/alerts");}} className="text-xs text-blue-600 hover:underline">הכל →</button>
              </div>
              {alerts.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">אין התראות פתוחות 🎉</div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                  {alerts.slice(0, 8).map(function(a: any) {
                    return (
                      <div key={a.id} className={"px-4 py-3 flex items-start gap-2 cursor-pointer hover:bg-slate-50 " + (a.severity==="urgent"?"bg-red-50/50":a.severity==="high"?"bg-orange-50/50":"")} onClick={function(){router.push("/alerts");}}>
                        <div className={"w-2 h-2 rounded-full mt-1.5 shrink-0 " + (a.severity==="urgent"?"bg-red-500":a.severity==="high"?"bg-orange-500":"bg-yellow-400")} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-800 truncate">{a.title}</div>
                          {a.due_date && <div className="text-xs text-slate-400">{fmtDate(a.due_date)}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Row 4 — Vacant units list (detailed) */}
          {vacantSpaces.length > 0 && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/30 shadow-sm overflow-hidden mb-4">
              <div className="px-5 py-3 border-b border-blue-200 flex items-center justify-between">
                <span className="font-bold text-blue-800 text-sm">🏠 יחידות פנויות ({vacantSpaces.length})</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-blue-600 font-semibold">{vacantArea.toLocaleString("he-IL")} מ&quot;ר זמין להשכרה</span>
                  <button onClick={function(){router.push("/units");}} className="text-xs text-blue-600 hover:underline">נהל →</button>
                </div>
              </div>
              <div className="divide-y divide-blue-100 max-h-96 overflow-y-auto">
                {vacantSpaces.map(function(sp: any) {
                  const prop = properties.find(function(p: any){return p.id===sp.property_id;});
                  return (
                    <div key={sp.id} className="px-5 py-2.5 flex items-center justify-between hover:bg-blue-50 cursor-pointer"
                      onClick={function(){router.push("/units?propertyId="+sp.property_id);}}>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-blue-500">📍</span>
                        <span className="font-semibold text-slate-700 text-sm">{sp.space_name}</span>
                        {prop && <span className="text-xs text-slate-500 truncate">— {prop.name}{prop.city ? " / " + prop.city : ""}</span>}
                      </div>
                      <span className="text-sm font-bold text-blue-700 shrink-0 mr-2">{sp.area || "—"} מ&quot;ר</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
