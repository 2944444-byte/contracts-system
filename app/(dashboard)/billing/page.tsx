"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit-log";
import PropertyHierarchyFilter from '@/components/PropertyHierarchyFilter';
import BillingGroupsManager from '@/components/BillingGroupsManager';
import { fetchCpiAdjusted } from '@/lib/cpi-server';
import AdvancesTab from '@/components/AdvancesTab';
import CpiDiffTab from '@/components/CpiDiffTab';
import SavedAdvancesTab from '@/components/SavedAdvancesTab';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtMoney(n: number) { return "\u20AA" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "\u2014"; }

type Tab = "management" | "insurance" | "waste" | "advances" | "saved_advances" | "cpi_diff";

interface MgmtResult { contractId: string; tenantName: string; chargedArea: number; advance: number; actualShare: number; difference: number; }
interface InsResult { contractId: string; tenantName: string; area: number; pct: number; charge: number; }
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
        <h1 className="text-3xl font-bold text-slate-800">{"\u05D7\u05D9\u05D5\u05D1\u05D9\u05DD \u05EA\u05E4\u05E2\u05D5\u05DC\u05D9\u05D9\u05DD"}</h1>
        <p className="text-sm text-slate-500 mt-1">{"\u05D3\u05DE\u05D9 \u05E0\u05D9\u05D4\u05D5\u05DC, \u05D1\u05D9\u05D8\u05D5\u05D7 \u05DE\u05D1\u05E0\u05D4 \u05D5\u05E4\u05D9\u05E0\u05D5\u05D9 \u05D0\u05E9\u05E4\u05D4"}</p>
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
        <div className="text-center py-12 text-slate-400">{"\u05D8\u05D5\u05E2\u05DF..."}</div>
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

  const selProp = allProperties.find(function (p) { return p.id === propId; });
  const totalArea = selProp?.total_area ?? 0;

  // load spaces when property changes to detect mixed use
  useEffect(function () {
    if (!propId) { setIsMixed(false); setMixedRows([]); setMgmtGroupsData([]); return; }
    loadSpaces();
    loadMgmtGroups();
  }, [propId, year]);

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
    if (prop?.property_type === "\u05DE\u05E2\u05D5\u05E8\u05D1") {
      setIsMixed(true);
      const byType: Record<string, number> = {};
      for (const s of spaces ?? []) {
        const t = s.space_type || "\u05D0\u05D7\u05E8";
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
    if (!propId) { alert("\u05D9\u05E9 \u05DC\u05D1\u05D7\u05D5\u05E8 \u05E0\u05DB\u05E1"); return; }
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
      setMsg("\u2705 \u05EA\u05E7\u05E6\u05D9\u05D1 \u05E0\u05E9\u05DE\u05E8 \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4");
      setTimeout(function () { setMsg(""); }, 3000);
    } catch (e: any) { alert("\u05E9\u05D2\u05D9\u05D0\u05D4: " + e?.message); }
    finally { setSaving(false); }
  }

  async function computeReconciliation() {
    if (!propId) { alert("יש לבחור נכס"); return; }
    const hasGroups = mgmtGroupsData.length > 0;
    if (!hasGroups && !actualCost) { alert("יש להזין עלות בפועל"); return; }
    setComputing(true);
    try {
      // Load active contracts with their spaces
      const { data: contracts } = await supabase
        .from("contracts")
        .select("id, charged_area, rent_per_sqm, tenants(name), contract_spaces(space_id, spaces(id, area))")
        .eq("property_id", propId)
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

        for (const cs of (c.contract_spaces ?? [])) {
          const spArea = Number(cs.spaces?.area) || 0;
          contractArea += spArea;
          const info = spaceGroupMap.get(cs.space_id);
          if (info) {
            // This space is in a group — use group rate for advance, group actual for share
            advance += info.rate * spArea * 12;
            actualShare += info.groupTotalArea > 0 ? info.groupActualCost * (spArea / info.groupTotalArea) : 0;
          } else {
            // Default/unassigned: use property default rate + default actual
            advance += defaultRate * spArea * 12;
            actualShare += defaultSpaceArea > 0 ? defaultActual * (spArea / defaultSpaceArea) : 0;
          }
        }

        if (contractArea === 0) contractArea = c.charged_area ?? 0;

        return {
          contractId: c.id,
          tenantName: c.tenants?.name ?? "—",
          chargedArea: contractArea,
          advance,
          actualShare,
          difference: actualShare - advance,
        };
      });
      setMgmtResults(results);
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setComputing(false); }
  }

  async function createCharges() {
    if (mgmtResults.length === 0) return;
    setCreatingCharges(true);
    try {
      let count = 0;
      for (const r of mgmtResults) {
        if (Math.abs(r.difference) < 0.01) continue;
        const base = Math.abs(r.difference);
        await supabase.from("charges").insert({
          contract_id: r.contractId,
          charge_type: "management",
          base_amount: r.difference > 0 ? base : -base,
          vat_amount: 0,
          total_amount: r.difference > 0 ? base : -base,
          vat_type: "exempt",
          billing_period_start: year + "-01-01",
          billing_period_end: year + "-12-31",
          due_date: new Date().toISOString().slice(0, 10),
          status: "pending",
          notes: "\u05D4\u05EA\u05D7\u05E9\u05D1\u05E0\u05D5\u05EA \u05D3\u05DE\u05D9 \u05E0\u05D9\u05D4\u05D5\u05DC " + year,
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_mgmt_charges", notes: count + " \u05D7\u05D9\u05D5\u05D1\u05D9\u05DD" });
      alert("\u2705 \u05E0\u05D5\u05E6\u05E8\u05D5 " + count + " \u05D7\u05D9\u05D5\u05D1\u05D9\u05DD");
    } catch (e: any) { alert("\u05E9\u05D2\u05D9\u05D0\u05D4: " + e?.message); }
    finally { setCreatingCharges(false); }
  }

  async function createLetters() {
    if (mgmtResults.length === 0) return;
    setCreatingLetters(true);
    try {
      let count = 0;
      for (const r of mgmtResults) {
        if (Math.abs(r.difference) < 0.01) continue;
        const subject = r.difference > 0
          ? "\u05D4\u05E9\u05DC\u05DE\u05EA \u05D4\u05E4\u05E8\u05E9 \u05D3\u05DE\u05D9 \u05E0\u05D9\u05D4\u05D5\u05DC " + year
          : "\u05D4\u05D7\u05D6\u05E8 \u05D3\u05DE\u05D9 \u05E0\u05D9\u05D4\u05D5\u05DC " + year;
        const body = "\u05E9\u05D5\u05DB\u05E8/\u05EA \u05E0\u05DB\u05D1\u05D3/\u05D4,\n\n\u05DC\u05D0\u05D7\u05E8 \u05D1\u05D9\u05E6\u05D5\u05E2 \u05D4\u05EA\u05D7\u05E9\u05D1\u05E0\u05D5\u05EA \u05D3\u05DE\u05D9 \u05E0\u05D9\u05D4\u05D5\u05DC \u05DC\u05E9\u05E0\u05EA " + year + ":\n" +
          "\u05DE\u05E7\u05D3\u05DE\u05D4: " + fmtMoney(r.advance) + "\n" +
          "\u05D7\u05DC\u05E7 \u05D1\u05E4\u05D5\u05E2\u05DC: " + fmtMoney(r.actualShare) + "\n" +
          "\u05D4\u05E4\u05E8\u05E9: " + fmtMoney(r.difference) + "\n\n\u05D1\u05D1\u05E8\u05DB\u05D4,\n\u05D4\u05E0\u05D4\u05DC\u05EA \u05D4\u05E0\u05DB\u05E1";
        await supabase.from("letters").insert({
          contract_id: r.contractId,
          letter_type: "demand",
          subject,
          body,
          status: "draft",
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_mgmt_letters", notes: count + " \u05DE\u05DB\u05EA\u05D1\u05D9\u05DD" });
      alert("\u2705 \u05E0\u05D5\u05E6\u05E8\u05D5 " + count + " \u05DE\u05DB\u05EA\u05D1\u05D9\u05DD");
    } catch (e: any) { alert("\u05E9\u05D2\u05D9\u05D0\u05D4: " + e?.message); }
    finally { setCreatingLetters(false); }
  }

  return (
    <div className="space-y-6">
      {/* Section A: Budget */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">{"\u05DE\u05E7\u05D3\u05DE\u05D4 \u2014 \u05D4\u05D6\u05E0\u05EA \u05EA\u05E7\u05E6\u05D9\u05D1"}</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"\u05E0\u05DB\u05E1"}</label>
            <select value={propId} onChange={function (e) { setPropId(e.target.value); }} className={ic}>
              <option value="">{"\u2014 \u05D1\u05D7\u05E8 \u05E0\u05DB\u05E1 \u2014"}</option>
              {properties.map(function (p) {
                return <option key={p.id} value={p.id}>{p.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"\u05E9\u05E0\u05D4"}</label>
            <input type="number" value={year} onChange={function (e) { setYear(Number(e.target.value)); }} className={ic} />
          </div>
        </div>

        {propId && totalArea > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-2 mb-4 text-sm text-slate-600">
            {"\u05E9\u05D8\u05D7 \u05DB\u05D5\u05DC\u05DC \u05E0\u05DB\u05E1: "}<span className="font-bold">{totalArea.toLocaleString("he-IL")} {'\u05DE"\u05E8'}</span>
            {selProp?.property_type === "\u05DE\u05E2\u05D5\u05E8\u05D1" && (
              <span className="mr-3 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">{"\u05E0\u05DB\u05E1 \u05DE\u05E2\u05D5\u05E8\u05D1"}</span>
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
                { v: "fixed" as const, l: "\u05E1\u05DB\u05D5\u05DD \u05E9\u05E0\u05EA\u05D9 \u05E7\u05D1\u05D5\u05E2" },
                { v: "persqm" as const, l: '\u05DC\u05DE"\u05E8 \u05DC\u05D7\u05D5\u05D3\u05E9' },
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
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{"\u05E1\u05DB\u05D5\u05DD \u05E9\u05E0\u05EA\u05D9 (\u20AA)"}</label>
                  <input type="number" value={fixedTotal} onChange={function (e) { setFixedTotal(e.target.value); }} className={ic} placeholder="0" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{'\u05EA\u05E2\u05E8\u05D9\u05E3 \u05DC\u05DE"\u05E8 \u05DC\u05D7\u05D5\u05D3\u05E9 (\u05DE\u05D7\u05D5\u05E9\u05D1)'}</label>
                  <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-sm text-slate-700 font-mono">
                    {computedRate > 0 ? fmtMoney(computedRate) : "\u2014"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{'\u05EA\u05E2\u05E8\u05D9\u05E3 \u05DC\u05DE"\u05E8 \u05DC\u05D7\u05D5\u05D3\u05E9 (\u20AA)'}</label>
                  <input type="number" value={perSqmRate} onChange={function (e) { setPerSqmRate(e.target.value); }} className={ic} placeholder="0" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{"\u05E1\u05DB\u05D5\u05DD \u05E9\u05E0\u05EA\u05D9 (\u05DE\u05D7\u05D5\u05E9\u05D1)"}</label>
                  <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-sm text-slate-700 font-mono">
                    {computedTotal > 0 ? fmtMoney(computedTotal) : "\u2014"}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {propId && isMixed && mixedRows.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-purple-700">{"\u05EA\u05E2\u05E8\u05D9\u05E3 \u05DC\u05E4\u05D9 \u05E1\u05D5\u05D2 \u05E9\u05D9\u05DE\u05D5\u05E9"}</h3>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold text-slate-700">{"\u05E1\u05D5\u05D2 \u05E9\u05D9\u05DE\u05D5\u05E9"}</th>
                    <th className="px-4 py-2.5 font-semibold text-slate-700">{'\u05E9\u05D8\u05D7 (\u05DE"\u05E8)'}</th>
                    <th className="px-4 py-2.5 font-semibold text-slate-700">{'\u05EA\u05E2\u05E8\u05D9\u05E3 \u05DC\u05DE"\u05E8/\u05D7\u05D5\u05D3\u05E9'}</th>
                    <th className="px-4 py-2.5 font-semibold text-slate-700">{"\u05E1\u05DB\u05D5\u05DD \u05E9\u05E0\u05EA\u05D9"}</th>
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
                    <td className="px-4 py-2.5 font-bold text-slate-700">{'\u05E1\u05D4"\u05DB'}</td>
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
              {saving ? "\u05E9\u05D5\u05DE\u05E8..." : "\u05E9\u05DE\u05D5\u05E8 \u05EA\u05E7\u05E6\u05D9\u05D1"}
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

        <button onClick={computeReconciliation} disabled={computing || !propId}
          className="rounded-lg bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50">
          {computing ? "מחשב..." : "חשב"}
        </button>

        {mgmtResults.length > 0 && (
          <div className="mt-5">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"\u05E9\u05D5\u05DB\u05E8"}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{'\u05E9\u05D8\u05D7 (\u05DE"\u05E8)'}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"\u05DE\u05E7\u05D3\u05DE\u05D4"}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"\u05D7\u05DC\u05E7 \u05D1\u05E4\u05D5\u05E2\u05DC"}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"\u05D4\u05E4\u05E8\u05E9"}</th>
                  </tr>
                </thead>
                <tbody>
                  {mgmtResults.map(function (r) {
                    const color = r.difference > 0.01 ? "text-red-700 bg-red-50" : r.difference < -0.01 ? "text-green-700 bg-green-50" : "text-slate-600";
                    return (
                      <tr key={r.contractId} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-800">{r.tenantName}</td>
                        <td className="px-4 py-3 text-slate-600">{r.chargedArea.toLocaleString("he-IL")}</td>
                        <td className="px-4 py-3">{fmtMoney(r.advance)}</td>
                        <td className="px-4 py-3">{fmtMoney(r.actualShare)}</td>
                        <td className={"px-4 py-3 font-bold rounded " + color}>{fmtMoney(r.difference)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-700">{'\u05E1\u05D4"\u05DB'}</td>
                    <td className="px-4 py-2.5 font-bold">{mgmtResults.reduce(function (s, r) { return s + r.chargedArea; }, 0).toLocaleString("he-IL")}</td>
                    <td className="px-4 py-2.5 font-bold">{fmtMoney(mgmtResults.reduce(function (s, r) { return s + r.advance; }, 0))}</td>
                    <td className="px-4 py-2.5 font-bold">{fmtMoney(mgmtResults.reduce(function (s, r) { return s + r.actualShare; }, 0))}</td>
                    <td className="px-4 py-2.5 font-black">{fmtMoney(mgmtResults.reduce(function (s, r) { return s + r.difference; }, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={createCharges} disabled={creatingCharges}
                className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {creatingCharges ? "\u05D9\u05D5\u05E6\u05E8..." : "\u05E6\u05D5\u05E8 \u05D7\u05D9\u05D5\u05D1\u05D9\u05DD"}
              </button>
              <button onClick={createLetters} disabled={creatingLetters}
                className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                {creatingLetters ? "\u05D9\u05D5\u05E6\u05E8..." : "\u05E6\u05D5\u05E8 \u05DE\u05DB\u05EA\u05D1\u05D9\u05DD"}
              </button>
            </div>
          </div>
        )}
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
  }

  async function compute() {
    if (!propId || !policy) { alert("\u05D9\u05E9 \u05DC\u05D1\u05D7\u05D5\u05E8 \u05E0\u05DB\u05E1 \u05E2\u05DD \u05D1\u05D9\u05D8\u05D5\u05D7 \u05E4\u05E2\u05D9\u05DC"); return; }
    setComputing(true);
    try {
      const premium = policy.annual_premium ?? 0;
      const { data: contracts } = await supabase
        .from("contracts")
        .select("id, charged_area, tenants(name)")
        .eq("property_id", propId)
        .in("status", ["active", "expiring", "extended"]);

      const res: InsResult[] = (contracts ?? []).map(function (c: any) {
        const area = c.charged_area ?? 0;
        const pct = totalArea > 0 ? (area / totalArea) * 100 : 0;
        const charge = totalArea > 0 ? premium * (area / totalArea) : 0;
        return {
          contractId: c.id,
          tenantName: c.tenants?.name ?? "\u2014",
          area,
          pct,
          charge,
        };
      });
      setResults(res);
    } catch (e: any) { alert("\u05E9\u05D2\u05D9\u05D0\u05D4: " + e?.message); }
    finally { setComputing(false); }
  }

  async function createCharges() {
    if (results.length === 0) return;
    setCreatingCharges(true);
    try {
      let count = 0;
      for (const r of results) {
        if (r.charge < 0.01) continue;
        await supabase.from("charges").insert({
          contract_id: r.contractId,
          charge_type: "other",
          base_amount: r.charge,
          vat_amount: 0,
          total_amount: r.charge,
          vat_type: "exempt",
          billing_period_start: year + "-01-01",
          billing_period_end: year + "-12-31",
          due_date: new Date().toISOString().slice(0, 10),
          status: "pending",
          notes: "\u05D7\u05D9\u05D5\u05D1 \u05D1\u05D9\u05D8\u05D5\u05D7 \u05DE\u05D1\u05E0\u05D4 " + year,
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_ins_charges", notes: count + " \u05D7\u05D9\u05D5\u05D1\u05D9\u05DD" });
      alert("\u2705 \u05E0\u05D5\u05E6\u05E8\u05D5 " + count + " \u05D7\u05D9\u05D5\u05D1\u05D9\u05DD");
    } catch (e: any) { alert("\u05E9\u05D2\u05D9\u05D0\u05D4: " + e?.message); }
    finally { setCreatingCharges(false); }
  }

  async function createLetters() {
    if (results.length === 0) return;
    setCreatingLetters(true);
    try {
      let count = 0;
      for (const r of results) {
        if (r.charge < 0.01) continue;
        await supabase.from("letters").insert({
          contract_id: r.contractId,
          letter_type: "notice",
          subject: "\u05D7\u05D9\u05D5\u05D1 \u05D1\u05D9\u05D8\u05D5\u05D7 \u05DE\u05D1\u05E0\u05D4 " + year,
          body: "\u05E9\u05D5\u05DB\u05E8/\u05EA \u05E0\u05DB\u05D1\u05D3/\u05D4,\n\n\u05DC\u05D4\u05DC\u05DF \u05D7\u05D9\u05D5\u05D1 \u05D1\u05D9\u05D8\u05D5\u05D7 \u05DE\u05D1\u05E0\u05D4 \u05DC\u05E9\u05E0\u05EA " + year + ":\n" +
            '\u05E9\u05D8\u05D7: ' + r.area.toLocaleString("he-IL") + ' \u05DE"\u05E8\n' +
            "\u05D0\u05D7\u05D5\u05D6 \u05DE\u05E9\u05D8\u05D7: " + r.pct.toFixed(1) + "%\n" +
            "\u05D7\u05D9\u05D5\u05D1: " + fmtMoney(r.charge) + "\n\n\u05D1\u05D1\u05E8\u05DB\u05D4,\n\u05D4\u05E0\u05D4\u05DC\u05EA \u05D4\u05E0\u05DB\u05E1",
          status: "draft",
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_ins_letters", notes: count + " \u05DE\u05DB\u05EA\u05D1\u05D9\u05DD" });
      alert("\u2705 \u05E0\u05D5\u05E6\u05E8\u05D5 " + count + " \u05DE\u05DB\u05EA\u05D1\u05D9\u05DD");
    } catch (e: any) { alert("\u05E9\u05D2\u05D9\u05D0\u05D4: " + e?.message); }
    finally { setCreatingLetters(false); }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">{"\u05D1\u05D9\u05D8\u05D5\u05D7 \u05DE\u05D1\u05E0\u05D4"}</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"\u05E0\u05DB\u05E1"}</label>
            <select value={propId} onChange={function (e) { setPropId(e.target.value); }} className={ic}>
              <option value="">{"\u2014 \u05D1\u05D7\u05E8 \u05E0\u05DB\u05E1 \u2014"}</option>
              {properties.map(function (p) {
                return <option key={p.id} value={p.id}>{p.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"\u05E9\u05E0\u05D4"}</label>
            <input type="number" value={year} onChange={function (e) { setYear(Number(e.target.value)); }} className={ic} />
          </div>
        </div>

        {policy ? (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 mb-4">
            <div className="text-sm font-bold text-green-800 mb-2">{"\u05E4\u05D5\u05DC\u05D9\u05E1\u05D4 \u05E4\u05E2\u05D9\u05DC\u05D4"}</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between"><span className="text-green-700">{"\u05DE\u05D1\u05D8\u05D7"}</span><span className="font-semibold">{policy.insurer_name ?? "\u2014"}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"\u05DE\u05E1\u05E4\u05E8 \u05E4\u05D5\u05DC\u05D9\u05E1\u05D4"}</span><span className="font-semibold font-mono">{policy.policy_number ?? "\u2014"}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"\u05DB\u05D9\u05E1\u05D5\u05D9"}</span><span className="font-semibold">{fmtMoney(policy.coverage_amount ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"\u05E4\u05E8\u05DE\u05D9\u05D4 \u05E9\u05E0\u05EA\u05D9\u05EA"}</span><span className="font-bold text-green-900">{fmtMoney(policy.annual_premium ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"\u05EA\u05D5\u05E7\u05E3"}</span><span className="font-semibold">{fmtDate(policy.start_date)}</span></div>
              <div className="flex justify-between"><span className="text-green-700">{"\u05E4\u05E7\u05D9\u05E2\u05D4"}</span><span className="font-semibold">{fmtDate(policy.end_date)}</span></div>
            </div>
          </div>
        ) : propId ? (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 mb-4 text-sm text-yellow-800">
            {"\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0 \u05D1\u05D9\u05D8\u05D5\u05D7 \u05DE\u05D1\u05E0\u05D4 \u05E4\u05E2\u05D9\u05DC \u05DC\u05E0\u05DB\u05E1 \u05D6\u05D4"}
          </div>
        ) : null}

        <button onClick={compute} disabled={computing || !propId || !policy}
          className="rounded-lg bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50">
          {computing ? "\u05DE\u05D7\u05E9\u05D1..." : "\u05D7\u05E9\u05D1"}
        </button>

        {results.length > 0 && (
          <div className="mt-5">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"\u05E9\u05D5\u05DB\u05E8"}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{'\u05E9\u05D8\u05D7 (\u05DE"\u05E8)'}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"% \u05E9\u05D8\u05D7"}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"\u05D7\u05D9\u05D5\u05D1"}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(function (r) {
                    return (
                      <tr key={r.contractId} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-800">{r.tenantName}</td>
                        <td className="px-4 py-3 text-slate-600">{r.area.toLocaleString("he-IL")}</td>
                        <td className="px-4 py-3 text-slate-600">{r.pct.toFixed(1)}%</td>
                        <td className="px-4 py-3 font-bold text-blue-700">{fmtMoney(r.charge)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-700">{'\u05E1\u05D4"\u05DB'}</td>
                    <td className="px-4 py-2.5 font-bold">{results.reduce(function (s, r) { return s + r.area; }, 0).toLocaleString("he-IL")}</td>
                    <td className="px-4 py-2.5 font-bold">{results.reduce(function (s, r) { return s + r.pct; }, 0).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 font-black text-blue-700">{fmtMoney(results.reduce(function (s, r) { return s + r.charge; }, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={createCharges} disabled={creatingCharges}
                className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {creatingCharges ? "\u05D9\u05D5\u05E6\u05E8..." : "\u05E6\u05D5\u05E8 \u05D7\u05D9\u05D5\u05D1\u05D9\u05DD"}
              </button>
              <button onClick={createLetters} disabled={creatingLetters}
                className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                {creatingLetters ? "\u05D9\u05D5\u05E6\u05E8..." : "\u05E6\u05D5\u05E8 \u05DE\u05DB\u05EA\u05D1\u05D9\u05DD"}
              </button>
            </div>
          </div>
        )}
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

  const [wasteGroups, setWasteGroups] = useState<any[]>([]);

  useEffect(function () {
    if (!propId) { setSpaces([]); setResults([]); setWasteGroups([]); return; }
    loadSpaces();
    loadWasteGroups();
  }, [propId, year]);

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
    try {
      // Period factor: fraction of annual
      const periodFactor = period === "annual" ? 1 : 0.25;

      // Load contracts with their spaces
      const { data: contracts } = await supabase
        .from("contracts")
        .select("id, charged_area, tenants(name), contract_spaces(space_id, spaces(id, space_name, area, uses_waste_service))")
        .eq("property_id", propId)
        .in("status", ["active", "expiring", "extended"]);

      const res: WasteResult[] = [];

      if (hasGroups) {
        // NEW: use billing groups
        // Build map: space_id → { groupId, groupName, annualAmount, groupTotalArea }
        type SpaceGroupInfo = { groupId: string; groupName: string; annualAmount: number; groupTotalArea: number; };
        const spaceGroupMap = new Map<string, SpaceGroupInfo>();
        for (const g of wasteGroups) {
          const groupSpaceIds = (g.billing_group_spaces || []).map((x: any) => x.space_id);
          const groupTotalArea = groupSpaceIds.reduce((s: number, sid: string) => {
            const sp = spaces.find((x) => x.id === sid);
            return s + (Number(sp?.area) || 0);
          }, 0);
          const annual = Number(g.annual_amount) || (Number(g.rate_per_sqm_monthly) || 0) * groupTotalArea * 12;
          for (const sid of groupSpaceIds) {
            spaceGroupMap.set(sid, { groupId: g.id, groupName: g.name, annualAmount: annual, groupTotalArea });
          }
        }

        for (const c of contracts ?? []) {
          const cs = (c.contract_spaces ?? []).filter((x: any) => x.spaces && spaceGroupMap.has(x.space_id));
          if (cs.length === 0) continue;
          let totalCharge = 0;
          let totalArea = 0;
          const groupNamesSet = new Set<string>();
          const spaceNames: string[] = [];
          for (const x of cs) {
            const info = spaceGroupMap.get(x.space_id)!;
            const spArea = Number(x.spaces?.area) || 0;
            const spShare = info.groupTotalArea > 0 ? (info.annualAmount * (spArea / info.groupTotalArea) * periodFactor) : 0;
            totalCharge += spShare;
            totalArea += spArea;
            groupNamesSet.add(info.groupName);
            if (x.spaces?.space_name) spaceNames.push(x.spaces.space_name);
          }
          const totalGroupArea = Array.from(new Set(cs.map((x: any) => spaceGroupMap.get(x.space_id)!.groupId)))
            .reduce((s, gid) => {
              const g = wasteGroups.find((g) => g.id === gid);
              return s + ((g?.billing_group_spaces || []).reduce((ss: number, bs: any) => {
                const sp = spaces.find((x) => x.id === bs.space_id);
                return ss + (Number(sp?.area) || 0);
              }, 0));
            }, 0);
          const pct = totalGroupArea > 0 ? (totalArea / totalGroupArea) * 100 : 0;
          res.push({
            contractId: c.id,
            tenantName: (c.tenants as any)?.name ?? "—",
            spaces: spaceNames.join(", ") + " | " + Array.from(groupNamesSet).join(" + "),
            wasteArea: totalArea,
            pct,
            charge: totalCharge,
          });
        }
      } else {
        // LEGACY: single waste cost + uses_waste_service flag
        const cost = Number(wasteCost) * periodFactor;
        const participatingIds = new Set(participatingSpaces.map(function (s) { return s.id; }));

        for (const c of contracts ?? []) {
          const contractSpaces = (c.contract_spaces ?? []).filter(function (cs: any) {
            return cs.spaces && participatingIds.has(cs.space_id);
          });
          if (contractSpaces.length === 0) continue;
          const wasteArea = contractSpaces.reduce(function (s: number, cs: any) { return s + (cs.spaces?.area ?? 0); }, 0);
          const spaceNames = contractSpaces.map(function (cs: any) { return cs.spaces?.space_name ?? ""; }).filter(Boolean).join(", ");
          const pct = totalWasteArea > 0 ? (wasteArea / totalWasteArea) * 100 : 0;
          const charge = totalWasteArea > 0 ? cost * (wasteArea / totalWasteArea) : 0;
          res.push({ contractId: c.id, tenantName: (c.tenants as any)?.name ?? "—", spaces: spaceNames, wasteArea, pct, charge });
        }
      }
      setResults(res);
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setComputing(false); }
  }

  async function createCharges() {
    if (results.length === 0) return;
    setCreatingCharges(true);
    try {
      const dates = getPeriodDates();
      let count = 0;
      for (const r of results) {
        if (r.charge < 0.01) continue;
        await supabase.from("charges").insert({
          contract_id: r.contractId,
          charge_type: "other",
          base_amount: r.charge,
          vat_amount: 0,
          total_amount: r.charge,
          vat_type: "exempt",
          billing_period_start: dates.start,
          billing_period_end: dates.end,
          due_date: new Date().toISOString().slice(0, 10),
          status: "pending",
          notes: "\u05D7\u05D9\u05D5\u05D1 \u05E4\u05D9\u05E0\u05D5\u05D9 \u05D0\u05E9\u05E4\u05D4 " + (period === "annual" ? year : period + " " + year),
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_waste_charges", notes: count + " \u05D7\u05D9\u05D5\u05D1\u05D9\u05DD" });
      alert("\u2705 \u05E0\u05D5\u05E6\u05E8\u05D5 " + count + " \u05D7\u05D9\u05D5\u05D1\u05D9\u05DD");
    } catch (e: any) { alert("\u05E9\u05D2\u05D9\u05D0\u05D4: " + e?.message); }
    finally { setCreatingCharges(false); }
  }

  async function createLetters() {
    if (results.length === 0) return;
    setCreatingLetters(true);
    try {
      const periodLabel = period === "annual" ? "\u05E9\u05E0\u05EA " + year : period + " " + year;
      let count = 0;
      for (const r of results) {
        if (r.charge < 0.01) continue;
        await supabase.from("letters").insert({
          contract_id: r.contractId,
          letter_type: "notice",
          subject: "\u05D7\u05D9\u05D5\u05D1 \u05E4\u05D9\u05E0\u05D5\u05D9 \u05D0\u05E9\u05E4\u05D4 \u2014 " + periodLabel,
          body: "\u05E9\u05D5\u05DB\u05E8/\u05EA \u05E0\u05DB\u05D1\u05D3/\u05D4,\n\n\u05DC\u05D4\u05DC\u05DF \u05D7\u05D9\u05D5\u05D1 \u05E4\u05D9\u05E0\u05D5\u05D9 \u05D0\u05E9\u05E4\u05D4 \u05DC\u05EA\u05E7\u05D5\u05E4\u05D4 " + periodLabel + ":\n" +
            "\u05D9\u05D7\u05D9\u05D3\u05D5\u05EA: " + r.spaces + "\n" +
            '\u05E9\u05D8\u05D7: ' + r.wasteArea.toLocaleString("he-IL") + ' \u05DE"\u05E8\n' +
            "\u05D0\u05D7\u05D5\u05D6: " + r.pct.toFixed(1) + "%\n" +
            "\u05D7\u05D9\u05D5\u05D1: " + fmtMoney(r.charge) + "\n\n\u05D1\u05D1\u05E8\u05DB\u05D4,\n\u05D4\u05E0\u05D4\u05DC\u05EA \u05D4\u05E0\u05DB\u05E1",
          status: "draft",
        });
        count++;
      }
      await logAudit({ entity_type: "billing", entity_id: propId, action: "create_waste_letters", notes: count + " \u05DE\u05DB\u05EA\u05D1\u05D9\u05DD" });
      alert("\u2705 \u05E0\u05D5\u05E6\u05E8\u05D5 " + count + " \u05DE\u05DB\u05EA\u05D1\u05D9\u05DD");
    } catch (e: any) { alert("\u05E9\u05D2\u05D9\u05D0\u05D4: " + e?.message); }
    finally { setCreatingLetters(false); }
  }

  const PERIODS: { v: typeof period; l: string }[] = [
    { v: "annual", l: "\u05E9\u05E0\u05EA\u05D9" },
    { v: "Q1", l: "Q1" },
    { v: "Q2", l: "Q2" },
    { v: "Q3", l: "Q3" },
    { v: "Q4", l: "Q4" },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">{"\u05E4\u05D9\u05E0\u05D5\u05D9 \u05D0\u05E9\u05E4\u05D4"}</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"\u05E0\u05DB\u05E1"}</label>
            <select value={propId} onChange={function (e) { setPropId(e.target.value); }} className={ic}>
              <option value="">{"\u2014 \u05D1\u05D7\u05E8 \u05E0\u05DB\u05E1 \u2014"}</option>
              {properties.map(function (p) {
                return <option key={p.id} value={p.id}>{p.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"\u05E9\u05E0\u05D4"}</label>
            <input type="number" value={year} onChange={function (e) { setYear(Number(e.target.value)); }} className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">{"\u05EA\u05E7\u05D5\u05E4\u05D4"}</label>
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
              <div className="text-xs font-bold text-green-800 mb-1">{"\u05DE\u05E9\u05EA\u05EA\u05E4\u05D5\u05EA \u05D1\u05E9\u05D9\u05E8\u05D5\u05EA"} ({participatingSpaces.length})</div>
              <div className="text-xs text-green-700 space-y-0.5">
                {participatingSpaces.map(function (s) {
                  return <div key={s.id}>{s.space_name} \u2014 {s.area ?? 0} {'\u05DE"\u05E8'}</div>;
                })}
              </div>
              <div className="text-xs font-bold text-green-900 mt-1 pt-1 border-t border-green-200">
                {'\u05E1\u05D4"\u05DB: '}{totalWasteArea.toLocaleString("he-IL")} {'\u05DE"\u05E8'}
              </div>
            </div>
            {nonParticipating.length > 0 && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-xs font-bold text-slate-600 mb-1">{"\u05DC\u05D0 \u05DE\u05E9\u05EA\u05EA\u05E4\u05D5\u05EA"} ({nonParticipating.length})</div>
                <div className="text-xs text-slate-500 space-y-0.5">
                  {nonParticipating.map(function (s) {
                    return <div key={s.id}>{s.space_name} \u2014 {s.area ?? 0} {'\u05DE"\u05E8'}</div>;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

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
                    <th className="px-4 py-3 font-semibold text-slate-700">{"\u05E9\u05D5\u05DB\u05E8"}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"\u05D9\u05D7\u05D9\u05D3\u05D5\u05EA \u05DE\u05E9\u05EA\u05EA\u05E4\u05D5\u05EA"}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{'\u05E9\u05D8\u05D7 (\u05DE"\u05E8)'}</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">%</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">{"\u05D7\u05D9\u05D5\u05D1"}</th>
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
                    <td className="px-4 py-2.5 font-bold text-slate-700">{'\u05E1\u05D4"\u05DB'}</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 font-bold">{results.reduce(function (s, r) { return s + r.wasteArea; }, 0).toLocaleString("he-IL")}</td>
                    <td className="px-4 py-2.5 font-bold">{results.reduce(function (s, r) { return s + r.pct; }, 0).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 font-black text-blue-700">{fmtMoney(results.reduce(function (s, r) { return s + r.charge; }, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={createCharges} disabled={creatingCharges}
                className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {creatingCharges ? "\u05D9\u05D5\u05E6\u05E8..." : "\u05E6\u05D5\u05E8 \u05D7\u05D9\u05D5\u05D1\u05D9\u05DD"}
              </button>
              <button onClick={createLetters} disabled={creatingLetters}
                className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                {creatingLetters ? "\u05D9\u05D5\u05E6\u05E8..." : "\u05E6\u05D5\u05E8 \u05DE\u05DB\u05EA\u05D1\u05D9\u05DD"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
