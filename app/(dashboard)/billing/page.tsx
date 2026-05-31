"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit-log";
import PropertyHierarchyFilter from '@/components/PropertyHierarchyFilter';
import BillingGroupsManager from '@/components/BillingGroupsManager';
import { fetchCpiAdjusted } from '@/lib/cpi-server';
import { getGraceDaysForProperty, dueDateFromGrace } from '@/lib/grace-days';
import AdvancesTab from '@/components/AdvancesTab';
import CpiDiffTab from '@/components/CpiDiffTab';
import SavedAdvancesTab from '@/components/SavedAdvancesTab';
import CalcProgress, { CalcProgressState } from '@/components/CalcProgress';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

type Tab = "management" | "insurance" | "waste" | "advances" | "saved_advances" | "cpi_diff";

interface MgmtResult { contractId: string; tenantName: string; spaceNames: string; chargedArea: number; advance: number; actualShare: number; difference: number; isRevenueBased: boolean; }
interface InsResult {
  contractId: string;
  tenantName: string;
  spaceNames: string;
  area: number;                // representative area (last segment)
  areaRange?: string;          // e.g. "365 → 110" when changed during the policy
  sqmDays: number;             // sqm × days inside the policy period
  daysInPolicy: number;        // total days the tenant covered any part of the property
  policyDays: number;          // total policy length in days (constant per row, for the ratio display)
  contractStart: string;
  contractEnd: string;
  pct: number;
  charge: number;
  isPartialPeriod: boolean;
}
interface WasteResult { contractId: string; tenantName: string; spaces: string; wasteArea: number; pct: number; charge: number; }
interface UseTypeRow { useType: string; totalSqm: number; rate: number; annual: number; }

export default function BillingPage() {
  const [activeTab, setActiveTab] = useState<Tab>("management");

  // shared
  const [properties, setProperties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPropIds, setFilterPropIds] = useState<string[]>([]);

  useEffect(function () { loadProperties(); }, []);

  async function loadProperties() {
    const { data } = await supabase
      .from("properties")
      .select("id, name, property_type, total_area, management_type")
      .order("name");
    setProperties(data ?? []);
    setLoading(false);
  }

  const filteredProperties = filterPropIds.length === 0 ? properties : properties.filter(function (p) { return filterPropIds.includes(p.id); });
  const internalProps = filteredProperties.filter(function (p) { return p.management_type === "internal"; });

  const TABS: { v: Tab; l: string }[] = [
    { v: "management", l: "דמי ניהול" },
    { v: "insurance", l: "ביטוח מבנה" },
    { v: "waste", l: "פינוי אשפה" },
    { v: "advances", l: "מקדמות שכ\"ד" },
    { v: "saved_advances", l: "📋 שייקים שמורים" },
    { v: "cpi_diff", l: "הפרשי הצמדה" },
  ];

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">{"חיובים תפעוליים"}</h1>
        <p className="text-sm text-slate-500 mt-1">{"דמי ניהול, ביטוח מבנה ופינוי אשפה"}</p>
      </div>

      <div className="mb-4">
        <PropertyHierarchyFilter onChange={function(f) { setFilterPropIds(f.propertyIds); }} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {TABS.map(function (t) {
          return (
            <button key={t.v} onClick={function () { setActiveTab(t.v); }}
              className={"px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all " +
                (activeTab === t.v ? "border-blue-600 text-blue-700 bg-blue-50/50" : "border-transparent text-slate-500 hover:text-slate-700")}>
              {t.l}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">{"טוען..."}</div>
      ) : (
        <>
          {activeTab === "management" && <ManagementTab properties={internalProps} allProperties={properties} />}
          {activeTab === "insurance" && <InsuranceTab properties={filteredProperties} />}
          {activeTab === "waste" && <WasteTab properties={filteredProperties} />}
          {activeTab === "advances" && <AdvancesTab properties={filteredProperties} />}
          {activeTab === "saved_advances" && <SavedAdvancesTab properties={filteredProperties} />}
          {activeTab === "cpi_diff" && <CpiDiffTab properties={filteredProperties} />}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 1 — Management Fees
   ═══════════════════════════════════════════════════════════ */
function ManagementTab({ properties, allProperties }: { properties: any[]; allProperties: any[] }) {
  const currentYear = new Date().getFullYear();
  const [propId, setPropId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [inputMode, setInputMode] = useState<"fixed" | "persqm">("fixed");
  const [fixedTotal, setFixedTotal] = useState("");
  const [perSqmRate, setPerSqmRate] = useState("");
  const [mixedRows, setMixedRows] = useState<UseTypeRow[]>([]);
  const [isMixed, setIsMixed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // reconciliation
  const [actualCost, setActualCost] = useState("");
  const [groupActualCosts, setGroupActualCosts] = useState<Record<string, string>>({}); // groupId → actual cost
  const [defaultActualCost, setDefaultActualCost] = useState(""); // actual cost for units not in any group
  const [mgmtGroupsData, setMgmtGroupsData] = useState<any[]>([]);
  const [mgmtResults, setMgmtResults] = useState<MgmtResult[]>([]);
  const [computing, setComputing] = useState(false);
  const [creatingCharges, setCreatingCharges] = useState(false);
  const [creatingLetters, setCreatingLetters] = useState(false);
  const [progress, setProgress] = useState<CalcProgressState | null>(null);
  // Management charges already created for this property + year.
  const [existingMgmtCharges, setExistingMgmtCharges] = useState<any[]>([]);
  const [existingMgmtLetters, setExistingMgmtLetters] = useState<any[]>([]);

  const selProp = allProperties.find(function (p) { return p.id === propId; });
  const totalArea = selProp?.total_area ?? 0;

  // load spaces when property changes to detect mixed use
  useEffect(function () {
    if (!propId) { setIsMixed(false); setMixedRows([]); setMgmtGroupsData([]); setExistingMgmtCharges([]); return; }
    loadSpaces();
    loadMgmtGroups();
    loadActualInputs();
    loadExistingMgmtCharges();
  }, [propId, year]);

  // Persist the entered actual-cost inputs per property+year, so reopening the
  // reconciliation restores them (same idea as the insurance dispositions).
  async function loadActualInputs() {
    if (!propId) return;
    const { data } = await supabase.from("mgmt_reconciliation_inputs")
      .select("actual_cost, default_actual_cost, group_actual_costs")
      .eq("property_id", propId).eq("year", year).limit(1);
    var row = data && data[0];
    setActualCost(row && row.actual_cost != null ? String(row.actual_cost) : "");
    setDefaultActualCost(row && row.default_actual_cost != null ? String(row.default_actual_cost) : "");
    var g = (row && row.group_actual_costs && typeof row.group_actual_costs === "object") ? row.group_actual_costs : {};
    var gm: Record<string, string> = {};
    Object.keys(g).forEach(function(k){ gm[k] = g[k] != null ? String(g[k]) : ""; });
    setGroupActualCosts(gm);
  }
  async function saveActualInputs() {
    if (!propId) return;
    try {
      await supabase.from("mgmt_reconciliation_inputs").upsert({
        property_id: propId, year: year,
        actual_cost: actualCost ? Number(actualCost) : null,
        default_actual_cost: defaultActualCost ? Number(defaultActualCost) : null,
        group_actual_costs: groupActualCosts,
        updated_at: new Date().toISOString(),
      }, { onConflict: "property_id,year" });
    } catch (e) { /* non-fatal */ }
  }
  async function loadExistingMgmtCharges() {
    if (!propId) { setExistingMgmtCharges([]); setExistingMgmtLetters([]); return; }
    const [{ data: ch }, { data: lt }] = await Promise.all([
      supabase.from("charges")
        .select("id, total_amount, status, contract_id, notes, contracts(property_id, tenants(name))")
        .eq("charge_type", "management")
        .eq("billing_period_start", year + "-01-01"),
      supabase.from("letters")
        .select("id, title, subject, contract_id, contracts(property_id)")
        .eq("letter_type", "demand")
        .or("subject.ilike.%דמי ניהול " + year + "%,title.ilike.%דמי ניהול " + year + "%"),
    ]);
    setExistingMgmtCharges((ch ?? []).filter(function(x:any){ return x.contracts?.property_id === propId; }));
    setExistingMgmtLetters((lt ?? []).filter(function(x:any){ return x.contracts?.property_id === propId; }));
  }

  async function loadMgmtGroups() {
    const { data } = await supabase.from("billing_groups")
      .select("*,billing_group_spaces(space_id)")
      .eq("property_id", propId)
      .eq("group_type", "management")
      .eq("year", year);
    setMgmtGroupsData(data ?? []);
  }

  // Load space areas for summary calculations (used when groups exist)
  const [spacesAreaMap, setSpacesAreaMap] = useState<Record<string, number>>({});
  useEffect(function() {
    if (!propId) { setSpacesAreaMap({}); return; }
    supabase.from("spaces").select("id,area").eq("property_id", propId).then(function({data}) {
      var m: Record<string, number> = {};
      (data ?? []).forEach(function(sp: any){ m[sp.id] = Number(sp.area) || 0; });
      setSpacesAreaMap(m);
    });
  }, [propId]);

  async function loadSpaces() {
    const { data: spaces } = await supabase
      .from("spaces")
      .select("id, space_name, space_type, area")
      .eq("property_id", propId);
    const prop = allProperties.find(function (p) { return p.id === propId; });
    if (prop?.property_type === "מעורב") {
      setIsMixed(true);
      const byType: Record<string, number> = {};
      for (const s of spaces ?? []) {
        const t = s.space_type || "אחר";
        byType[t] = (byType[t] || 0) + (s.area || 0);
      }
      setMixedRows(Object.entries(byType).map(function ([useType, totalSqm]) {
        return { useType, totalSqm, rate: 0, annual: 0 };
      }));
    } else {
      setIsMixed(false);
      setMixedRows([]);
    }
  }

  const computedRate = fixedTotal && totalArea > 0
    ? Number(fixedTotal) / totalArea / 12
    : 0;
  const computedTotal = perSqmRate && totalArea > 0
    ? Number(perSqmRate) * totalArea * 12
    : 0;

  function updateMixedRate(idx: number, rate: number) {
    setMixedRows(function (prev) {
      return prev.map(function (r, i) {
        if (i !== idx) return r;
        return { ...r, rate, annual: rate * r.totalSqm * 12 };
      });
    });
  }

  async function saveBudget() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    setSaving(true);
    try {
      let annualAmount = 0;
      let ratePerSqm = 0;
      if (isMixed) {
        annualAmount = mixedRows.reduce(function (s, r) { return s + r.annual; }, 0);
        ratePerSqm = totalArea > 0 ? annualAmount / totalArea / 12 : 0;
      } else if (inputMode === "fixed") {
        annualAmount = Number(fixedTotal) || 0;
        ratePerSqm = totalArea > 0 ? annualAmount / totalArea / 12 : 0;
      } else {
        ratePerSqm = Number(perSqmRate) || 0;
        annualAmount = ratePerSqm * totalArea * 12;
      }
      await supabase.from("property_budgets").upsert({
        property_id: propId,
        year: year,
        management_budget: annualAmount,
      }, { onConflict: "property_id,year" });
      await logAudit({ entity_type: "property_budget", entity_id: propId, action: "upsert", notes: year + " - " + fmtMoney(annualAmount) });
      setMsg("✅ תקציב נשמר בהצלחה");
      setTimeout(function () { setMsg(""); }, 3000);
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function computeReconciliation() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    const hasGroups = mgmtGroupsData.length > 0;
    if (!hasGroups && !actualCost) { alert("יש להזין עלות בפועל"); return; }
    setComputing(true);
    setProgress({ current: 0, total: 0, label: "מחשב התחשבנות דמי ניהול...", startedAt: Date.now() });
    try {
      // Load active BASE contracts only. Amendments share a tenant name with
      // the base, so including them would duplicate tenants in the table
      // (e.g. Joubaril Aesthetics appearing three times). The base contract's
      // contract_spaces still describes the current set of units used.
      // Also pulls revenue_pct / rent_type so revenue-% tenants can be flagged
      // (their mgmt is paid as part of the % rent — no separate charge).
      const { data: contracts } = await supabase
        .from("contracts")
        .select("id, charged_area, rent_per_sqm, rent_type, revenue_pct, mgmt_included_in_revenue, is_amendment, tenants(name), contract_spaces(space_id, spaces(id, space_name, area))")
        .eq("property_id", propId)
        .eq("is_amendment", false)
        .in("status", ["active", "expiring", "extended"]);

      // Load property budget (default rate fallback)
      const { data: budget } = await supabase
        .from("property_budgets")
        .select("management_budget")
        .eq("property_id", propId)
        .eq("year", year)
        .single();

      const annualBudget = Number(budget?.management_budget) || 0;

      // Load all spaces for this property to get areas
      const { data: propSpaces } = await supabase.from("spaces").select("id,area").eq("property_id", propId);
      const spaceAreaMap = new Map<string, number>();
      (propSpaces ?? []).forEach((sp: any) => spaceAreaMap.set(sp.id, Number(sp.area) || 0));

      // Build map: space_id → { rate, groupId, groupTotalArea, groupActualCost }
      const spaceGroupMap = new Map<string, { rate: number; groupId: string; groupTotalArea: number; groupActualCost: number; }>();
      for (const g of mgmtGroupsData) {
        const sids = (g.billing_group_spaces || []).map((x: any) => x.space_id);
        const groupTotalArea = sids.reduce((s: number, sid: string) => s + (spaceAreaMap.get(sid) || 0), 0);
        const rate = Number(g.rate_per_sqm_monthly) || (Number(g.annual_amount) && groupTotalArea > 0 ? Number(g.annual_amount) / groupTotalArea / 12 : 0);
        const groupActualCost = Number(groupActualCosts[g.id]) || 0;
        for (const sid of sids) {
          spaceGroupMap.set(sid, { rate, groupId: g.id, groupTotalArea, groupActualCost });
        }
      }

      // Default (unassigned) space total area
      const groupedSpaceIds = new Set(spaceGroupMap.keys());
      const defaultSpaceArea = (propSpaces ?? []).filter((sp: any) => !groupedSpaceIds.has(sp.id))
        .reduce((s: number, sp: any) => s + (Number(sp.area) || 0), 0);
      const defaultActual = Number(defaultActualCost) || (hasGroups ? 0 : Number(actualCost));
      const defaultAnnualBudget = hasGroups ? annualBudget : annualBudget; // still same source
      const defaultRate = defaultSpaceArea > 0 ? defaultAnnualBudget / defaultSpaceArea / 12 : (totalArea > 0 ? annualBudget / totalArea / 12 : 0);

      const results: MgmtResult[] = (contracts ?? []).map(function (c: any) {
        let advance = 0;
        let actualShare = 0;
        let contractArea = 0;
        const spaceNamesList: string[] = [];

        for (const cs of (c.contract_spaces ?? [])) {
          const spArea = Number(cs.spaces?.area) || 0;
          contractArea += spArea;
          if (cs.spaces?.space_name) spaceNamesList.push(cs.spaces.space_name);
          const info = spaceGroupMap.get(cs.space_id);
          if (info) {
            advance += info.rate * spArea * 12;
            actualShare += info.groupTotalArea > 0 ? info.groupActualCost * (spArea / info.groupTotalArea) : 0;
          } else {
            advance += defaultRate * spArea * 12;
            actualShare += defaultSpaceArea > 0 ? defaultActual * (spArea / defaultSpaceArea) : 0;
          }
        }

        if (contractArea === 0) contractArea = c.charged_area ?? 0;

        // Revenue-pct tenants pay management as part of their % rent — they
        // see the reconciliation diff but shouldn't be billed/lettered for it
        // through the mgmt-reconciliation flow. The rent itself gets updated
        // on the revenue page.
        const isRevenueBased = c.rent_type === "revenue_pct" || c.rent_type === "revenue_based" || Number(c.revenue_pct) > 0;

        return {
          contractId: c.id,
          tenantName: c.tenants?.name ?? "—",
          spaceNames: spaceNamesList.join(", ") || "—",
          chargedArea: contractArea,
          advance,
          actualShare,
          difference: actualShare - advance,
          isRevenueBased,
        };
      });
      setMgmtResults(results);
      await saveActualInputs();
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setComputing(false); setProgress(null); }
  }

  // Create OR fix management-reconciliation charges (update existing for the
  // same contract+year, insert for new tenants).
  async function createCharges() {
    if (mgmtResults.length === 0) return;
    var billable = mgmtResults.filter(function(r){ return Math.abs(r.difference) >= 0.01 && !r.isRevenueBased; });
    var byContract: Record<string, any> = {};
    existingMgmtCharges.forEach(function(c:any){ byContract[c.contract_id] = c; });
    var willFix = billable.filter(function(r){ return byContract[r.contractId]; }).length;
    if (willFix > 0) {
      if (!confirm("נמצאו " + willFix + " חיובי דמי ניהול קיימים לשנת " + year + ".\nלתקן אותם לפי החישוב הנוכחי? (הסכומים יעודכנו ויסומנו כמתוקנים; לשוכרים ללא חיוב ייווצר חדש)")) return;
    }
    setCreatingCharges(true);
    setProgress({ current: 0, total: mgmtResults.length, label: willFix ? "מתקן חיובי דמי ניהול..." : "יוצר חיובי דמי ניהול...", startedAt: Date.now() });
    try {
      let updated = 0, created = 0;
      let skippedRevenue = 0;
      var graceDays = await getGraceDaysForProperty(propId);
      var dueDateStr = dueDateFromGrace(graceDays);
      var today = new Date().toLocaleDateString("he-IL");
      var mIdx = 0;
      for (const r of mgmtResults) {
        mIdx++;
        setProgress({ current: mIdx, total: mgmtResults.length, label: (willFix ? "מתקן: " : "מעבד: ") + r.tenantName, startedAt: Date.now() });
        if (Math.abs(r.difference) < 0.01) continue;
        // Revenue-% tenants: skip — their mgmt is part of the % rent on the
        // revenue page, not a separate charge.
        if (r.isRevenueBased) { skippedRevenue++; continue; }
        const base = Math.abs(r.difference);
        const signed = r.difference > 0 ? base : -base;
        const baseNotes = "התחשבנות דמי ניהול " + year + (r.difference > 0 ? " — לחיוב" : " — לזיכוי");
        const ex = byContract[r.contractId];
        if (ex) {
          await supabase.from("charges").update({
            base_amount: signed, vat_amount: 0, total_amount: signed,
            notes: baseNotes + " [מתוקן " + today + "]",
          }).eq("id", ex.id);
          await logAudit({ entity_type: "charge", entity_id: ex.id, action: "fix_mgmt_charge", notes: "סכום מעודכן " + signed });
          updated++;
        } else {
          await supabase.from("charges").insert({
            contract_id: r.contractId, charge_type: "management",
            base_amount: signed, vat_amount: 0, total_amount: signed,
            vat_type: "exempt", billing_period_start: year + "-01-01",
            billing_period_end: year + "-12-31", due_date: dueDateStr,
            status: "pending", notes: baseNotes,
          });
          created++;
        }
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: willFix ? "fix_mgmt_charges" : "create_mgmt_charges", notes: "עודכנו " + updated + ", נוצרו " + created + (skippedRevenue ? " (דולג " + skippedRevenue + " % פידיון)" : "") });
      var msg = willFix ? ("✅ תוקנו " + updated + " חיובים" + (created ? ", נוצרו " + created + " חדשים" : "")) : ("✅ נוצרו " + created + " חיובים");
      if (skippedRevenue > 0) msg += "\nדולגו " + skippedRevenue + " שוכרי % פידיון (דמי הניהול כלולים בשכ\"ד המחזור)";
      await saveActualInputs();
      await loadExistingMgmtCharges();
      alert(msg);
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setCreatingCharges(false); setProgress(null); }
  }

  // Create OR fix management letters (update existing → "מכתב מתוקן", insert new).
  async function createLetters() {
    if (mgmtResults.length === 0) return;
    var billableL = mgmtResults.filter(function(r){ return Math.abs(r.difference) >= 0.01 && !r.isRevenueBased; });
    var byContractL: Record<string, any> = {};
    existingMgmtLetters.forEach(function(l:any){ byContractL[l.contract_id] = l; });
    var willFix = billableL.filter(function(r){ return byContractL[r.contractId]; }).length;
    if (willFix > 0) {
      if (!confirm("נמצאו " + willFix + " מכתבי דמי ניהול קיימים לשנת " + year + ".\nלתקן אותם? התוכן יעודכן והם יסומנו כ\"מכתב מתוקן\".")) return;
    }
    setCreatingLetters(true);
    setProgress({ current: 0, total: mgmtResults.length, label: willFix ? "מתקן מכתבי דמי ניהול..." : "יוצר מכתבי דמי ניהול...", startedAt: Date.now() });
    try {
      let updated = 0, created = 0;
      let skippedRevenue = 0;
      var today = new Date().toLocaleDateString("he-IL");
      var lmIdx = 0;
      for (const r of mgmtResults) {
        lmIdx++;
        setProgress({ current: lmIdx, total: mgmtResults.length, label: (willFix ? "מתקן מכתב: " : "מכתב: ") + r.tenantName, startedAt: Date.now() });
        if (Math.abs(r.difference) < 0.01) continue;
        if (r.isRevenueBased) { skippedRevenue++; continue; }
        const baseSubject = (r.difference > 0 ? "השלמת הפרש דמי ניהול " : "החזר דמי ניהול ") + year;
        const body = "שוכר/ת נכבד/ה,\n\nלאחר ביצוע התחשבנות דמי ניהול לשנת " + year + ":\n" +
          "מקדמה: " + fmtMoney(r.advance) + "\n" +
          "חלק בפועל: " + fmtMoney(r.actualShare) + "\n" +
          "הפרש: " + fmtMoney(r.difference) + "\n\nבברכה,\nהנהלת הנכס";
        const exL = byContractL[r.contractId];
        if (exL) {
          const fixedTitle = "מכתב מתוקן — " + baseSubject;
          await supabase.from("letters").update({
            title: fixedTitle, subject: fixedTitle,
            content_json: { body: body + "\n\n[מכתב מתוקן בתאריך " + today + "]", corrected: true, correctedAt: today },
            body: body, status: "draft",
          }).eq("id", exL.id);
          await logAudit({ entity_type: "letter", entity_id: exL.id, action: "fix_mgmt_letter" });
          updated++;
        } else {
          await supabase.from("letters").insert({
            contract_id: r.contractId, letter_type: "demand",
            title: baseSubject, subject: baseSubject,
            content_json: { body: body }, body: body, status: "draft",
          });
          created++;
        }
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: willFix ? "fix_mgmt_letters" : "create_mgmt_letters", notes: "עודכנו " + updated + ", נוצרו " + created + (skippedRevenue ? " (דולג " + skippedRevenue + " % פידיון)" : "") });
      var msg2 = willFix ? ("✅ תוקנו " + updated + " מכתבים" + (created ? ", נוצרו " + created + " חדשים" : "") + " — סומנו כ\"מכתב מתוקן\"") : ("✅ נוצרו " + created + " מכתבים");
      if (skippedRevenue > 0) msg2 += "\nדולגו " + skippedRevenue + " שוכרי % פידיון";
      await loadExistingMgmtCharges();
      alert(msg2);
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setCreatingLetters(false); setProgress(null); }
  }

  return (
    <div className="space-y-6">
      {/* Section A: Budget */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">{"מקדמה — הזנת תקציב"}</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"נכס"}</label>
            <select value={propId} onChange={function (e) { setPropId(e.target.value); }} className={ic}>
              <option value="">{"— בחר נכס —"}</option>
              {properties.map(function (p) {
                return <option key={p.id} value={p.id}>{p.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"שנה"}</label>
            <input type="number" value={year} onChange={function (e) { setYear(Number(e.target.value)); }} className={ic} />
          </div>
        </div>

        {propId && totalArea > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-2 mb-4 text-sm text-slate-600">
            {"שטח כולל נכס: "}<span className="font-bold">{totalArea.toLocaleString("he-IL")} {'מ"ר'}</span>
            {selProp?.property_type === "מעורב" && (
              <span className="mr-3 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">{"נכס מעורב"}</span>
            )}
          </div>
        )}

        {/* Summary when groups exist */}
        {propId && mgmtGroupsData.length > 0 && (
          <div className="rounded-lg border-2 border-blue-300 bg-blue-50/50 p-4 mb-4">
            <div className="text-sm font-bold text-blue-800 mb-2">💡 חיוב הנכס לפי קבוצות — התקציב מפורט למטה</div>
            <div className="text-xs text-blue-700 mb-3">נכס זה משתמש בקבוצות חיוב. אין תקציב מרכזי — כל קבוצה מנהלת את התעריף והעלות שלה בנפרד.</div>
            <div className="space-y-1.5">
              {mgmtGroupsData.map(function(g: any) {
                var sids = (g.billing_group_spaces || []).map(function(x:any){return x.space_id;});
                var groupArea = sids.reduce(function(s:number,sid:string){
                  return s + (spacesAreaMap[sid] || 0);
                }, 0);
                var annual = Number(g.annual_amount) || (Number(g.rate_per_sqm_monthly) || 0) * groupArea * 12;
                return (
                  <div key={g.id} className="flex items-center justify-between bg-white rounded px-3 py-2 text-sm">
                    <div>
                      <span className="font-bold text-slate-700">{g.name}</span>
                      <span className="text-xs text-slate-500 mr-2">{sids.length} יחידות | {groupArea.toLocaleString("he-IL")} מ&quot;ר</span>
                    </div>
                    <span className="font-bold text-blue-700">{fmtMoney(annual)}/שנה</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between border-t-2 border-blue-300 pt-2 mt-1 text-sm">
                <span className="font-bold text-blue-900">סה&quot;כ תקציב שנתי (כל הקבוצות)</span>
                <span className="font-black text-blue-900 text-base">
                  {fmtMoney(mgmtGroupsData.reduce(function(s:number,g:any){
                    var sids = (g.billing_group_spaces || []).map(function(x:any){return x.space_id;});
                    var groupArea = sids.reduce(function(ss:number,sid:string){ return ss + (spacesAreaMap[sid] || 0); }, 0);
                    return s + (Number(g.annual_amount) || (Number(g.rate_per_sqm_monthly) || 0) * groupArea * 12);
                  }, 0))}
                </span>
              </div>
            </div>
          </div>
        )}

        {propId && !isMixed && mgmtGroupsData.length === 0 && (
          <>
            <div className="flex gap-3 mb-4">
              {[
                { v: "fixed" as const, l: "סכום שנתי קבוע" },
                { v: "persqm" as const, l: 'למ"ר לחודש' },
              ].map(function (m) {
                return (
                  <button key={m.v} onClick={function () { setInputMode(m.v); }}
                    className={"rounded-lg border px-4 py-2 text-sm font-semibold transition-all " +
                      (inputMode === m.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                    {m.l}
                  </button>
                );
              })}
            </div>

            {inputMode === "fixed" ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{"סכום שנתי (₪)"}</label>
                  <input type="number" value={fixedTotal} onChange={function (e) { setFixedTotal(e.target.value); }} className={ic} placeholder="0" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{'תעריף למ"ר לחודש (מחושב)'}</label>
                  <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-sm text-slate-700 font-mono">
                    {computedRate > 0 ? fmtMoney(computedRate) : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{'תעריף למ"ר לחודש (₪)'}</label>
                  <input type="number" value={perSqmRate} onChange={function (e) { setPerSqmRate(e.target.value); }} className={ic} placeholder="0" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{"סכום שנתי (מחושב)"}</label>
                  <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-sm text-slate-700 font-mono">
                    {computedTotal > 0 ? fmtMoney(computedTotal) : "—"}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {propId && isMixed && mixedRows.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-purple-700">{"תעריף לפי סוג שימוש"}</h3>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold text-slate-700">{"סוג שימוש"}</th>
                    <th className="px-4 py-2.5 font-semibold text-slate-700">{'שטח (מ"ר)'}</th>
                    <th className="px-4 py-2.5 font-semibold text-slate-700">{'תעריף למ"ר/חודש'}</th>
                    <th className="px-4 py-2.5 font-semibold text-slate-700">{"סכום שנתי"}</th>
                  </tr>
                </thead>
                <tbody>
                  {mixedRows.map(function (row, idx) {
                    return (
                      <tr key={row.useType} className="border-t border-slate-100">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{row.useType}</td>
                        <td className="px-4 py-2.5 text-slate-600">{row.totalSqm.toLocaleString("he-IL")}</td>
                        <td className="px-4 py-2.5">
                          <input type="number" value={row.rate || ""} onChange={function (e) { updateMixedRate(idx, Number(e.target.value)); }}
                            className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="0" />
                        </td>
                        <td className="px-4 py-2.5 font-bold text-slate-800">{fmtMoney(row.annual)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-700">{'סה"כ'}</td>
                    <td className="px-4 py-2.5 font-bold">{mixedRows.reduce(function (s, r) { return s + r.totalSqm; }, 0).toLocaleString("he-IL")}</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 font-black text-blue-700">{fmtMoney(mixedRows.reduce(function (s, r) { return s + r.annual; }, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {propId && mgmtGroupsData.length === 0 && (
          <div className="flex items-center gap-3 mt-4">
            <button onClick={saveBudget} disabled={saving}
              className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              {saving ? "שומר..." : "שמור תקציב"}
            </button>
            {msg && <span className="text-sm text-green-700 bg-green-50 px-3 py-1 rounded-lg">{msg}</span>}
          </div>
        )}
      </div>

      {/* Section A2: Billing Groups (management) */}
      {propId && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-2">קבוצות חיוב מיוחדות</h2>
          <p className="text-xs text-slate-500 mb-4">יחידות עם תעריף שונה מהתקציב הראשי של הנכס (למשל מחסנים מול משרדים). יחידות שלא משויכות לקבוצה יחויבו בתעריף ברירת המחדל.</p>
          <BillingGroupsManager propertyId={propId} year={year} groupType="management" />
        </div>
      )}

      {/* Section B: Reconciliation */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">התחשבנות — עלות בפועל לשנה {year}</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
            <select value={propId} onChange={function (e) { setPropId(e.target.value); }} className={ic}>
              <option value="">— בחר נכס —</option>
              {properties.map(function (p) {
                return <option key={p.id} value={p.id}>{p.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
            <input type="number" value={year} onChange={function (e) { setYear(Number(e.target.value)); }} className={ic} />
          </div>
        </div>

        {/* Per-group actual costs */}
        {propId && mgmtGroupsData.length > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-4 mb-4">
            <div className="text-xs font-bold text-blue-800 mb-2">עלות בפועל לכל קבוצה (שנתי)</div>
            <div className="space-y-2">
              {mgmtGroupsData.map(function(g: any) {
                return (
                  <div key={g.id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-slate-700">{g.name}</div>
                      <div className="text-xs text-slate-500">{(g.billing_group_spaces || []).length} יחידות | תקציב שנתי: {fmtMoney(Number(g.annual_amount) || 0)}</div>
                    </div>
                    <input type="number" value={groupActualCosts[g.id] || ""}
                      onChange={function(e){ setGroupActualCosts(function(p){return {...p, [g.id]: e.target.value};}); }}
                      className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm text-right"
                      placeholder="0 ₪ בפועל" />
                  </div>
                );
              })}
              <div className="border-t border-blue-200 pt-2 flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-700">יתר היחידות (תעריף ברירת מחדל)</div>
                  <div className="text-xs text-slate-500">תקציב שנתי: {fmtMoney(0)}</div>
                </div>
                <input type="number" value={defaultActualCost}
                  onChange={function(e){ setDefaultActualCost(e.target.value); }}
                  className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm text-right"
                  placeholder="0 ₪ בפועל" />
              </div>
            </div>
          </div>
        )}

        {/* Simple single-cost input (when no groups) */}
        {propId && mgmtGroupsData.length === 0 && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-semibold text-slate-700">עלות בפועל לשנה (₪)</label>
            <input type="number" value={actualCost} onChange={function (e) { setActualCost(e.target.value); }}
              className={ic + " max-w-xs"} placeholder="0" />
          </div>
        )}

        {/* Management charges already created for this property + year */}
        {existingMgmtCharges.length > 0 && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 my-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-bold text-blue-800">✓ כבר נוצרו {existingMgmtCharges.length} חיובי התחשבנות דמי ניהול לשנת {year} לנכס זה</div>
              <button onClick={computeReconciliation} disabled={computing || !propId} className="text-xs rounded border border-blue-300 bg-white text-blue-700 hover:bg-blue-100 px-2 py-1 font-semibold disabled:opacity-50" title="הצג את החישוב המפורט כאן">📊 הצג חישוב מפורט</button>
            </div>
            <div className="text-[11px] text-blue-600 mt-0.5">אין צורך ליצור שוב (יצירה חוזרת תיצור כפילות). למחיקה/עריכה — מסך חיובים. הסכומים שהוזנו נשמרו ומוצגים למעלה.</div>
            <div className="mt-2 rounded-lg bg-white border border-blue-100 divide-y divide-blue-50">
              {existingMgmtCharges.map(function(ch:any){
                var isCredit = Number(ch.total_amount) < 0;
                return (
                  <div key={ch.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="font-medium text-slate-700">{ch.contracts?.tenants?.name || "—"}</span>
                    <span className="flex items-center gap-2">
                      <span className={"font-semibold " + (isCredit ? "text-emerald-700" : "text-slate-800")}>{isCredit ? "זיכוי " : ""}{fmtMoney(Math.abs(Number(ch.total_amount)))}</span>
                      <span className={"rounded-full px-1.5 py-0.5 text-[10px] font-semibold " + (ch.status==="paid"?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700")}>{ch.status==="paid"?"שולם":"ממתין"}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {progress && <div className="my-3"><CalcProgress {...progress} /></div>}

        <button onClick={computeReconciliation} disabled={computing || !propId}
          className="rounded-lg bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50">
          {computing ? "מחשב..." : "חשב"}
        </button>

        {mgmtResults.length > 0 && (() => {
          // Counts for footer/buttons
          var billableCount = mgmtResults.filter(function(r){ return !r.isRevenueBased && Math.abs(r.difference) >= 0.01; }).length;
          var revenueSkippedCount = mgmtResults.filter(function(r){ return r.isRevenueBased && Math.abs(r.difference) >= 0.01; }).length;
          return (
          <div className="mt-5">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700">שוכר</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">יחידות</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">שטח (מ&quot;ר)</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">מקדמה</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">חלק בפועל</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">הפרש</th>
                  </tr>
                </thead>
                <tbody>
                  {mgmtResults.map(function (r) {
                    const color = r.difference > 0.01 ? "text-red-700 bg-red-50" : r.difference < -0.01 ? "text-green-700 bg-green-50" : "text-slate-600";
                    const isZeroBoth = r.advance < 0.01 && r.actualShare < 0.01;
                    return (
                      <tr key={r.contractId} className={"border-t border-slate-100 " + (r.isRevenueBased ? "bg-purple-50/40" : "hover:bg-slate-50") + (isZeroBoth ? " opacity-60" : "")}>
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          {r.tenantName}
                          {r.isRevenueBased && (
                            <div className="text-[10px] mt-0.5 font-normal text-purple-700 rounded bg-purple-100 inline-block px-1.5 py-0.5" title="שוכר זה משלם דמי ניהול כחלק מ-% המחזור. ההפרש מוצג למידע בלבד — אין חיוב/מכתב נפרד; יש לעדכן את שכ&quot;ד במסך שכ&quot;ד פידיון.">
                              📊 % פידיון — לא לחיוב
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{r.spaceNames}</td>
                        <td className="px-4 py-3 text-slate-600">{r.chargedArea.toLocaleString("he-IL")}</td>
                        <td className="px-4 py-3">{fmtMoney(r.advance)}</td>
                        <td className="px-4 py-3">{fmtMoney(r.actualShare)}</td>
                        <td className={"px-4 py-3 font-bold rounded " + (r.isRevenueBased ? "text-slate-500" : color)}>
                          {fmtMoney(r.difference)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-700" colSpan={2}>סה&quot;כ</td>
                    <td className="px-4 py-2.5 font-bold">{mgmtResults.reduce(function (s, r) { return s + r.chargedArea; }, 0).toLocaleString("he-IL")}</td>
                    <td className="px-4 py-2.5 font-bold">{fmtMoney(mgmtResults.reduce(function (s, r) { return s + r.advance; }, 0))}</td>
                    <td className="px-4 py-2.5 font-bold">{fmtMoney(mgmtResults.reduce(function (s, r) { return s + r.actualShare; }, 0))}</td>
                    <td className="px-4 py-2.5 font-black">{fmtMoney(mgmtResults.reduce(function (s, r) { return s + r.difference; }, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Explainer + counts */}
            <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 leading-relaxed">
              <div className="font-bold text-slate-700 mb-1">💡 מה הכפתורים יוצרים?</div>
              <div className="space-y-0.5">
                <div><span className="font-semibold">צור חיובים</span> — מוסיף שורת חיוב לטבלת <code>charges</code> לכל שוכר עם הפרש &gt; 0₪ (חיוב/זיכוי לפי הסימן). זה משלב את ההפרש לכרטסת הכספית של השוכר.</div>
                <div><span className="font-semibold">צור מכתבים</span> — יוצר טיוטות מכתבי דרישה/החזר במסך המכתבים. אינו שולח כלום — רק יוצר טיוטה.</div>
                <div className="pt-1 border-t border-slate-200 mt-1">
                  <span className="text-blue-700 font-semibold">{billableCount}</span> שוכרים זכאים לחיוב.
                  {revenueSkippedCount > 0 && <span className="text-purple-700"> + <span className="font-semibold">{revenueSkippedCount}</span> שוכרי % פידיון ידולגו אוטומטית (להזין במסך שכ&quot;ד פידיון).</span>}
                </div>
              </div>
            </div>

            {progress && <div className="mt-4"><CalcProgress {...progress} /></div>}
            <div className="flex gap-3 mt-4">
              <button onClick={createCharges} disabled={creatingCharges || billableCount === 0}
                title={billableCount === 0 ? "אין הפרשים לחיוב" : (existingMgmtCharges.length > 0 ? "מעדכן את החיובים הקיימים לפי החישוב הנוכחי (מסמן כמתוקנים) ומוסיף לשוכרים חדשים" : "מוסיף " + billableCount + " שורות חיוב לטבלת charges")}
                className={"rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 " + (existingMgmtCharges.length > 0 ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-700 hover:bg-blue-800")}>
                {creatingCharges ? "שומר..." : existingMgmtCharges.length > 0 ? ("🔧 תקן חיובים (" + existingMgmtCharges.length + ")") : "צור " + billableCount + " חיובים"}
              </button>
              <button onClick={createLetters} disabled={creatingLetters || billableCount === 0}
                title={billableCount === 0 ? "אין הפרשים למכתב" : (existingMgmtLetters.length > 0 ? "מעדכן את המכתבים הקיימים ומסמן אותם כ'מכתב מתוקן'" : "יוצר " + billableCount + " טיוטות מכתבי דרישה/החזר")}
                className={"rounded-lg border px-5 py-2.5 text-sm font-bold disabled:opacity-50 " + (existingMgmtLetters.length > 0 ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100")}>
                {creatingLetters ? "שומר..." : existingMgmtLetters.length > 0 ? ("🔧 תקן מכתבים (" + existingMgmtLetters.length + ")") : "צור " + billableCount + " מכתבים"}
              </button>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 2 — Insurance
   ═══════════════════════════════════════════════════════════ */
function InsuranceTab({ properties }: { properties: any[] }) {
  const currentYear = new Date().getFullYear();
  const [propId, setPropId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [policy, setPolicy] = useState<any>(null);
  const [results, setResults] = useState<InsResult[]>([]);
  const [computing, setComputing] = useState(false);
  const [creatingCharges, setCreatingCharges] = useState(false);
  const [creatingLetters, setCreatingLetters] = useState(false);
  // Insurance charges already created for this property + year (so the manager
  // can see what was billed and avoid duplicating it).
  const [existingCharges, setExistingCharges] = useState<any[]>([]);
  const [existingLetters, setExistingLetters] = useState<any[]>([]);
  const [progress, setProgress] = useState<CalcProgressState | null>(null);
  // Detected data issues to surface in the UI (e.g. a space assigned to two
  // active contracts simultaneously). Cleared on each compute().
  const [warnings, setWarnings] = useState<string[]>([]);

  // Per-space vacancy info (computed alongside results). The user picks a
  // "disposition" per vacant unit:
  //   "owner"        — default; owner self-insures
  //   "redistribute" — vacant sqm-days removed from denominator; all active
  //                    tenants share the burden proportionally
  //   <contractId>   — vacant sqm-days added to that specific contract's
  //                    numerator (typically the unit's last tenant when a
  //                    renewal is expected — only they pay extra)
  type SpaceVacancy = {
    id: string;
    name: string;
    area: number;
    daysHeld: number;       // union of all contract holdings within policy
    daysVacant: number;     // policyDays − daysHeld (clamped to ≥ 0)
    vacantSqmDays: number;  // area × daysVacant
    isFullyVacant: boolean; // never held during the entire policy
    // The actual vacant date intervals within the policy, formatted for display
    vacantRanges: Array<{ start: string; end: string; days: number }>;
    // Reason explanation
    lastContractId?: string;       // contract that held the space last (if any)
    lastTenantName?: string;
    lastEndDate?: string;          // ISO date — when the last tenancy ended
    vacancyReason: "always_vacant" | "tail" | "gap" | "head";
    // tail = ends before policyEnd; head = no one until X then held; gap = mid-period gap
  };
  const [spaceVacancies, setSpaceVacancies] = useState<SpaceVacancy[]>([]);
  // Per-space disposition. "owner" | "redistribute" | <contractId>.
  // Missing entry == "owner".
  const [spaceDispositions, setSpaceDispositions] = useState<Record<string, string>>({});
  // The denominator from the last compute() — needed to render the derived
  // (post-redistribution) tenant shares without re-querying the DB.
  const [computedTotalSqmDays, setComputedTotalSqmDays] = useState<number>(0);
  const [computedPolicyDays, setComputedPolicyDays] = useState<number>(0);

  const selProp = properties.find(function (p) { return p.id === propId; });
  const totalArea = selProp?.total_area ?? 0;

  useEffect(function () {
    if (!propId) { setPolicy(null); setResults([]); return; }
    loadInsurance();
  }, [propId, year]);

  async function loadInsurance() {
    const { data } = await supabase
      .from("insurances_building")
      .select("*")
      .eq("property_id", propId)
      .eq("status", "active")
      .order("end_date", { ascending: false })
      .limit(1);
    setPolicy(data?.[0] ?? null);
    setResults([]);
    loadExistingCharges();
  }

  async function loadExistingCharges() {
    if (!propId) { setExistingCharges([]); setExistingLetters([]); return; }
    const [{ data: chData }, { data: ltData }] = await Promise.all([
      supabase.from("charges")
        .select("id, total_amount, status, created_at, notes, contract_id, contracts(property_id, tenants(name))")
        .eq("charge_type", "insurance")
        .eq("billing_period_start", year + "-01-01"),
      supabase.from("letters")
        .select("id, title, subject, contract_id, contracts(property_id)")
        .eq("letter_type", "notice")
        .or("subject.eq.חיוב ביטוח מבנה " + year + ",title.eq.חיוב ביטוח מבנה " + year + ",title.eq.מכתב מתוקן — חיוב ביטוח מבנה " + year),
    ]);
    setExistingCharges((chData ?? []).filter(function(x:any){ return x.contracts?.property_id === propId; }));
    setExistingLetters((ltData ?? []).filter(function(x:any){ return x.contracts?.property_id === propId; }));
  }

  async function compute() {
    if (!propId || !policy) { alert("יש לבחור נכס עם ביטוח פעיל"); return; }
    setComputing(true);
    setProgress({ current: 0, total: 0, label: "מחשב חלוקת ביטוח לפי מ\"ר-ימים...", startedAt: Date.now() });
    try {
      const premium = policy.annual_premium ?? 0;
      // Policy period — bound all tenancy intersections by this window
      const policyStart = new Date(policy.start_date);
      const policyEnd = new Date(policy.end_date);
      const policyDays = Math.max(1, Math.floor((policyEnd.getTime() - policyStart.getTime()) / 86400000) + 1);

      // 1) Base contracts (no amendments — those are merged into the timeline below)
      const { data: baseContracts } = await supabase
        .from("contracts")
        .select("id, charged_area, start_date, end_date, status, tenants(name), contract_spaces(space_id, spaces(space_name, area))")
        .eq("property_id", propId)
        .eq("is_amendment", false)
        .in("status", ["active", "expiring", "extended"]);

      const baseList = baseContracts || [];
      const baseIds = baseList.map(function(c: any) { return c.id; });

      // 2) Amendments per base — needed to track unit/area swaps mid-policy
      const amendsByParent: Record<string, any[]> = {};
      if (baseIds.length > 0) {
        const { data: amends } = await supabase
          .from("contracts")
          .select("id, parent_contract_id, amendment_date, start_date, charged_area, contract_spaces(space_id, spaces(space_name, area))")
          .in("parent_contract_id", baseIds)
          .eq("is_amendment", true)
          .order("amendment_date", { ascending: true });
        (amends || []).forEach(function(am: any) {
          const pid = am.parent_contract_id;
          if (!amendsByParent[pid]) amendsByParent[pid] = [];
          amendsByParent[pid].push(am);
        });
      }

      // Helper: days of overlap between two date ranges (inclusive)
      var daysOverlap = function(a1: Date, a2: Date, b1: Date, b2: Date): number {
        const s = a1 > b1 ? a1 : b1;
        const e = a2 < b2 ? a2 : b2;
        if (e < s) return 0;
        return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
      };
      var joinNames = function(cs: any[]): string {
        return (cs || []).map(function(x: any) { return x?.spaces?.space_name; }).filter(Boolean).join(", ");
      };

      // 2.5) Data-sanity check: detect spaces claimed by multiple contracts
      // AT THE SAME TIME (not just sequentially). A clean handoff (Yehonatan
      // until 12.3, Golf from 13.3) is fine; overlapping claims double-bill
      // the same square meters.
      //
      // Build per-space per-contract holding ranges, then check pairs for
      // actual time overlap.
      type ClaimRange = { start: Date; end: Date; tenant: string; contractId: string; spaceName: string; };
      var claimsBySpace: Record<string, ClaimRange[]> = {};
      var addClaim = function(sid: string, name: string, start: Date, end: Date, contractId: string, tenant: string) {
        if (!claimsBySpace[sid]) claimsBySpace[sid] = [];
        claimsBySpace[sid].push({ start, end, contractId, tenant, spaceName: name });
      };
      baseList.forEach(function(c: any) {
        var contractStart = c.start_date ? new Date(c.start_date) : policyStart;
        var contractEndDate = c.end_date ? new Date(c.end_date) : policyEnd;
        var amends = amendsByParent[c.id] || [];

        // Base snapshot range: contractStart → (first amendment - 1) or contractEnd
        var baseEnd = amends.length > 0
          ? new Date(new Date(amends[0].amendment_date || amends[0].start_date).getTime() - 86400000)
          : contractEndDate;
        (c.contract_spaces || []).forEach(function(cs: any) {
          if (!cs.space_id) return;
          addClaim(cs.space_id, cs.spaces?.space_name || cs.space_id, contractStart, baseEnd, c.id, (c.tenants as any)?.name || "—");
        });
        // Each amendment is its own range
        amends.forEach(function(am: any, i: number) {
          var amStart = new Date(am.amendment_date || am.start_date);
          var nextAm = amends[i + 1];
          var amEnd = nextAm
            ? new Date(new Date(nextAm.amendment_date || nextAm.start_date).getTime() - 86400000)
            : contractEndDate;
          (am.contract_spaces || []).forEach(function(cs: any) {
            if (!cs.space_id) return;
            addClaim(cs.space_id, cs.spaces?.space_name || cs.space_id, amStart, amEnd, c.id, (c.tenants as any)?.name || "—");
          });
        });
      });

      var newWarnings: string[] = [];
      Object.keys(claimsBySpace).forEach(function(sid) {
        var rngs = claimsBySpace[sid];
        // Only inter-contract claims matter (different contract families).
        // Same-contract overlaps are normal during the snapshot model.
        for (var i = 0; i < rngs.length; i++) {
          for (var j = i + 1; j < rngs.length; j++) {
            var a = rngs[i], b = rngs[j];
            if (a.contractId === b.contractId) continue;
            // Overlap iff a.start <= b.end AND b.start <= a.end
            if (a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime()) {
              var fmt = function(d: Date) { return d.toLocaleDateString("he-IL"); };
              newWarnings.push("⚠ יחידה \"" + a.spaceName + "\" משויכת בו-זמנית ל-" + a.tenant + " (" + fmt(a.start) + "–" + fmt(a.end) + ") ול-" + b.tenant + " (" + fmt(b.start) + "–" + fmt(b.end) + ")");
              break; // one warning per space is enough
            }
          }
        }
      });
      setWarnings(newWarnings);

      // 3) Build per-contract area timeline → sum sqm-days inside policy window
      const res: InsResult[] = baseList.map(function(c: any) {
        const contractStart = c.start_date ? new Date(c.start_date) : policyStart;
        const contractEnd   = c.end_date   ? new Date(c.end_date)   : policyEnd;

        type Seg = { start: Date; end: Date; area: number; spaceName: string };
        const segments: Seg[] = [];

        let curArea  = Number(c.charged_area) || 0;
        let curName  = joinNames(c.contract_spaces);
        let curStart = contractStart;

        const amends = amendsByParent[c.id] || [];
        amends.forEach(function(am: any) {
          const amDate = new Date(am.amendment_date || am.start_date);
          const prevEnd = new Date(amDate.getTime() - 86400000);
          segments.push({ start: curStart, end: prevEnd, area: curArea, spaceName: curName });
          curArea = Number(am.charged_area) || curArea;
          curName = joinNames(am.contract_spaces) || curName;
          curStart = amDate;
        });
        segments.push({ start: curStart, end: contractEnd, area: curArea, spaceName: curName });

        // Sum sqm-days inside the policy window — naturally pro-rates by unit
        // swaps, mid-year tenancy start, and mid-year tenancy end.
        let sqmDays = 0;
        let daysCovered = 0;
        const areasSeenSet: Record<number, boolean> = {};
        const namesSeen: string[] = [];
        segments.forEach(function(seg) {
          const days = daysOverlap(seg.start, seg.end, policyStart, policyEnd);
          if (days > 0) {
            sqmDays += seg.area * days;
            daysCovered += days;
            areasSeenSet[seg.area] = true;
            if (seg.spaceName && namesSeen.indexOf(seg.spaceName) === -1) namesSeen.push(seg.spaceName);
          }
        });
        const areasSeen = Object.keys(areasSeenSet).map(Number).sort(function(a, b) { return b - a; });
        const areaRange = areasSeen.length > 1 ? areasSeen.join(" → ") : undefined;
        const isPartialPeriod = daysCovered < policyDays;

        return {
          contractId: c.id,
          tenantName: (c.tenants as any)?.name ?? "—",
          spaceNames: namesSeen.join(", ") || "—",
          area: curArea, areaRange,
          sqmDays, daysInPolicy: daysCovered, policyDays,
          contractStart: contractStart.toISOString().slice(0, 10),
          contractEnd: contractEnd.toISOString().slice(0, 10),
          pct: 0, charge: 0, isPartialPeriod,
        };
      });

      // 4) Convert sqm-days to % and charge.
      // Denominator: property's total possible sqm-days (totalArea × policyDays).
      // Using the property total (not the sum of tenant sqm-days) means a tenant's
      // share is anchored to a stable physical denominator — vacant periods are
      // not silently redistributed onto everyone else. The remainder is the
      // owner's self-insurance share.
      const propertySqmDays = (totalArea || 0) * policyDays;
      res.forEach(function(r) {
        if (propertySqmDays > 0) {
          r.pct = (r.sqmDays / propertySqmDays) * 100;
          r.charge = (r.sqmDays / propertySqmDays) * premium;
        }
      });

      setResults(res);
      setComputedTotalSqmDays(propertySqmDays);
      setComputedPolicyDays(policyDays);

      // 5) Per-space vacancy: for every space on the property, union all
      // periods it was held by any contract snapshot, then policyDays −
      // heldDays = vacancy. Lets the user see exactly which units make up
      // the owner's share, and toggle them to redistribute to tenants.
      var { data: propSpaces } = await supabase
        .from("spaces")
        .select("id, space_name, area")
        .eq("property_id", propId);

      type Snapshot = { startDate: Date; endDate: Date; spaceIds: Record<string, boolean>; };
      var snapshotsByContract: Record<string, Snapshot[]> = {};
      baseList.forEach(function(c: any) {
        var snaps: Snapshot[] = [];
        var amends = amendsByParent[c.id] || [];
        var contractEndDate = c.end_date ? new Date(c.end_date) : policyEnd;

        var baseEnd = amends.length > 0
          ? new Date(new Date(amends[0].amendment_date || amends[0].start_date).getTime() - 86400000)
          : contractEndDate;
        var baseSpaceIds: Record<string, boolean> = {};
        (c.contract_spaces || []).forEach(function(cs: any) { if (cs.space_id) baseSpaceIds[cs.space_id] = true; });
        snaps.push({ startDate: c.start_date ? new Date(c.start_date) : policyStart, endDate: baseEnd, spaceIds: baseSpaceIds });

        amends.forEach(function(am: any, i: number) {
          var amStart = new Date(am.amendment_date || am.start_date);
          var nextAm = amends[i + 1];
          var amEnd = nextAm
            ? new Date(new Date(nextAm.amendment_date || nextAm.start_date).getTime() - 86400000)
            : contractEndDate;
          var amSpaceIds: Record<string, boolean> = {};
          (am.contract_spaces || []).forEach(function(cs: any) { if (cs.space_id) amSpaceIds[cs.space_id] = true; });
          snaps.push({ startDate: amStart, endDate: amEnd, spaceIds: amSpaceIds });
        });
        snapshotsByContract[c.id] = snaps;
      });

      type HeldRange = { start: Date; end: Date; cid: string; };
      var vacancies: SpaceVacancy[] = (propSpaces || []).map(function(s: any) {
        var ranges: HeldRange[] = [];
        Object.keys(snapshotsByContract).forEach(function(cid) {
          snapshotsByContract[cid].forEach(function(snap) {
            if (!snap.spaceIds[s.id]) return;
            var start = snap.startDate > policyStart ? snap.startDate : policyStart;
            var end = snap.endDate < policyEnd ? snap.endDate : policyEnd;
            if (end < start) return;
            ranges.push({ start: start, end: end, cid: cid });
          });
        });

        // Find the latest range that ends nearest to policyEnd — that's the
        // "last tenant" who would naturally take a renewal extension.
        var byEnd = ranges.slice().sort(function(a, b) { return b.end.getTime() - a.end.getTime(); });
        var lastRange = byEnd[0];
        var lastContract = lastRange ? baseList.find(function(b: any) { return b.id === lastRange.cid; }) : undefined;
        var lastTenantName = (lastContract?.tenants as any)?.name;

        // Merge overlapping ranges to count daysHeld correctly
        var sorted = ranges.slice().sort(function(a, b) { return a.start.getTime() - b.start.getTime(); });
        var merged: Array<[Date, Date]> = [];
        sorted.forEach(function(r) {
          if (merged.length === 0) { merged.push([r.start, r.end]); return; }
          var last = merged[merged.length - 1];
          if (r.start.getTime() <= last[1].getTime() + 86400000) {
            if (r.end.getTime() > last[1].getTime()) last[1] = r.end;
          } else {
            merged.push([r.start, r.end]);
          }
        });
        var daysHeld = merged.reduce(function(sum, r) {
          return sum + Math.floor((r[1].getTime() - r[0].getTime()) / 86400000) + 1;
        }, 0);
        var daysVacant = Math.max(0, policyDays - daysHeld);
        var area = Number(s.area) || 0;

        // Vacancy reason
        var reason: "always_vacant" | "tail" | "gap" | "head" = "always_vacant";
        if (merged.length > 0) {
          var firstStart = merged[0][0];
          var lastEnd = merged[merged.length - 1][1];
          var hasHead = firstStart.getTime() > policyStart.getTime();
          var hasTail = lastEnd.getTime() < policyEnd.getTime();
          var hasGap = merged.length > 1;
          if (hasTail && !hasHead && !hasGap) reason = "tail";
          else if (hasHead && !hasTail && !hasGap) reason = "head";
          else if (hasGap) reason = "gap";
          else if (hasTail) reason = "tail";
          else if (hasHead) reason = "head";
        }

        // Compute actual VACANT intervals = policy period minus merged held ranges.
        // This is what we display to the user so they see the exact dates.
        var vacantRanges: Array<{ start: string; end: string; days: number }> = [];
        var fmtDay = function(d: Date) { return d.toLocaleDateString("he-IL"); };
        var daysBetween = function(a: Date, b: Date) {
          return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
        };
        if (merged.length === 0) {
          // never held → entire policy is vacant
          vacantRanges.push({ start: fmtDay(policyStart), end: fmtDay(policyEnd), days: policyDays });
        } else {
          // Head gap: before the first held range
          if (merged[0][0].getTime() > policyStart.getTime()) {
            var headEnd = new Date(merged[0][0].getTime() - 86400000);
            vacantRanges.push({ start: fmtDay(policyStart), end: fmtDay(headEnd), days: daysBetween(policyStart, headEnd) });
          }
          // Gaps between merged ranges
          for (var mi = 0; mi < merged.length - 1; mi++) {
            var gapStart = new Date(merged[mi][1].getTime() + 86400000);
            var gapEnd = new Date(merged[mi + 1][0].getTime() - 86400000);
            if (gapEnd >= gapStart) {
              vacantRanges.push({ start: fmtDay(gapStart), end: fmtDay(gapEnd), days: daysBetween(gapStart, gapEnd) });
            }
          }
          // Tail gap: after the last held range
          if (merged[merged.length - 1][1].getTime() < policyEnd.getTime()) {
            var tailStart = new Date(merged[merged.length - 1][1].getTime() + 86400000);
            vacantRanges.push({ start: fmtDay(tailStart), end: fmtDay(policyEnd), days: daysBetween(tailStart, policyEnd) });
          }
        }

        return {
          id: s.id,
          name: s.space_name || "—",
          area,
          daysHeld,
          daysVacant,
          vacantSqmDays: area * daysVacant,
          isFullyVacant: daysHeld === 0,
          vacantRanges,
          lastContractId: lastRange?.cid,
          lastTenantName: lastTenantName,
          lastEndDate: lastRange ? lastRange.end.toISOString().slice(0, 10) : undefined,
          vacancyReason: reason,
        };
      }).filter(function(v) { return v.daysVacant > 0; }) // only show units with vacancy
        .sort(function(a, b) { return b.vacantSqmDays - a.vacantSqmDays; });

      setSpaceVacancies(vacancies);
      // Restore the saved dispositions for this property+year so the recompute
      // reproduces exactly what was billed (e.g. a vacant unit assigned to the
      // continuing tenant). Falls back to "owner" default when none saved.
      var saved = await loadSavedDispositions();
      setSpaceDispositions(saved || {});
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setComputing(false); setProgress(null); }
  }

  async function loadSavedDispositions(): Promise<Record<string, string>> {
    if (!propId) return {};
    const { data } = await supabase.from("insurance_billing_dispositions")
      .select("dispositions").eq("property_id", propId).eq("year", year).limit(1);
    var d = data && data[0] && data[0].dispositions;
    return (d && typeof d === "object") ? d : {};
  }
  async function saveDispositions() {
    if (!propId) return;
    try {
      await supabase.from("insurance_billing_dispositions")
        .upsert({ property_id: propId, year: year, dispositions: spaceDispositions, updated_at: new Date().toISOString() }, { onConflict: "property_id,year" });
    } catch (e) { /* non-fatal */ }
  }

  // Recomputes per-tenant charge with the current vacancy dispositions
  // applied, so create-charges/letters always match what the user sees in
  // the table. Mirrors the math in the render-IIFE.
  function buildEffectiveResults(): InsResult[] {
    var excludedSqmDays = 0;
    var bonusByContract: Record<string, number> = {};
    spaceVacancies.forEach(function(v) {
      var d = spaceDispositions[v.id] || "owner";
      if (d === "redistribute") excludedSqmDays += v.vacantSqmDays;
      else if (d !== "owner") bonusByContract[d] = (bonusByContract[d] || 0) + v.vacantSqmDays;
    });
    var effectiveDenominator = Math.max(1, computedTotalSqmDays - excludedSqmDays);
    var premium = policy?.annual_premium ?? 0;
    return results.map(function(r) {
      var effectiveSqmDays = r.sqmDays + (bonusByContract[r.contractId] || 0);
      var pct = (effectiveSqmDays / effectiveDenominator) * 100;
      var charge = (effectiveSqmDays / effectiveDenominator) * premium;
      return Object.assign({}, r, { pct, charge });
    });
  }

  // Create OR fix insurance charges: update existing rows for the same
  // contract+year (so amounts are corrected, not duplicated), and insert new
  // ones for tenants that don't yet have a charge.
  async function createCharges() {
    if (results.length === 0) return;
    var effective = buildEffectiveResults().filter(function(r:any){ return r.charge >= 0.01; });
    var byContract: Record<string, any> = {};
    existingCharges.forEach(function(c:any){ byContract[c.contract_id] = c; });
    var willFix = effective.filter(function(r:any){ return byContract[r.contractId]; }).length;
    if (willFix > 0) {
      if (!confirm("נמצאו " + willFix + " חיובי ביטוח קיימים לשנת " + year + ".\nלתקן אותם לפי החישוב הנוכחי? (הסכומים יעודכנו ויסומנו כמתוקנים; לשוכרים ללא חיוב ייווצר חיוב חדש)")) return;
    }
    setCreatingCharges(true);
    setProgress({ current: 0, total: effective.length, label: willFix ? "מתקן חיובים..." : "יוצר חיובים...", startedAt: Date.now() });
    try {
      var graceDays = await getGraceDaysForProperty(propId);
      var dueDateStr = dueDateFromGrace(graceDays);
      var today = new Date().toLocaleDateString("he-IL");
      var updated = 0, created = 0;
      var idx = 0;
      for (const r of effective) {
        idx++;
        setProgress({ current: idx, total: effective.length, label: (willFix ? "מתקן: " : "יוצר: ") + r.tenantName, startedAt: Date.now() });
        var baseNotes = "חיוב ביטוח מבנה " + year + (r.isPartialPeriod ? " (תקופה חלקית: " + r.daysInPolicy + "/" + r.policyDays + " ימים)" : "");
        var ex = byContract[r.contractId];
        if (ex) {
          await supabase.from("charges").update({
            base_amount: r.charge, vat_amount: 0, total_amount: r.charge,
            notes: baseNotes + " [מתוקן " + today + "]",
          }).eq("id", ex.id);
          await logAudit({ entity_type: "charge", entity_id: ex.id, action: "fix_ins_charge", notes: "סכום מעודכן " + r.charge });
          updated++;
        } else {
          await supabase.from("charges").insert({
            contract_id: r.contractId, charge_type: "insurance",
            base_amount: r.charge, vat_amount: 0, total_amount: r.charge,
            vat_type: "exempt", billing_period_start: year + "-01-01",
            billing_period_end: year + "-12-31", due_date: dueDateStr,
            status: "pending", notes: baseNotes,
          });
          created++;
        }
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: willFix ? "fix_ins_charges" : "create_ins_charges", notes: "עודכנו " + updated + ", נוצרו " + created });
      await saveDispositions();
      await loadExistingCharges();
      alert(willFix
        ? ("✅ תוקנו " + updated + " חיובים" + (created ? ", נוצרו " + created + " חדשים" : ""))
        : ("✅ נוצרו " + created + " חיובים"));
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setCreatingCharges(false); setProgress(null); }
  }

  // Create OR fix insurance letters: update the existing letter for a
  // contract+year (renaming it "מכתב מתוקן …" so it's tracked in /letters)
  // and create new ones for tenants that don't yet have a letter.
  async function createLetters() {
    if (results.length === 0) return;
    var effective = buildEffectiveResults().filter(function(r:any){ return r.charge >= 0.01; });
    var byContract: Record<string, any> = {};
    existingLetters.forEach(function(l:any){ byContract[l.contract_id] = l; });
    var willFix = effective.filter(function(r:any){ return byContract[r.contractId]; }).length;
    if (willFix > 0) {
      if (!confirm("נמצאו " + willFix + " מכתבי ביטוח קיימים לשנת " + year + ".\nלתקן אותם? התוכן יעודכן והם יסומנו כ\"מכתב מתוקן\" במסך מכתבים.")) return;
    }
    setCreatingLetters(true);
    setProgress({ current: 0, total: effective.length, label: willFix ? "מתקן מכתבים..." : "יוצר מכתבים...", startedAt: Date.now() });
    try {
      var today = new Date().toLocaleDateString("he-IL");
      var updated = 0, created = 0;
      var lidx = 0;
      for (const r of effective) {
        lidx++;
        setProgress({ current: lidx, total: effective.length, label: (willFix ? "מתקן מכתב: " : "יוצר מכתב: ") + r.tenantName, startedAt: Date.now() });
        var periodLine = r.isPartialPeriod
          ? "תקופת חיוב: " + r.daysInPolicy + " מתוך " + r.policyDays + " ימים\n"
          : "";
        var areaLine = r.areaRange
          ? "שטח (השתנה במהלך השנה): " + r.areaRange + " מ\"ר\n"
          : "שטח: " + r.area.toLocaleString("he-IL") + " מ\"ר\n";
        var body = "שוכר/ת נכבד/ה,\n\nלהלן חיוב ביטוח מבנה לשנת " + year + ":\n" +
          areaLine + periodLine +
          "חלק יחסי: " + r.pct.toFixed(2) + "%\n" +
          "חיוב: " + fmtMoney(r.charge) + "\n\nבברכה,\nהנהלת הנכס";
        var ex = byContract[r.contractId];
        if (ex) {
          var fixedTitle = "מכתב מתוקן — חיוב ביטוח מבנה " + year;
          await supabase.from("letters").update({
            title: fixedTitle,
            subject: fixedTitle,
            content_json: { body: body + "\n\n[מכתב מתוקן בתאריך " + today + "]", corrected: true, correctedAt: today },
            body: body,
            status: "draft",
          }).eq("id", ex.id);
          await logAudit({ entity_type: "letter", entity_id: ex.id, action: "fix_ins_letter" });
          updated++;
        } else {
          var origTitle = "חיוב ביטוח מבנה " + year;
          await supabase.from("letters").insert({
            contract_id: r.contractId,
            letter_type: "notice",
            title: origTitle,
            subject: origTitle,
            content_json: { body: body },
            body: body,
            status: "draft",
          });
          created++;
        }
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: willFix ? "fix_ins_letters" : "create_ins_letters", notes: "עודכנו " + updated + ", נוצרו " + created });
      await saveDispositions();
      await loadExistingCharges();
      alert(willFix
        ? ("✅ תוקנו " + updated + " מכתבים" + (created ? ", נוצרו " + created + " חדשים" : "") + " — סומנו כ\"מכתב מתוקן\" במסך מכתבים")
        : ("✅ נוצרו " + created + " מכתבים"));
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setCreatingLetters(false); setProgress(null); }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">{"ביטוח מבנה"}</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"נכס"}</label>
            <select value={propId} onChange={function (e) { setPropId(e.target.value); }} className={ic}>
              <option value="">{"— בחר נכס —"}</option>
              {properties.map(function (p) {
                return <option key={p.id} value={p.id}>{p.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"שנה"}</label>
            <input type="number" value={year} onChange={function (e) { setYear(Number(e.target.value)); }} className={ic} />
          </div>
        </div>

        {policy ? (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 mb-4">
            <div className="text-sm font-bold text-green-800 mb-2">{"פוליסה פעילה"}</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between"><span className="text-green-700">{"מבטח"}</span><span className="font-semibold">{policy.insurer_name ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"מספר פוליסה"}</span><span className="font-semibold font-mono">{policy.policy_number ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"כיסוי"}</span><span className="font-semibold">{fmtMoney(policy.coverage_amount ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"פרמיה שנתית"}</span><span className="font-bold text-green-900">{fmtMoney(policy.annual_premium ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"תוקף"}</span><span className="font-semibold">{fmtDate(policy.start_date)}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"פקיעה"}</span><span className="font-semibold">{fmtDate(policy.end_date)}</span></div>
            </div>
          </div>
        ) : propId ? (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 mb-4 text-sm text-yellow-800">
            {"לא נמצא ביטוח מבנה פעיל לנכס זה"}
          </div>
        ) : null}

        {/* Charges already created for this property + year */}
        {existingCharges.length > 0 && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 mb-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-bold text-blue-800">✓ כבר נוצרו {existingCharges.length} חיובי ביטוח לשנת {year} לנכס זה</div>
              <button onClick={compute} disabled={computing || !policy} className="text-xs rounded border border-blue-300 bg-white text-blue-700 hover:bg-blue-100 px-2 py-1 font-semibold disabled:opacity-50" title="הצג את החישוב המפורט כאן (פירוט לכל שוכר)">📊 הצג חישוב מפורט</button>
            </div>
            <div className="text-[11px] text-blue-600 mt-0.5">אין צורך ליצור חיובים שוב (יצירה חוזרת תיצור כפילות). למחיקה/עריכה של חיוב — מסך חיובים. אם טרם נוצרו מכתבים — לחץ &quot;הצג חישוב מפורט&quot; ואז &quot;צור מכתבים&quot;.</div>
            <div className="mt-2 rounded-lg bg-white border border-blue-100 divide-y divide-blue-50">
              {existingCharges.map(function(ch:any){
                return (
                  <div key={ch.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="font-medium text-slate-700">{ch.contracts?.tenants?.name || "—"}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{fmtMoney(ch.total_amount)}</span>
                      <span className={"rounded-full px-1.5 py-0.5 text-[10px] font-semibold " + (ch.status==="paid"?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700")}>{ch.status==="paid"?"שולם":"ממתין"}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {progress && <div className="my-3"><CalcProgress {...progress} /></div>}

        <button onClick={compute} disabled={computing || !propId || !policy}
          className="rounded-lg bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50">
          {computing ? "מחשב..." : "חשב"}
        </button>

        {results.length > 0 && (() => {
          // Two ways the manager can reassign vacant sqm-days:
          //   "redistribute" → shrinks the denominator (all tenants share more)
          //   "<contract_id>" → adds to that contract's numerator (only they pay)
          // Default ("owner") → owner self-insures.
          var excludedSqmDays = 0;
          var bonusByContract: Record<string, number> = {};
          spaceVacancies.forEach(function(v) {
            var d = spaceDispositions[v.id] || "owner";
            if (d === "redistribute") {
              excludedSqmDays += v.vacantSqmDays;
            } else if (d !== "owner") {
              bonusByContract[d] = (bonusByContract[d] || 0) + v.vacantSqmDays;
            }
          });
          var effectiveDenominator = Math.max(1, computedTotalSqmDays - excludedSqmDays);
          var premium = policy?.annual_premium ?? 0;
          // Derived per-row display values
          var displayResults = results.map(function(r) {
            var effectiveSqmDays = r.sqmDays + (bonusByContract[r.contractId] || 0);
            var pct = (effectiveSqmDays / effectiveDenominator) * 100;
            var charge = (effectiveSqmDays / effectiveDenominator) * premium;
            return Object.assign({}, r, { pct, charge, hasRenewalBonus: !!bonusByContract[r.contractId] });
          });
          var totPct = displayResults.reduce(function (s, r) { return s + r.pct; }, 0);
          var totCharge = displayResults.reduce(function (s, r) { return s + r.charge; }, 0);
          var partialCount = displayResults.filter(function (r) { return r.isPartialPeriod; }).length;
          var ownerSelf = Math.max(0, 100 - totPct);
          var ownerCharge = Math.max(0, premium - totCharge);
          var overBilled = totPct > 100.5;
          var overshoot = totPct - 100;
          var redistributeCount = spaceVacancies.filter(function(v) { return spaceDispositions[v.id] === "redistribute"; }).length;
          var renewalCount = spaceVacancies.filter(function(v) { var d = spaceDispositions[v.id]; return d && d !== "owner" && d !== "redistribute"; }).length;
          return (
          <div className="mt-5">
            {/* Data-sanity warnings (overlapping space claims) */}
            {warnings.length > 0 && (
              <div className="mb-3 rounded-lg border-2 border-orange-300 bg-orange-50 p-3 text-sm">
                <div className="font-bold text-orange-800 mb-1.5">🚨 בעיות בנתוני החוזים — כפילות בשיוך יחידות</div>
                <div className="space-y-1 text-xs text-orange-800">
                  {warnings.map(function (w, i) { return <div key={i}>{w}</div>; })}
                </div>
                <div className="mt-2 text-[11px] text-orange-700">
                  כל עוד הכפילות לא תתוקן בנתוני החוזים, החיוב המחושב עלול להיות שגוי. תקן באמצעות עריכת החוזים הרלוונטיים.
                </div>
              </div>
            )}

            {/* Total-over-100 validation banner */}
            {overBilled && (
              <div className="mb-3 rounded-lg border-2 border-red-400 bg-red-50 p-3 text-sm">
                <div className="font-bold text-red-800 mb-1">❌ סך % עולה על 100% ({totPct.toFixed(2)}%, חריגה של {overshoot.toFixed(2)}%)</div>
                <div className="text-xs text-red-700">
                  משמעות הדבר ששטחים נחשבים מספר פעמים. אין ליצור חיובים עד תיקון הבעיה.
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700">שוכר / יחידות</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">תקופה</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">שטח (מ&quot;ר)</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">% חלק</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">חיוב</th>
                  </tr>
                </thead>
                <tbody>
                  {displayResults.map(function (r) {
                    var areaCell = r.areaRange || r.area.toLocaleString("he-IL");
                    var periodCell = r.daysInPolicy === r.policyDays
                      ? "כל התקופה"
                      : r.daysInPolicy + "/" + r.policyDays + " ימים";
                    return (
                      <tr key={r.contractId} className={"border-t border-slate-100 " + (r.isPartialPeriod ? "bg-amber-50/40" : "hover:bg-slate-50")}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800">{r.tenantName}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{r.spaceNames || "—"}</div>
                          {r.isPartialPeriod && (
                            <div className="text-[10px] mt-1 font-normal text-amber-700 rounded bg-amber-100 inline-block px-1.5 py-0.5"
                                 title={"החזקה רק " + r.daysInPolicy + " מתוך " + r.policyDays + " ימי הפוליסה — מחויב יחסית"}>
                              ⏱ תקופה חלקית
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{periodCell}</td>
                        <td className="px-4 py-3 text-slate-600">{areaCell}</td>
                        <td className="px-4 py-3 text-slate-600">{r.pct.toFixed(2)}%</td>
                        <td className="px-4 py-3 font-bold text-blue-700">{fmtMoney(r.charge)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-700" colSpan={3}>סה&quot;כ — שוכרים</td>
                    <td className={"px-4 py-2.5 font-bold " + (overBilled ? "text-red-700" : "")}>
                      {totPct.toFixed(2)}%
                      {overBilled && <span className="text-[10px] mr-1">⚠ חורג</span>}
                    </td>
                    <td className="px-4 py-2.5 font-black text-blue-700">{fmtMoney(totCharge)}</td>
                  </tr>
                  {!overBilled && ownerSelf > 0.5 && (
                    <tr className="border-t border-slate-200">
                      <td className="px-4 py-2.5 font-semibold text-amber-700" colSpan={3}>חלק בעלים (שטח פנוי / לא מבוטח על-ידי שוכרים)</td>
                      <td className="px-4 py-2.5 font-semibold text-amber-700">{ownerSelf.toFixed(2)}%</td>
                      <td className="px-4 py-2.5 font-bold text-amber-700">{fmtMoney(ownerCharge)}</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>

            {/* Vacant-units breakdown + per-unit disposition (3-way) */}
            {spaceVacancies.length > 0 && (
              <div className="mt-4 rounded-xl border-2 border-amber-200 bg-amber-50/50 overflow-hidden">
                <div className="bg-amber-100/60 px-4 py-2.5">
                  <div className="font-bold text-amber-900 text-sm">🏚 יחידות ריקות / חלקיות שמרכיבות את חלק הבעלים</div>
                  <div className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                    לכל יחידה אפשר לבחור מי משלם על הימים הריקים:
                    {" "}<span className="font-semibold">בעלים</span> (ברירת מחדל),
                    {" "}<span className="font-semibold">חלוקה לשוכרים פעילים</span> (כולם משלמים יותר יחסית),
                    {" "}או <span className="font-semibold">חיוב השוכר האחרון</span> (כשמצופה חידוש — רק הוא משלם).
                  </div>
                </div>
                <table className="w-full text-right text-sm">
                  <thead className="bg-amber-50 border-b border-amber-200">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-amber-900">יחידה</th>
                      <th className="px-3 py-2 font-semibold text-amber-900">סיבת ריקות</th>
                      <th className="px-3 py-2 font-semibold text-amber-900">שטח (מ&quot;ר)</th>
                      <th className="px-3 py-2 font-semibold text-amber-900 min-w-[200px]">תאריכי ריקות</th>
                      <th className="px-3 py-2 font-semibold text-amber-900">סה&quot;כ ימים</th>
                      <th className="px-3 py-2 font-semibold text-amber-900">חלק יחסי</th>
                      <th className="px-3 py-2 font-semibold text-amber-900 min-w-[260px]">מי משלם?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spaceVacancies.map(function(v) {
                      var pctOfProperty = computedTotalSqmDays > 0
                        ? (v.vacantSqmDays / computedTotalSqmDays) * 100
                        : 0;
                      var disp = spaceDispositions[v.id] || "owner";
                      var isRedist = disp === "redistribute";
                      var isAssigned = disp !== "owner" && disp !== "redistribute";
                      var reasonLabel = v.vacancyReason === "always_vacant" ? "ריק כל השנה"
                        : v.vacancyReason === "tail" ? ("הסכם הסתיים " + (v.lastEndDate ? new Date(v.lastEndDate).toLocaleDateString("he-IL") : ""))
                        : v.vacancyReason === "head" ? "ריק בתחילת התקופה"
                        : "פער בין שוכרים";
                      return (
                        <tr key={v.id} className={
                          "border-t border-amber-100 " +
                          (isRedist ? "bg-blue-50" : isAssigned ? "bg-green-50" : "hover:bg-amber-50/30")
                        }>
                          <td className="px-3 py-2 font-semibold text-slate-800">
                            {v.name}
                            {v.isFullyVacant && <div className="text-[10px] text-red-600 font-normal">⚠ ריק כל השנה</div>}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600">
                            {reasonLabel}
                            {v.lastTenantName && v.vacancyReason !== "always_vacant" && (
                              <div className="text-[10px] text-slate-500">שוכר אחרון: {v.lastTenantName}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{v.area.toLocaleString("he-IL")}</td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {v.vacantRanges.map(function(r, idx) {
                              return (
                                <div key={idx} className="whitespace-nowrap">
                                  {r.start} → {r.end} <span className="text-slate-400">({r.days} ימים)</span>
                                </div>
                              );
                            })}
                          </td>
                          <td className="px-3 py-2 text-slate-700 font-semibold">{v.daysVacant}</td>
                          <td className="px-3 py-2 font-bold text-amber-700">{pctOfProperty.toFixed(2)}%</td>
                          <td className="px-3 py-2">
                            <select
                              value={disp}
                              onChange={function(e) {
                                var val = e.target.value;
                                setSpaceDispositions(function(prev) {
                                  return Object.assign({}, prev, { [v.id]: val });
                                });
                              }}
                              className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs bg-white"
                            >
                              <option value="owner">🏢 בעלים נושא</option>
                              <option value="redistribute">🔀 חלוקה לשוכרים פעילים</option>
                              {v.lastContractId && v.lastTenantName && (
                                <option value={v.lastContractId}>
                                  🔄 חיוב {v.lastTenantName} (חידוש צפוי)
                                </option>
                              )}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-amber-50 border-t-2 border-amber-200">
                    <tr>
                      <td className="px-3 py-2 font-bold text-amber-900" colSpan={4}>
                        סה&quot;כ ריקות
                        {(redistributeCount > 0 || renewalCount > 0) && (
                          <span className="font-normal mr-2 text-xs">
                            {redistributeCount > 0 && <span className="text-blue-700">| לחלוקה: {redistributeCount}</span>}
                            {renewalCount > 0 && <span className="text-green-700"> | לחידוש: {renewalCount}</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-bold">
                        {spaceVacancies.reduce(function(s, v) { return s + v.daysVacant; }, 0)} ימים סה&quot;כ
                      </td>
                      <td className="px-3 py-2 font-black text-amber-700">
                        {(spaceVacancies.reduce(function(s, v) { return s + v.vacantSqmDays; }, 0) / Math.max(1, computedTotalSqmDays) * 100).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Explainer */}
            <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 leading-relaxed">
              <div className="font-bold text-slate-700 mb-1">💡 כיצד מחושב חלק כל שוכר</div>
              <div className="space-y-0.5">
                <div>החיוב הוא יחס של <span className="font-semibold">מ&quot;ר × ימים</span> בתוך תקופת הפוליסה — שינוי יחידה באמצע השנה (כמו קבוצת גולף) מחויב יחסית לפי הימים בכל יחידה.</div>
                <div>שוכרים שהיו בנכס רק חלק מהשנה (תקופה חלקית) מחויבים רק עבור הימים שלהם — מסומנים ⏱.</div>
                <div className="pt-1 border-t border-slate-200 mt-1.5">
                  <span className="font-semibold text-slate-700">למה יש &quot;חלק בעלים&quot;?</span>
                  {" "}לרוב מדובר בהסכמים שמסתיימים לפני סוף הפוליסה (זנב), פערים בין שוכרים, או יחידות ריקות לחלוטין.
                  בטבלה למעלה אפשר לבחור עבור כל יחידה לחוד מי משלם — כולל אופציית
                  {" "}<span className="font-semibold text-green-700">חיוב השוכר האחרון</span> כשמצופה חידוש (כך לא משלם הבעלים על תקופה שתחודש בקרוב).
                </div>
                {partialCount > 0 && <div className="text-amber-700">📌 {partialCount} שוכרים בתקופה חלקית. אם הוצא חיוב מלא קודם — מומלץ להוסיף חיוב משלים בסוף השנה לתקופת ההחזקה שלהם.</div>}
                {redistributeCount > 0 && <div className="text-blue-700">🔀 הועברו לחלוקה: {redistributeCount} יחידות. סה&quot;כ שוכרים עכשיו {totPct.toFixed(2)}%.</div>}
                {renewalCount > 0 && <div className="text-green-700">🔄 חידוש צפוי: {renewalCount} יחידות הועברו לשוכרים האחרונים שלהן (הם משלמים על הימים הנותרים).</div>}
                {!overBilled && ownerSelf > 0.5 && <div className="text-amber-700">📌 {ownerSelf.toFixed(1)}% מהנכס נותר על נטל בעלי הנכס.</div>}
              </div>
            </div>

            {progress && <div className="mt-4"><CalcProgress {...progress} /></div>}
            <div className="flex gap-3 mt-4">
              <button onClick={createCharges} disabled={creatingCharges || results.length === 0 || overBilled}
                title={overBilled ? "לא ניתן ליצור חיובים כאשר סך החלקים עולה על 100% — תקן את הכפילות בנתוני החוזים" : (existingCharges.length > 0 ? "מעדכן את החיובים הקיימים לפי החישוב הנוכחי (מסמן כמתוקנים) ומוסיף לשוכרים חדשים" : "מוסיף שורת חיוב ביטוח לטבלת charges לכל שוכר")}
                className={"rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 " + (existingCharges.length > 0 ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-700 hover:bg-blue-800")}>
                {creatingCharges ? "שומר..." : existingCharges.length > 0 ? ("🔧 תקן חיובים (" + existingCharges.length + ")") : "צור חיובים"}
              </button>
              <button onClick={createLetters} disabled={creatingLetters || results.length === 0 || overBilled}
                title={overBilled ? "לא ניתן ליצור מכתבים כאשר סך החלקים עולה על 100%" : (existingLetters.length > 0 ? "מעדכן את המכתבים הקיימים ומסמן אותם כ'מכתב מתוקן'" : "יוצר טיוטות מכתבי חיוב ביטוח לשוכרים")}
                className={"rounded-lg border px-5 py-2.5 text-sm font-bold disabled:opacity-50 " + (existingLetters.length > 0 ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100")}>
                {creatingLetters ? "שומר..." : existingLetters.length > 0 ? ("🔧 תקן מכתבים (" + existingLetters.length + ")") : "צור מכתבים"}
              </button>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 3 — Waste
   ═══════════════════════════════════════════════════════════ */
function WasteTab({ properties }: { properties: any[] }) {
  const currentYear = new Date().getFullYear();
  const [propId, setPropId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [period, setPeriod] = useState<"annual" | "Q1" | "Q2" | "Q3" | "Q4">("annual");
  const [wasteCost, setWasteCost] = useState("");
  const [spaces, setSpaces] = useState<any[]>([]);
  const [results, setResults] = useState<WasteResult[]>([]);
  const [computing, setComputing] = useState(false);
  const [creatingCharges, setCreatingCharges] = useState(false);
  const [creatingLetters, setCreatingLetters] = useState(false);
  const [progress, setProgress] = useState<CalcProgressState | null>(null);
  const [existingWasteCharges, setExistingWasteCharges] = useState<any[]>([]);
  const [existingWasteLetters, setExistingWasteLetters] = useState<any[]>([]);

  const [wasteGroups, setWasteGroups] = useState<any[]>([]);

  useEffect(function () {
    if (!propId) { setSpaces([]); setResults([]); setWasteGroups([]); setExistingWasteCharges([]); setExistingWasteLetters([]); return; }
    loadSpaces();
    loadWasteGroups();
    loadWasteCost();
    loadExistingWaste();
  }, [propId, year, period]);

  function periodLabelOf(): string { return period === "annual" ? "שנת " + year : period + " " + year; }

  async function loadWasteCost() {
    if (!propId) return;
    const { data } = await supabase.from("waste_billing_inputs")
      .select("cost").eq("property_id", propId).eq("year", year).eq("period", period).limit(1);
    var row = data && data[0];
    setWasteCost(row && row.cost != null ? String(row.cost) : "");
  }
  async function saveWasteCost() {
    if (!propId) return;
    try {
      await supabase.from("waste_billing_inputs").upsert({
        property_id: propId, year: year, period: period,
        cost: wasteCost ? Number(wasteCost) : null, updated_at: new Date().toISOString(),
      }, { onConflict: "property_id,year,period" });
    } catch (e) { /* non-fatal */ }
  }
  async function loadExistingWaste() {
    if (!propId) { setExistingWasteCharges([]); setExistingWasteLetters([]); return; }
    var dates = getPeriodDates();
    var lbl = periodLabelOf();
    const [{ data: ch }, { data: lt }] = await Promise.all([
      supabase.from("charges")
        .select("id, total_amount, status, contract_id, notes, contracts(property_id, tenants(name))")
        .eq("charge_type", "waste").eq("billing_period_start", dates.start),
      supabase.from("letters")
        .select("id, title, subject, contract_id, contracts(property_id)")
        .eq("letter_type", "notice")
        .or("subject.ilike.%פינוי אשפה — " + lbl + "%,title.ilike.%פינוי אשפה — " + lbl + "%"),
    ]);
    setExistingWasteCharges((ch ?? []).filter(function(x:any){ return x.contracts?.property_id === propId; }));
    setExistingWasteLetters((lt ?? []).filter(function(x:any){ return x.contracts?.property_id === propId; }));
  }

  async function loadSpaces() {
    const { data } = await supabase
      .from("spaces")
      .select("id, space_name, space_type, area, uses_waste_service")
      .eq("property_id", propId)
      .order("space_name");
    setSpaces(data ?? []);
    setResults([]);
  }

  async function loadWasteGroups() {
    const { data } = await supabase.from("billing_groups")
      .select("*,billing_group_spaces(space_id)")
      .eq("property_id", propId)
      .eq("group_type", "waste")
      .eq("year", year);
    setWasteGroups(data ?? []);
  }

  // Legacy: spaces filtered by uses_waste_service flag (fallback when no groups defined)
  const participatingSpaces = spaces.filter(function (s) { return s.uses_waste_service !== false; });
  const nonParticipating = spaces.filter(function (s) { return s.uses_waste_service === false; });
  const totalWasteArea = participatingSpaces.reduce(function (s, sp) { return s + (sp.area ?? 0); }, 0);
  const hasGroups = wasteGroups.length > 0;

  function getPeriodDates(): { start: string; end: string } {
    if (period === "Q1") return { start: year + "-01-01", end: year + "-03-31" };
    if (period === "Q2") return { start: year + "-04-01", end: year + "-06-30" };
    if (period === "Q3") return { start: year + "-07-01", end: year + "-09-30" };
    if (period === "Q4") return { start: year + "-10-01", end: year + "-12-31" };
    return { start: year + "-01-01", end: year + "-12-31" };
  }

  async function compute() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    if (!hasGroups && !wasteCost) { alert("יש להגדיר קבוצות אשפה או להזין עלות שנתית"); return; }
    setComputing(true);
    setProgress({ current: 0, total: 0, label: "מחשב חלוקת פינוי אשפה...", startedAt: Date.now() });
    try {
      // Period factor: fraction of annual
      const periodFactor = period === "annual" ? 1 : 0.25;

      // Load BASE contracts (no amendments). Amendments are separate snapshot
      // rows that repeat the unit set — counting them would double/triple the
      // same tenant (e.g. Yehonatan's offices contract appearing 3× → 163%).
      const { data: baseContracts } = await supabase
        .from("contracts")
        .select("id, charged_area, start_date, end_date, tenants(name), contract_spaces(space_id, spaces(id, space_name, area, uses_waste_service))")
        .eq("property_id", propId)
        .eq("is_amendment", false)
        .in("status", ["active", "expiring", "extended"]);
      const baseList = baseContracts ?? [];
      const baseIds = baseList.map(function(c:any){ return c.id; });

      // For each base, use the LATEST amendment's spaces when amendments exist
      // (so unit swaps like Golf's are reflected), else the base's own spaces.
      const amendsByParent: Record<string, any[]> = {};
      if (baseIds.length > 0) {
        const { data: amends } = await supabase
          .from("contracts")
          .select("id, parent_contract_id, amendment_number, amendment_date, start_date, contract_spaces(space_id, spaces(id, space_name, area, uses_waste_service))")
          .in("parent_contract_id", baseIds)
          .eq("is_amendment", true);
        (amends ?? []).forEach(function(a:any){
          if (!amendsByParent[a.parent_contract_id]) amendsByParent[a.parent_contract_id] = [];
          amendsByParent[a.parent_contract_id].push(a);
        });
      }
      // ── Time-proportional model with a snapshot timeline ──────────────
      // Amendments are sequential snapshots of the unit set, each effective
      // from its amendment_date until the next one. For the SELECTED period
      // we use the snapshot(s) effective DURING that period — so Golf in 2025
      // is charged for חנות 6 (held that year), not the units they swapped to
      // in 2026. Each contract pays by area × days-held; the denominator is
      // only the HELD sqm-days, so vacant time is redistributed among active
      // units and Σ charges always equals the actual cost (no gap).
      const dates = getPeriodDates();
      const pStart = new Date(dates.start).getTime();
      const pEndExcl = new Date(dates.end).getTime() + 86400000; // exclusive end
      const periodDays = Math.max(1, Math.round((pEndExcl - pStart) / 86400000));
      const overlapDays = function(aStartT: number, aEndExclT: number): number {
        const s = Math.max(aStartT, pStart);
        const e = Math.min(aEndExclT, pEndExcl);
        return Math.max(0, Math.round((e - s) / 86400000));
      };

      // For each base contract, accumulate days-held per space within the
      // period using its snapshot timeline (base + amendments).
      type Held = { area: number; days: number; name: string };
      const contracts: any[] = baseList.map(function(b:any){
        const ams = (amendsByParent[b.id] || []).slice().sort(function(x:any,y:any){
          var dx = x.amendment_date ? new Date(x.amendment_date).getTime() : (x.start_date ? new Date(x.start_date).getTime() : 0);
          var dy = y.amendment_date ? new Date(y.amendment_date).getTime() : (y.start_date ? new Date(y.start_date).getTime() : 0);
          return dx - dy;
        });
        const baseStartT = b.start_date ? new Date(b.start_date).getTime() : pStart;
        const contractEndExclT = b.end_date ? new Date(b.end_date).getTime() + 86400000 : pEndExcl;
        // Snapshot points: base first, then each amendment by its date.
        const points: Array<{ t: number; spaces: any[] }> = [{ t: baseStartT, spaces: b.contract_spaces || [] }];
        ams.forEach(function(a:any){
          var t = a.amendment_date ? new Date(a.amendment_date).getTime() : (a.start_date ? new Date(a.start_date).getTime() : baseStartT);
          points.push({ t: t, spaces: (a.contract_spaces && a.contract_spaces.length > 0) ? a.contract_spaces : [] });
        });
        // Each snapshot is effective [t_i, t_{i+1}); empty spaces inherit prior.
        const held: Record<string, Held> = {};
        for (let i = 0; i < points.length; i++) {
          const segStart = points[i].t;
          const segEnd = i < points.length - 1 ? points[i + 1].t : contractEndExclT;
          const d = overlapDays(segStart, segEnd);
          if (d <= 0) continue;
          let segSpaces = points[i].spaces;
          if ((!segSpaces || segSpaces.length === 0) && i > 0) segSpaces = points[i - 1].spaces;
          (segSpaces || []).forEach(function(x:any){
            if (!x.spaces) return;
            const sid = x.space_id;
            if (!held[sid]) held[sid] = { area: Number(x.spaces?.area) || 0, days: 0, name: x.spaces?.space_name || "" };
            held[sid].days += d;
          });
        }
        return { id: b.id, charged_area: b.charged_area, tenants: b.tenants, held: held };
      });

      const res: WasteResult[] = [];

      if (hasGroups) {
        type SpaceGroupInfo = { groupId: string; groupName: string; annualAmount: number; };
        const spaceGroupMap = new Map<string, SpaceGroupInfo>();
        const groupCost: Record<string, number> = {};
        for (const g of wasteGroups) {
          const groupSpaceIds = (g.billing_group_spaces || []).map((x: any) => x.space_id);
          const groupTotalArea = groupSpaceIds.reduce((s: number, sid: string) => {
            const sp = spaces.find((x) => x.id === sid);
            return s + (Number(sp?.area) || 0);
          }, 0);
          const annual = Number(g.annual_amount) || (Number(g.rate_per_sqm_monthly) || 0) * groupTotalArea * 12;
          groupCost[g.id] = annual * periodFactor; // full period cost of the group
          for (const sid of groupSpaceIds) spaceGroupMap.set(sid, { groupId: g.id, groupName: g.name, annualAmount: annual });
        }

        // Pass 1: per-contract per-group sqm-days (from the held timeline) +
        // group denominators (held days only).
        const cgSqmDays: Record<string, Record<string, number>> = {};
        const groupDenom: Record<string, number> = {};
        const meta: Record<string, { area: number; maxDays: number; groups: Set<string>; names: string[] }> = {};
        for (const c of contracts) {
          const heldIds = Object.keys(c.held).filter(function(sid:string){ return spaceGroupMap.has(sid) && c.held[sid].days > 0; });
          if (heldIds.length === 0) continue;
          for (const sid of heldIds) {
            const info = spaceGroupMap.get(sid)!;
            const h = c.held[sid];
            const sd = h.area * h.days;
            if (!cgSqmDays[c.id]) cgSqmDays[c.id] = {};
            cgSqmDays[c.id][info.groupId] = (cgSqmDays[c.id][info.groupId] || 0) + sd;
            groupDenom[info.groupId] = (groupDenom[info.groupId] || 0) + sd;
            if (!meta[c.id]) meta[c.id] = { area: 0, maxDays: 0, groups: new Set(), names: [] };
            meta[c.id].area += h.area;
            meta[c.id].maxDays = Math.max(meta[c.id].maxDays, h.days);
            meta[c.id].groups.add(info.groupName);
            if (h.name) meta[c.id].names.push(h.name);
          }
        }
        const totalCost = Object.values(groupCost).reduce((s, v) => s + v, 0);
        // Pass 2: each contract's charge = Σ groupCost × (its sqm-days / group sqm-days held).
        for (const c of contracts) {
          const cgs = cgSqmDays[c.id];
          if (!cgs) continue;
          let charge = 0;
          for (const gid of Object.keys(cgs)) {
            const denom = groupDenom[gid] || 0;
            charge += denom > 0 ? (groupCost[gid] * (cgs[gid] / denom)) : 0;
          }
          const m = meta[c.id];
          const partial = m.maxDays < periodDays;
          res.push({
            contractId: c.id,
            tenantName: (c.tenants as any)?.name ?? "—",
            spaces: m.names.join(", ") + " | " + Array.from(m.groups).join(" + ") + (partial ? " ⏱ " + m.maxDays + "/" + periodDays + " ימים" : ""),
            wasteArea: m.area,
            pct: totalCost > 0 ? (charge / totalCost) * 100 : 0,
            charge,
          });
        }
      } else {
        // LEGACY: single waste cost + uses_waste_service flag — sqm-days split.
        const cost = Number(wasteCost) * periodFactor;
        const participatingIds = new Set(participatingSpaces.map(function (s) { return s.id; }));
        const rows: Array<{ c: any; area: number; maxDays: number; names: string; sqmDays: number }> = [];
        let denom = 0;
        for (const c of contracts) {
          const heldIds = Object.keys(c.held).filter(function(sid:string){ return participatingIds.has(sid) && c.held[sid].days > 0; });
          if (heldIds.length === 0) continue;
          let area = 0, sqmDays = 0, maxDays = 0; const names: string[] = [];
          for (const sid of heldIds) {
            const h = c.held[sid];
            area += h.area;
            sqmDays += h.area * h.days;
            maxDays = Math.max(maxDays, h.days);
            if (h.name) names.push(h.name);
          }
          denom += sqmDays;
          rows.push({ c, area, maxDays, names: names.join(", "), sqmDays });
        }
        for (const r of rows) {
          const partial = r.maxDays < periodDays;
          const charge = denom > 0 ? cost * (r.sqmDays / denom) : 0;
          res.push({
            contractId: r.c.id,
            tenantName: (r.c.tenants as any)?.name ?? "—",
            spaces: r.names + (partial ? " ⏱ " + r.maxDays + "/" + periodDays + " ימים" : ""),
            wasteArea: r.area,
            pct: cost > 0 ? (charge / cost) * 100 : 0,
            charge,
          });
        }
      }
      setResults(res);
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setComputing(false); setProgress(null); }
  }

  // Create OR fix waste charges (update existing for the same contract+period,
  // insert for new tenants).
  async function createCharges() {
    if (results.length === 0) return;
    var billable = results.filter(function(r){ return r.charge >= 0.01; });
    var byContract: Record<string, any> = {};
    existingWasteCharges.forEach(function(c:any){ byContract[c.contract_id] = c; });
    var willFix = billable.filter(function(r){ return byContract[r.contractId]; }).length;
    if (willFix > 0) {
      if (!confirm("נמצאו " + willFix + " חיובי פינוי אשפה קיימים ל" + periodLabelOf() + ".\nלתקן אותם לפי החישוב הנוכחי? (יסומנו כמתוקנים; לשוכרים ללא חיוב ייווצר חדש)")) return;
    }
    setCreatingCharges(true);
    setProgress({ current: 0, total: results.length, label: willFix ? "מתקן חיובי פינוי אשפה..." : "יוצר חיובי פינוי אשפה...", startedAt: Date.now() });
    try {
      const dates = getPeriodDates();
      let updated = 0, created = 0;
      var graceDays = await getGraceDaysForProperty(propId);
      var dueDateStr = dueDateFromGrace(graceDays);
      var today = new Date().toLocaleDateString("he-IL");
      var wIdx = 0;
      for (const r of results) {
        wIdx++;
        setProgress({ current: wIdx, total: results.length, label: (willFix ? "מתקן: " : "מעבד: ") + (r.spaces || r.contractId), startedAt: Date.now() });
        if (r.charge < 0.01) continue;
        const baseNotes = "חיוב פינוי אשפה " + (period === "annual" ? year : period + " " + year);
        const ex = byContract[r.contractId];
        if (ex) {
          await supabase.from("charges").update({
            base_amount: r.charge, vat_amount: 0, total_amount: r.charge,
            notes: baseNotes + " [מתוקן " + today + "]",
          }).eq("id", ex.id);
          await logAudit({ entity_type: "charge", entity_id: ex.id, action: "fix_waste_charge", notes: "סכום מעודכן " + r.charge });
          updated++;
        } else {
          await supabase.from("charges").insert({
            contract_id: r.contractId, charge_type: "waste",
            base_amount: r.charge, vat_amount: 0, total_amount: r.charge,
            vat_type: "exempt", billing_period_start: dates.start,
            billing_period_end: dates.end, due_date: dueDateStr,
            status: "pending", notes: baseNotes,
          });
          created++;
        }
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: willFix ? "fix_waste_charges" : "create_waste_charges", notes: "עודכנו " + updated + ", נוצרו " + created });
      await saveWasteCost();
      await loadExistingWaste();
      alert(willFix ? ("✅ תוקנו " + updated + " חיובים" + (created ? ", נוצרו " + created + " חדשים" : "")) : ("✅ נוצרו " + created + " חיובים"));
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setCreatingCharges(false); setProgress(null); }
  }

  async function createLetters() {
    if (results.length === 0) return;
    const periodLabel = periodLabelOf();
    var billableL = results.filter(function(r){ return r.charge >= 0.01; });
    var byContractL: Record<string, any> = {};
    existingWasteLetters.forEach(function(l:any){ byContractL[l.contract_id] = l; });
    var willFix = billableL.filter(function(r){ return byContractL[r.contractId]; }).length;
    if (willFix > 0) {
      if (!confirm("נמצאו " + willFix + " מכתבי פינוי אשפה קיימים ל" + periodLabel + ".\nלתקן אותם? יסומנו כ\"מכתב מתוקן\".")) return;
    }
    setCreatingLetters(true);
    setProgress({ current: 0, total: results.length, label: willFix ? "מתקן מכתבי פינוי אשפה..." : "יוצר מכתבי פינוי אשפה...", startedAt: Date.now() });
    try {
      let updated = 0, created = 0;
      var today = new Date().toLocaleDateString("he-IL");
      var wlIdx = 0;
      for (const r of results) {
        wlIdx++;
        setProgress({ current: wlIdx, total: results.length, label: (willFix ? "מתקן מכתב: " : "מכתב: ") + (r.spaces || r.contractId), startedAt: Date.now() });
        if (r.charge < 0.01) continue;
        const body = "שוכר/ת נכבד/ה,\n\nלהלן חיוב פינוי אשפה לתקופה " + periodLabel + ":\n" +
          "יחידות: " + r.spaces + "\n" +
          'שטח: ' + r.wasteArea.toLocaleString("he-IL") + ' מ"ר\n' +
          "אחוז: " + r.pct.toFixed(1) + "%\n" +
          "חיוב: " + fmtMoney(r.charge) + "\n\nבברכה,\nהנהלת הנכס";
        const exL = byContractL[r.contractId];
        if (exL) {
          const fixedTitle = "מכתב מתוקן — חיוב פינוי אשפה — " + periodLabel;
          await supabase.from("letters").update({
            title: fixedTitle, subject: fixedTitle,
            content_json: { body: body + "\n\n[מכתב מתוקן בתאריך " + today + "]", corrected: true, correctedAt: today },
            body: body, status: "draft",
          }).eq("id", exL.id);
          await logAudit({ entity_type: "letter", entity_id: exL.id, action: "fix_waste_letter" });
          updated++;
        } else {
          const origTitle = "חיוב פינוי אשפה — " + periodLabel;
          await supabase.from("letters").insert({
            contract_id: r.contractId, letter_type: "notice",
            title: origTitle, subject: origTitle,
            content_json: { body: body }, body: body, status: "draft",
          });
          created++;
        }
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: willFix ? "fix_waste_letters" : "create_waste_letters", notes: "עודכנו " + updated + ", נוצרו " + created });
      await loadExistingWaste();
      alert(willFix ? ("✅ תוקנו " + updated + " מכתבים" + (created ? ", נוצרו " + created + " חדשים" : "") + " — סומנו כ\"מכתב מתוקן\"") : ("✅ נוצרו " + created + " מכתבים"));
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setCreatingLetters(false); setProgress(null); }
  }

  const PERIODS: { v: typeof period; l: string }[] = [
    { v: "annual", l: "שנתי" },
    { v: "Q1", l: "Q1" },
    { v: "Q2", l: "Q2" },
    { v: "Q3", l: "Q3" },
    { v: "Q4", l: "Q4" },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">{"פינוי אשפה"}</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"נכס"}</label>
            <select value={propId} onChange={function (e) { setPropId(e.target.value); }} className={ic}>
              <option value="">{"— בחר נכס —"}</option>
              {properties.map(function (p) {
                return <option key={p.id} value={p.id}>{p.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"שנה"}</label>
            <input type="number" value={year} onChange={function (e) { setYear(Number(e.target.value)); }} className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"תקופה"}</label>
            <div className="flex gap-1">
              {PERIODS.map(function (p) {
                return (
                  <button key={p.v} onClick={function () { setPeriod(p.v); }}
                    className={"rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all " +
                      (period === p.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                    {p.l}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Billing Groups for Waste */}
        {propId && (
          <div className="rounded-lg border border-orange-200 bg-orange-50/20 p-4 mb-4">
            <BillingGroupsManager propertyId={propId} year={year} groupType="waste" onChange={function(){loadWasteGroups();}} />
          </div>
        )}

        {/* Legacy single-cost input (used when no groups defined) */}
        {!hasGroups && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-semibold text-slate-700">עלות פינוי אשפה שנתית (₪) — <span className="text-slate-500 font-normal">ברירת מחדל כשלא הוגדרו קבוצות</span></label>
            <input type="number" value={wasteCost} onChange={function (e) { setWasteCost(e.target.value); }} className={ic + " max-w-xs"} placeholder="0" />
          </div>
        )}

        {propId && spaces.length > 0 && !hasGroups && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="rounded-lg bg-green-50 border border-green-200 p-3">
              <div className="text-xs font-bold text-green-800 mb-1">{"משתתפות בשירות"} ({participatingSpaces.length})</div>
              <div className="text-xs text-green-700 space-y-0.5">
                {participatingSpaces.map(function (s) {
                  return <div key={s.id}>{s.space_name} — {s.area ?? 0} {'מ"ר'}</div>;
                })}
              </div>
              <div className="text-xs font-bold text-green-900 mt-1 pt-1 border-t border-green-200">
                {'סה"כ: '}{totalWasteArea.toLocaleString("he-IL")} {'מ"ר'}
              </div>
            </div>
            {nonParticipating.length > 0 && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-xs font-bold text-slate-600 mb-1">{"לא משתתפות"} ({nonParticipating.length})</div>
                <div className="text-xs text-slate-500 space-y-0.5">
                  {nonParticipating.map(function (s) {
                    return <div key={s.id}>{s.space_name} — {s.area ?? 0} {'מ"ר'}</div>;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {existingWasteCharges.length > 0 && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 my-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-bold text-blue-800">✓ כבר נוצרו {existingWasteCharges.length} חיובי פינוי אשפה ל{periodLabelOf()} לנכס זה</div>
              <button onClick={compute} disabled={computing || !propId || (!hasGroups && !wasteCost)} className="text-xs rounded border border-blue-300 bg-white text-blue-700 hover:bg-blue-100 px-2 py-1 font-semibold disabled:opacity-50" title="הצג את החישוב המפורט כאן">📊 הצג חישוב מפורט</button>
            </div>
            <div className="text-[11px] text-blue-600 mt-0.5">אין צורך ליצור שוב (יצירה חוזרת תיצור כפילות). למחיקה/עריכה — מסך חיובים.</div>
            <div className="mt-2 rounded-lg bg-white border border-blue-100 divide-y divide-blue-50">
              {existingWasteCharges.map(function(ch:any){
                return (
                  <div key={ch.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="font-medium text-slate-700">{ch.contracts?.tenants?.name || "—"}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{fmtMoney(ch.total_amount)}</span>
                      <span className={"rounded-full px-1.5 py-0.5 text-[10px] font-semibold " + (ch.status==="paid"?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700")}>{ch.status==="paid"?"שולם":"ממתין"}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {progress && <div className="my-3"><CalcProgress {...progress} /></div>}

        <button onClick={compute} disabled={computing || !propId || (!hasGroups && !wasteCost)}
          className="rounded-lg bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50">
          {computing ? "מחשב..." : "חשב"}
        </button>

        {results.length > 0 && (
          <div className="mt-5">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"שוכר"}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"יחידות משתתפות"}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{'שטח (מ"ר)'}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">%</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"חיוב"}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(function (r) {
                    return (
                      <tr key={r.contractId} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-800">{r.tenantName}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{r.spaces}</td>
                        <td className="px-4 py-3 text-slate-600">{r.wasteArea.toLocaleString("he-IL")}</td>
                        <td className="px-4 py-3 text-slate-600">{r.pct.toFixed(1)}%</td>
                        <td className="px-4 py-3 font-bold text-blue-700">{fmtMoney(r.charge)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-700">{'סה"כ'}</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 font-bold">{results.reduce(function (s, r) { return s + r.wasteArea; }, 0).toLocaleString("he-IL")}</td>
                    <td className="px-4 py-2.5 font-bold">{results.reduce(function (s, r) { return s + r.pct; }, 0).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 font-black text-blue-700">{fmtMoney(results.reduce(function (s, r) { return s + r.charge; }, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {progress && <div className="mt-4"><CalcProgress {...progress} /></div>}
            <div className="flex gap-3 mt-4">
              <button onClick={createCharges} disabled={creatingCharges}
                title={existingWasteCharges.length > 0 ? "מעדכן את החיובים הקיימים לפי החישוב הנוכחי (מסמן כמתוקנים)" : "מוסיף שורת חיוב פינוי אשפה לכל שוכר"}
                className={"rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 " + (existingWasteCharges.length > 0 ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-700 hover:bg-blue-800")}>
                {creatingCharges ? "שומר..." : existingWasteCharges.length > 0 ? ("🔧 תקן חיובים (" + existingWasteCharges.length + ")") : "צור חיובים"}
              </button>
              <button onClick={createLetters} disabled={creatingLetters}
                title={existingWasteLetters.length > 0 ? "מעדכן את המכתבים הקיימים ומסמן אותם כ'מכתב מתוקן'" : "יוצר טיוטות מכתבי פינוי אשפה"}
                className={"rounded-lg border px-5 py-2.5 text-sm font-bold disabled:opacity-50 " + (existingWasteLetters.length > 0 ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100")}>
                {creatingLetters ? "שומר..." : existingWasteLetters.length > 0 ? ("🔧 תקן מכתבים (" + existingWasteLetters.length + ")") : "צור מכתבים"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
