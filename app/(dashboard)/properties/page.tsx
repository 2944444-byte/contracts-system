"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import { fetchCpiAdjusted, fetchHighestChainedCpi } from '@/lib/cpi-server';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';
import { getKnownIndexMonth } from '@/lib/cpi-utils';
import CalcProgress, { CalcProgressState } from '@/components/CalcProgress';
import PropertyBudgetManager from '@/components/PropertyBudgetManager';

function formatDateForCbs(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  if (d.getDate() === 15) d.setDate(16);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const PROP_TYPES = [
  {v:"office",    l:"משרדים",      icon:"💼"},
  {v:"retail",    l:"מסחר",        icon:"🏪"},
  {v:"store",     l:"חנות",        icon:"🏬"},
  {v:"warehouse", l:"מחסן",        icon:"📦"},
  {v:"industrial",l:"תעשיה",      icon:"🏭"},
  {v:"mixed",     l:"מעורב",       icon:"🏢"},
  {v:"yard",      l:"חצר פתוחה",   icon:"🌳"},
  {v:"other",     l:"אחר",         icon:"🏗️"},
];

function fmtMoney(n: number) { return n ? "₪"+n.toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

export default function PropertiesPage() {
  const router  = useRouter();
  const [properties, setProperties] = useState<any[]>([]);
  const [companies,  setCompanies]  = useState<any[]>([]);
  const [spaces,     setSpaces]     = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<string|null>(null);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [search,     setSearch]     = useState("");
  const [budgetFor,  setBudgetFor]  = useState<any>(null);
  const [cpiRatios,  setCpiRatios]  = useState<Record<string, number>>({}); // contract_id → ratio
  const [cpiLoading, setCpiLoading] = useState(false);
  const [cpiProgress, setCpiProgress] = useState<CalcProgressState | null>(null);

  const [fName,       setFName]       = useState("");
  const [fCompanyId,  setFCompanyId]  = useState("");
  const [fGroupId,    setFGroupId]    = useState("");
  const [propertyGroups, setPropertyGroups] = useState<any[]>([]);
  const [fType,       setFType]       = useState("office");
  const [fAddress,    setFAddress]    = useState("");
  const [fCity,       setFCity]       = useState("");
  const [fArea,       setFArea]       = useState("");
  const [fFloors,     setFFloors]     = useState("");
  const [fNotes,      setFNotes]      = useState("");
  const [fYardArea,   setFYardArea]   = useState("");
  const [fParking,    setFParking]    = useState("");
  const [fInsurCost,  setFInsurCost]  = useState("");
  const [fInsurDate,  setFInsurDate]  = useState("");
  const [fInsurPolicy,setFInsurPolicy]= useState("");
  const [fMgmtBudget, setFMgmtBudget] = useState("");
  const [fWasteCost,  setFWasteCost]  = useState("");
  const [fMgmtType,   setFMgmtType]   = useState("internal");
  const [fConstStatus, setFConstStatus] = useState("active");

  useEffect(function() { loadAll(); }, []);

  // Compute CPI ratio per contract for the selected property (for indexed revenue)
  useEffect(function() {
    (async function() {
      try {
        if (!selected) { setCpiRatios({}); return; }
        var propContracts = contracts.filter(function(c) { return c.property_id === selected && !c.is_amendment; });
        if (propContracts.length === 0) { setCpiRatios({}); return; }

        // Group contracts by (base date + mechanism). Contracts with same
        // base date but different mechanisms (e.g. standard vs highest)
        // need different ratios.
        var groups: Record<string, { contractIds: string[]; fromDate: string; rawBase: string; isHighest: boolean }> = {};
        propContracts.forEach(function(c) {
          if (c.indexation_method === "none") return;
          var baseDate = c.index_base_date || null;
          if (!baseDate) return;
          var cbsDate = formatDateForCbs(baseDate);
          if (!cbsDate) return;
          var mech = c.indexation_method || "standard";
          var isHighest = mech === "highest_in_period" || mech === "no_drop"
            || c.index_mechanism === "highest_in_period" || c.index_mechanism === "no_drop";
          var key = cbsDate + "|" + (isHighest ? "H" : "S");
          if (!groups[key]) groups[key] = { contractIds: [], fromDate: cbsDate, rawBase: baseDate, isHighest: isHighest };
          groups[key].contractIds.push(c.id);
        });

        var groupKeys = Object.keys(groups);
        if (groupKeys.length === 0) { setCpiRatios({}); return; }

        setCpiLoading(true);
        var todayForCbs = formatDateForCbs(new Date().toISOString());
        if (!todayForCbs) { setCpiLoading(false); return; }

        // Sequential so progress can update; each group can take seconds for highest scan.
        var calcStart = Date.now();
        setCpiProgress({ current: 0, total: groupKeys.length, label: "מחשב יחס מדד לחוזי הנכס...", startedAt: calcStart });
        var results: any[] = [];
        for (var gi = 0; gi < groupKeys.length; gi++) {
          var key = groupKeys[gi];
          var g = groups[key];
          setCpiProgress({
            current: gi + 1,
            total: groupKeys.length,
            label: g.isHighest ? "סורק שיא מדד..." : "מביא יחס מדד...",
            startedAt: calcStart,
          });
          try {
            if (g.isHighest) {
              var baseDateObj = new Date(g.rawBase);
              var nowKnown = getKnownIndexMonth(new Date());
              var peak = await fetchHighestChainedCpi({
                baseFromDate: g.fromDate,
                scanFromYear: baseDateObj.getFullYear(),
                scanFromMonth: baseDateObj.getMonth() + 1,
                scanToYear: nowKnown.year,
                scanToMonth: nowKnown.month,
              });
              if (peak.success && peak.peakRatio) {
                results.push({ key: key, ratio: peak.peakRatio });
                continue;
              }
            }
            var data: any = await fetchCpiAdjusted({ value: 10000, fromDate: g.fromDate, toDate: todayForCbs as string });
            results.push({ key: key, ratio: (data && data.success) ? (Number(data.adjustedRentPerSqm) || 10000) / 10000 : 1 });
          } catch {
            results.push({ key: key, ratio: 1 });
          }
        }

        var map: Record<string, number> = {};
        results.forEach(function(r: any) {
          var g = groups[r.key];
          if (!g) return;
          g.contractIds.forEach(function(cid: string) { map[cid] = r.ratio; });
        });
        setCpiRatios(map);
        setCpiLoading(false);
        setCpiProgress(null);
      } catch (e) {
        console.error("property cpi error:", e);
        setCpiRatios({});
        setCpiLoading(false);
        setCpiProgress(null);
      }
    })();
  }, [selected, contracts.length]);

  async function loadAll() {
    const [{ data: p }, { data: c }, { data: sp }, { data: co }] = await Promise.all([
      supabase.from("properties").select("*, companies(company_name)").order("name"),
      supabase.from("contracts").select("id, status, rent_per_sqm, charged_area, investment_addition, property_id, end_date, indexation_method, index_mechanism, index_base_date, index_base_value, is_amendment, parent_contract_id, tenants(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))").in("status",["active","expiring","extended"]),
      supabase.from("spaces").select("id, property_id, status, space_name, area").order("space_name"),
      supabase.from("companies").select("id,company_name").order("company_name"),
    ]);
    // Data-level scoping
    var scope = await getScopeIds();
    var scP = scopeRows(p ?? [], scope, function(x: any){ return x.id; });
    setProperties(scP);
    setContracts(scopeRows(c ?? [], scope, function(x: any){ return x.property_id; }));
    setSpaces(scopeRows(sp ?? [], scope, function(x: any){ return x.property_id; }));
    setCompanies(co ?? []);
    // Load property groups separately
    var { data: g } = await supabase.from("property_groups").select("id,group_name").order("group_name");
    setPropertyGroups(g ?? []);
    setLoading(false);
    if (!selected && scP.length > 0) setSelected(scP[0].id);
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
    return total + (Number(c.investment_addition) || 0);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFCompanyId(""); setFGroupId(""); setFType("office"); setFAddress(""); setFCity(""); setFArea(""); setFFloors(""); setFNotes("");
    setFYardArea(""); setFParking(""); setFInsurCost(""); setFInsurDate(""); setFInsurPolicy(""); setFMgmtBudget(""); setFWasteCost("");
  }

  function openEdit(p: any) {
    setIsNew(false); setEditingId(p.id);
    setFName(p.name??""); setFCompanyId(p.company_id??""); setFGroupId(p.group_id??""); setFType(p.property_type??"office");
    setFAddress(p.address??""); setFCity(p.city??""); setFArea(p.total_area?.toString()??"");
    setFFloors(p.floors?.toString()??""); setFNotes(p.notes??"");
    setFYardArea(p.yard_terrace_area?.toString()??""); setFParking(p.parking_spaces?.toString()??"");
    setFInsurCost(p.annual_insurance_cost?.toString()??""); setFInsurDate(p.insurance_renewal_date??"");
    setFInsurPolicy(p.insurance_policy_number??""); setFMgmtBudget(p.annual_management_budget?.toString()??"");
    setFWasteCost(p.annual_waste_cost?.toString()??"");
    setFMgmtType(p.management_type??"internal");
    setFConstStatus(p.construction_status??"active");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם נכס"); return; }
    setSaving(true);
    try {
      const payload: any = {
        name: fName.trim(), company_id: fCompanyId||null, group_id: fGroupId||null,
        property_type: fType, address: fAddress||null, city: fCity||null,
        total_area: fArea ? Number(fArea) : null, floors: fFloors ? Number(fFloors) : null,
        notes: fNotes||null,
        yard_terrace_area: fYardArea ? Number(fYardArea) : null,
        parking_spaces: fParking ? Number(fParking) : null,
        annual_insurance_cost: fInsurCost ? Number(fInsurCost) : null,
        insurance_renewal_date: fInsurDate||null,
        insurance_policy_number: fInsurPolicy||null,
        annual_management_budget: fMgmtBudget ? Number(fMgmtBudget) : null,
        annual_waste_cost: fWasteCost ? Number(fWasteCost) : null,
        management_type: fMgmtType,
        construction_status: fConstStatus,
      };
      if (isNew) {
        const { data, error: _ie } = await supabase.from("properties").insert(payload).select().single();
      if (_ie) throw new Error(_ie.message);
      if (!data?.id) throw new Error("שגיאה בשמירה");
        await logAudit({ entity_type:"property", entity_id:data.id, action:"create" });
        setSelected(data.id);
      } else {
        await supabase.from("properties").update(payload).eq("id", editingId);
        await logAudit({ entity_type:"property", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק נכס? פעולה זו תמחק גם את כל החוזים, היחידות, הביטוחים ובדיקות הבטיחות!")) return;
    const { data: pContracts } = await supabase.from("contracts").select("id").eq("property_id", id);
    const cIds = (pContracts||[]).map((c:any)=>c.id);
    if(cIds.length > 0){
      await supabase.from("charges").delete().in("contract_id", cIds);
      await supabase.from("contract_spaces").delete().in("contract_id", cIds);
      await supabase.from("contract_options").delete().in("contract_id", cIds);
      await supabase.from("contract_price_tiers").delete().in("contract_id", cIds);
      await supabase.from("guarantees").delete().in("contract_id", cIds);
      await supabase.from("insurances_tenant").delete().in("contract_id", cIds);
      await supabase.from("letters").delete().in("contract_id", cIds);
      await supabase.from("contracts").delete().in("id", cIds);
    }
    await supabase.from("units").delete().eq("property_id", id);
    await supabase.from("spaces").delete().eq("property_id", id);
    await supabase.from("insurances_building").delete().eq("property_id", id);
    await supabase.from("safety_inspections").delete().eq("property_id", id);
    await supabase.from("properties").delete().eq("id", id);
    setSelected(null); await loadAll();
  }

  const filtered = properties.filter(function(p) {
    return !search || p.name?.includes(search) || p.city?.includes(search);
  });

  const selProp = properties.find(function(p) { return p.id === selected; });
  const selSpaces    = spaces.filter(function(s) { return s.property_id === selected; });
  // Filter out amendments — show only main contracts. Amendment data is folded into parent below.
  const selContracts = contracts.filter(function(c) { return c.property_id === selected && !c.is_amendment; });
  // Base revenue (not indexed) — using accurate per-unit calculation
  const selRevenueBase = selContracts.reduce(function(s,c){return s + calcContractRent(c);},0);
  // Indexed revenue — applies CPI ratio per contract from cpiRatios state
  const selRevenueIndexed = selContracts.reduce(function(s,c){
    var base = calcContractRent(c);
    var ratio = cpiRatios[c.id] || 1;
    return s + (base * ratio);
  },0);
  const selRevenue = selRevenueBase; // for backwards compat below
  // Vacancy derived from contract_spaces — NOT from the cached spaces.status
  // field. The status flag silently drifts when an amendment changes holdings
  // (e.g. Golf's amendment took חנות 4 from "vacant" to occupied, but the
  // flag wasn't updated). Computing from the relations means the truth always
  // matches the source data, no syncing required.
  //
  // We include base contracts AND amendments in the held set, since an
  // amendment that adds a space holds it from amendment_date onwards.
  const allContractsForProp = contracts.filter(function(c) { return c.property_id === selected; });
  const heldSpaceIds = new Set<string>();
  allContractsForProp.forEach(function(c) {
    (c.contract_spaces || []).forEach(function(cs: any) {
      if (cs?.space_id) heldSpaceIds.add(cs.space_id);
    });
  });
  const selOccupied  = selSpaces.filter(function(s){return heldSpaceIds.has(s.id);}).length;
  const selVacant    = selSpaces.filter(function(s){return !heldSpaceIds.has(s.id);});
  // Occupancy by AREA (more meaningful than by count)
  const totalArea    = selSpaces.reduce(function(s,sp){return s + (Number(sp.area) || 0);}, 0);
  const occupiedArea = selSpaces.filter(function(s){return heldSpaceIds.has(s.id);}).reduce(function(s,sp){return s + (Number(sp.area) || 0);}, 0);
  const selOccPct    = totalArea > 0 ? Math.round(occupiedArea/totalArea*100) : (selSpaces.length > 0 ? Math.round(selOccupied/selSpaces.length*100) : 0);
  // Contracts expiring within next 12 months
  const oneYearMs    = 365 * 24 * 60 * 60 * 1000;
  const expiringSoon = selContracts.filter(function(c) {
    if (!c.end_date) return false;
    var diff = new Date(c.end_date).getTime() - Date.now();
    return diff > 0 && diff <= oneYearMs;
  }).sort(function(a,b){return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();});

  const typeInfo = function(v: string) { return PROP_TYPES.find(function(t){return t.v===v;})??PROP_TYPES[4]; };

  return (
    <div dir="rtl">
      <PageHero title="נכסים" subtitle={properties.length + " נכסים"} icon="🏢" tone="blue" actionLabel="+ נכס חדש" onAction={openNew} />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* רשימה */}
        <div className="space-y-2">
          <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
            placeholder="חיפוש..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm mb-2" />
          {loading ? <div className="text-center py-4 text-slate-400">טוען...</div> : (
            filtered.map(function(p) {
              const ti = typeInfo(p.property_type);
              const propContracts = contracts.filter(function(c){return c.property_id===p.id;});
              return (
                <div key={p.id} onClick={function(){setSelected(selected===p.id?null:p.id);}}
                  className={"rounded-xl border p-3 cursor-pointer transition-all " +
                    (selected===p.id?"border-blue-500 bg-blue-50 shadow-sm":"border-slate-200 bg-white hover:shadow-sm")}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
                      <span>{ti.icon}</span>{p.name}
                    </div>
                    {propContracts.length > 0 && (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">{propContracts.length}</span>
                    )}
                  </div>
                  {p.city && <div className="text-xs text-slate-400">📍 {p.city}</div>}
                  {p.companies?.company_name && <div className="text-xs text-slate-400">🏛️ {p.companies.company_name}</div>}
                </div>
              );
            })
          )}
          {filtered.length === 0 && !loading && <div className="text-center py-4 text-slate-400 text-sm">אין נכסים</div>}
        </div>

        {/* פרטים */}
        <div className="lg:col-span-3">
          {!selProp ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">🏢</div><div>בחר נכס לצפייה</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* כרטיס ראשי */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl">{typeInfo(selProp.property_type).icon}</span>
                      <h2 className="text-xl font-bold text-slate-800 cursor-pointer hover:underline hover:text-blue-700" onClick={function(){router.push("/units?propertyId="+selProp.id);}}>{selProp.name} <span className="text-sm font-normal text-blue-500">צפה ביחידות →</span></h2>
                    </div>
                    {selProp.companies?.company_name && <div className="text-sm text-slate-500">🏛️ {selProp.companies.company_name}</div>}
                    {selProp.city && <div className="text-sm text-slate-500">📍 {selProp.address ? selProp.address+", " : ""}{selProp.city}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function(){openEdit(selProp);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={function(){handleDelete(selProp.id);}} className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">🗑</button>
                  </div>
                </div>

                {cpiProgress && (
                  <div className="mb-3">
                    <CalcProgress {...cpiProgress} />
                  </div>
                )}

                {/* KPI. The revenue cards explicitly say "חודשי" + show the
                    annual extrapolation underneath — the user previously
                    couldn't tell whether the number was monthly or yearly. */}
                <div className="grid grid-cols-5 gap-2">
                  {[
                    {
                      label: cpiLoading ? "מחשב הצמדה..." : "שכ\"ד חודשי צמוד",
                      value: fmtMoney(selRevenueIndexed || selRevenueBase),
                      sub: "שנתי: " + fmtMoney((selRevenueIndexed || selRevenueBase) * 12),
                      color: "text-green-700", bg: "bg-green-50",
                    },
                    {
                      label: "שכ\"ד חודשי לא צמוד",
                      value: fmtMoney(selRevenueBase),
                      sub: "שנתי: " + fmtMoney(selRevenueBase * 12),
                      color: "text-slate-700", bg: "bg-slate-50",
                    },
                    {label:"תפוסה (לפי שטח)", value:selOccPct+"%",            color:"text-blue-700",  bg:"bg-blue-50"},
                    {label:selVacant.length > 0 ? selVacant.length + " פנויות" : "יחידות", value:selOccupied + "/" + selSpaces.length + " יח'",   color:"text-orange-700", bg:"bg-orange-50", link:"/units?propertyId="+selProp.id},
                    {label:"חוזים פעילים", value:String(selContracts.length),color:"text-purple-700",bg:"bg-purple-50", link:"/contracts"},
                  ].map(function(k: any) {
                    return (
                      <div key={k.label} className={"rounded-xl p-3 text-center " + k.bg + (k.link ? " cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all" : "")}
                        onClick={k.link ? function(){router.push(k.link);} : undefined}>
                        <div className={"text-lg font-black " + k.color}>{k.value}</div>
                        <div className="text-xs text-slate-400">{k.label}{k.link ? " →" : ""}</div>
                        {k.sub && <div className="text-[10px] text-slate-400 mt-0.5">{k.sub}</div>}
                      </div>
                    );
                  })}
                </div>

                {/* פרטים נוספים */}
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  {[
                    {l:"סוג",    v:typeInfo(selProp.property_type).l},
                    {l:"שטח",   v:selProp.total_area ? selProp.total_area+' מ"ר' : "—"},
                    {l:"קומות", v:selProp.floors ? selProp.floors+" קומות" : "—"},
                  ].map(function(row) {
                    return (
                      <div key={row.l} className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="text-slate-400">{row.l}</span>
                        <span className="font-semibold text-slate-700">{row.v}</span>
                      </div>
                    );
                  })}
                </div>
                {selProp.notes && <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{selProp.notes}</div>}

                {/* Budget button */}
                <button onClick={() => setBudgetFor(selProp)}
                  className="w-full mt-3 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  📊 ניהול תקציבים שנתיים
                </button>
              </div>

              {/* יחידות */}
              {selSpaces.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-semibold text-slate-700 text-sm">יחידות ({selSpaces.length})</span>
                    <button onClick={function(){router.push("/units?propertyId="+selProp.id);}} className="text-xs text-blue-600 hover:underline">נהל →</button>
                  </div>
                  <div className="px-5 py-3 grid grid-cols-3 gap-2">
                    {[
                      {label:"מושכרות", count:selOccupied,                               color:"text-green-600"},
                      {label:"פנויות",  count:selVacant.length, color:"text-blue-600"},
                      {label:"תחזוקה", count:selSpaces.filter(function(s){return s.status==="maintenance";}).length, color:"text-slate-400"},
                    ].map(function(k) {
                      return (
                        <div key={k.label} className="text-center">
                          <div className={"text-xl font-black " + k.color}>{k.count}</div>
                          <div className="text-xs text-slate-400">{k.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* יחידות פנויות — פירוט */}
              {selVacant.length > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/30 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-blue-200 flex items-center justify-between">
                    <span className="font-bold text-blue-800 text-sm">🏠 יחידות פנויות ({selVacant.length})</span>
                    <span className="text-xs text-blue-600">סה"כ {selVacant.reduce(function(s,sp){return s+(Number(sp.area)||0);},0)} מ&quot;ר זמין</span>
                  </div>
                  <div className="divide-y divide-blue-100">
                    {selVacant.map(function(sp) {
                      return (
                        <div key={sp.id} className="px-5 py-2.5 flex items-center justify-between hover:bg-blue-50 cursor-pointer"
                          onClick={function(){router.push("/units?propertyId="+selProp.id);}}>
                          <div className="flex items-center gap-2">
                            <span className="text-blue-500">📍</span>
                            <span className="font-semibold text-slate-700 text-sm">{sp.space_name}</span>
                          </div>
                          <span className="text-sm text-slate-600">{sp.area || "—"} מ&quot;ר</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* חוזים שמסתיימים בשנה הקרובה */}
              {expiringSoon.length > 0 && (
                <div className="rounded-xl border border-orange-200 bg-orange-50/30 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-orange-200 flex items-center justify-between">
                    <span className="font-bold text-orange-800 text-sm">⏰ חוזים שמסתיימים בשנה הקרובה ({expiringSoon.length})</span>
                  </div>
                  <div className="divide-y divide-orange-100">
                    {expiringSoon.map(function(c) {
                      var daysLeft = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / (24*60*60*1000));
                      var monthsLeft = Math.floor(daysLeft / 30);
                      var spNames = (c.contract_spaces||[]).map(function(cs:any){return cs.spaces?.space_name;}).filter(Boolean).join(", ");
                      return (
                        <div key={c.id} className="px-5 py-3 hover:bg-orange-50 cursor-pointer"
                          onClick={function(){router.push("/contracts");}}>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-slate-800 text-sm">{c.tenants?.name}</div>
                              {spNames && <div className="text-xs text-slate-500 mt-0.5">{spNames}</div>}
                            </div>
                            <div className="text-left">
                              <div className={"text-sm font-bold " + (daysLeft <= 90 ? "text-red-600" : "text-orange-700")}>
                                {monthsLeft > 0 ? monthsLeft + " חודשים" : daysLeft + " ימים"}
                              </div>
                              <div className="text-xs text-slate-500">עד {fmtDate(c.end_date)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* חוזים פעילים — מתחת לפרטים */}
              {selContracts.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-semibold text-slate-700 text-sm">חוזים פעילים ({selContracts.length})</span>
                    <button onClick={function(){router.push("/contracts");}} className="text-xs text-blue-600 hover:underline">הכל →</button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {selContracts.map(function(c) {
                      const monBase = calcContractRent(c);
                      const monIdx = monBase * (cpiRatios[c.id] || 1);
                      const mon = monIdx;
                      return (
                        <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
                          <div>
                            <div className="font-medium text-slate-800 text-sm">{c.tenants?.name}</div>
                            <span className={"text-xs px-1.5 py-0.5 rounded-full " +
                              (c.status==="active"?"bg-green-100 text-green-700":c.status==="expiring"?"bg-yellow-100 text-yellow-700":"bg-blue-100 text-blue-700")}>
                              {c.status==="active"?"פעיל":c.status==="expiring"?"פוגה":"מורחב"}
                            </span>
                          </div>
                          <div className="font-bold text-green-700 text-sm">{fmtMoney(mon)}/חודש</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew?"נכס חדש":"עריכת נכס"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם הנכס *</label>
                <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חברה</label>
                <select value={fCompanyId} onChange={function(e){setFCompanyId(e.target.value);}} className={ic}>
                  <option value="">-- ללא חברה --</option>
                  {companies.map(function(c){return <option key={c.id} value={c.id}>{c.company_name}</option>;})}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">קבוצת נכסים</label>
                <select value={fGroupId} onChange={function(e){setFGroupId(e.target.value);}} className={ic}>
                  <option value="">-- ללא קבוצה --</option>
                  {propertyGroups.map(function(g:any){return <option key={g.id} value={g.id}>{g.group_name}</option>;})}
                </select>
                <div className="text-xs text-slate-400 mt-1">
                  ניהול קבוצות: <span className="text-blue-600 cursor-pointer hover:underline" onClick={function(){router.push("/groups");}}>עבור לדף קבוצות →</span>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג נכס</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {PROP_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFType(t.v);}}
                        className={"rounded-lg border p-2 text-center " + (fType===t.v?"border-blue-500 bg-blue-50":"border-slate-200 hover:bg-slate-50")}>
                        <div className="text-lg">{t.icon}</div>
                        <div className={"text-xs " + (fType===t.v?"text-blue-700 font-bold":"text-slate-500")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג ניהול</label>
                <div className="flex gap-2">
                  {[{v:"internal",l:"ניהול פנימי",icon:"🏠",desc:"המערכת מנהלת חיובים"},{v:"external",l:"ניהול חיצוני",icon:"🏢",desc:"חברת ניהול חיצונית"}].map(function(m) {
                    return (
                      <button key={m.v} type="button" onClick={function(){setFMgmtType(m.v);}}
                        className={"flex-1 rounded-lg border p-2.5 text-center " + (fMgmtType===m.v?"border-blue-500 bg-blue-50":"border-slate-200 hover:bg-slate-50")}>
                        <div className="text-lg">{m.icon}</div>
                        <div className={"text-xs font-semibold " + (fMgmtType===m.v?"text-blue-700":"text-slate-500")}>{m.l}</div>
                        <div className="text-[10px] text-slate-400">{m.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
                  <input type="text" value={fAddress} onChange={function(e){setFAddress(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">עיר</label>
                  <input type="text" value={fCity} onChange={function(e){setFCity(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שטח להשכרה (מ&quot;ר)</label>
                  <input type="number" value={fArea} onChange={function(e){setFArea(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שטח חצר/מרפסות (מ&quot;ר)</label>
                  <input type="number" value={fYardArea} onChange={function(e){setFYardArea(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">קומות</label>
                  <input type="number" value={fFloors} onChange={function(e){setFFloors(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מקומות חניה</label>
                  <input type="number" value={fParking} onChange={function(e){setFParking(e.target.value);}} className={ic} />
                </div>
              </div>

              {/* ביטוח */}
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 mt-2">
                <div className="text-xs font-bold text-blue-700 mb-2">ביטוח מבנה</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">עלות שנתית (₪)</label>
                    <input type="number" value={fInsurCost} onChange={function(e){setFInsurCost(e.target.value);}} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">תאריך חידוש</label>
                    <input type="date" value={fInsurDate} onChange={function(e){setFInsurDate(e.target.value);}} className={ic} />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">מספר פוליסה</label>
                    <input type="text" value={fInsurPolicy} onChange={function(e){setFInsurPolicy(e.target.value);}} className={ic} />
                  </div>
                </div>
              </div>

              {/* תקציב */}
              <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                <div className="text-xs font-bold text-amber-700 mb-2">תקציב שנתי</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">ניהול (₪)</label>
                    <input type="number" value={fMgmtBudget} onChange={function(e){setFMgmtBudget(e.target.value);}} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">פינוי אשפה (₪)</label>
                    <input type="number" value={fWasteCost} onChange={function(e){setFWasteCost(e.target.value);}} className={ic} />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={2} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving?"שומר...":"שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Budget manager modal */}
      {budgetFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setBudgetFor(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <PropertyBudgetManager propertyId={budgetFor.id} propertyName={budgetFor.name} onClose={() => setBudgetFor(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
