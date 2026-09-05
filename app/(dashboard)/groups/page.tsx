"use client";
import { useState, useEffect } from "react";
import { contractArea, csArea } from "@/lib/contract-area";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
import { getScopeIds, getCompanyScopeIds, getTenantScopeIds, scopeRows, scopeGroups } from '@/lib/permissions';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

// Calculate base monthly rent for a contract (handles per-unit pricing)
function calcContractRent(c: any): number {
  var total = 0;
  if (c.contract_spaces?.length > 0) {
    c.contract_spaces.forEach(function(cs: any) {
      if (cs.charge_method === "included") { } else if (cs.charge_method === "fixed" && cs.fixed_rent) total += Number(cs.fixed_rent);
      else total += (Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0) * csArea(cs);
    });
  }
  if (total === 0) total = (Number(c.rent_per_sqm) || 0) * contractArea(c);
  // A turnover lease earns its MINIMUM on paper — without this it counted ₪0.
  if (total === 0 && (c.rent_type === "revenue_pct" || Number(c.revenue_pct) > 0)) {
    var mArea = contractArea(c);
    total = Number(c.min_rent_per_sqm) > 0 ? Number(c.min_rent_per_sqm) * mArea : (Number(c.minimum_rent) || 0);
  }
  return total + (Number(c.investment_addition) || 0);
}

function contractStarted(c: any): boolean {
  return c.status !== "upcoming" && c.status !== "future";
}

export default function GroupsPage() {
  const router = useRouter();
  const [groups,     setGroups]     = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [spaces,     setSpaces]     = useState<any[]>([]);
  const [guarantees, setGuarantees] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<string|null>(null);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [fName,  setFName]  = useState("");
  const [fNotes, setFNotes] = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: g }, { data: p }, { data: c }, { data: sp }, { data: gu }] = await Promise.all([
      supabase.from("property_groups").select("*").order("group_name"),
      supabase.from("properties").select("id,name,group_id,total_area,city,property_type").order("name"),
      // upcoming/future included: a signed lease holds its units in the group's
      // occupancy even before its term begins. Income filters them out below.
      supabase.from("contracts").select("id, status, start_date, rent_type, revenue_pct, min_rent_per_sqm, minimum_rent, rent_per_sqm, charged_area, investment_addition, property_id, end_date, tenants(name), contract_spaces(area_override,space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))").in("status",["active","expiring","extended","upcoming","future"]),
      supabase.from("spaces").select("id, property_id, status, space_name, area").order("space_name"),
      supabase.from("guarantees").select("id,contract_id,guarantee_type,amount_required,end_date,status").eq("status","active"),
    ]);
    var scope = await getScopeIds();
    var scC = scopeRows(c??[], scope, function(x: any){ return x.property_id; });
    var cidOk: Record<string, boolean> = {};
    scC.forEach(function(x: any){ cidOk[x.id] = true; });
    var scP = scopeRows(p??[], scope, function(x: any){ return x.id; });
    setGroups(scopeGroups(g??[], scope, scP));
    setProperties(scP);
    setContracts(scC);
    setSpaces(scopeRows(sp??[], scope, function(x: any){ return x.property_id; }));
    setGuarantees((gu??[]).filter(function(x: any){ return scope === null || !!cidOk[x.contract_id]; }));
    setLoading(false);
    if (!selected && (g??[]).length > 0) setSelected((g??[])[0].id);
  }

  function openNew() { setIsNew(true); setEditingId("new"); setFName(""); setFNotes(""); }
  function openEdit(g: any) { setIsNew(false); setEditingId(g.id); setFName(g.group_name??""); setFNotes(g.notes??""); }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם קבוצה"); return; }
    setSaving(true);
    try {
      if (isNew) {
        const { data } = await supabase.from("property_groups").insert({group_name:fName.trim(),notes:fNotes||null}).select().single();
        await logAudit({entity_type:"group",entity_id:data.id,action:"create"});
      } else {
        await supabase.from("property_groups").update({group_name:fName.trim(),notes:fNotes||null}).eq("id",editingId);
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק קבוצה? הנכסים לא יימחקו, רק השיוך לקבוצה יבוטל.")) return;
    await supabase.from("properties").update({group_id:null}).eq("group_id",id);
    await supabase.from("property_groups").delete().eq("id",id);
    if (selected === id) setSelected(null);
    await loadAll();
  }

  // ─── Calculated data for selected group ───
  const selGroup = groups.find(function(g){return g.id===selected;});
  const groupProps = properties.filter(function(p){return p.group_id===selected;});
  const groupPropIds = groupProps.map(function(p){return p.id;});
  const groupContracts = contracts.filter(function(c){return groupPropIds.includes(c.property_id);});
  const groupSpaces = spaces.filter(function(s){return groupPropIds.includes(s.property_id);});
  // A future lease's guarantee is due at its own milestone — not a gap today.
  const startedGroupContracts = groupContracts.filter(contractStarted);
  const groupGuarantees = guarantees.filter(function(gu){
    return startedGroupContracts.some(function(c){return c.id===gu.contract_id;});
  });

  // Income: started leases only. Occupancy: every held unit — the cached
  // spaces.status OR a contract (including a signed-not-started one) covering
  // it, so the flag's drift can't hide a committed unit.
  const heldIds = new Set<string>();
  groupContracts.forEach(function(c: any){ (c.contract_spaces || []).forEach(function(cs: any){ if (cs?.space_id) heldIds.add(cs.space_id); }); });
  const isHeld = function(s: any){ return s.status === "occupied" || heldIds.has(s.id); };
  const totalRevenue = groupContracts.filter(contractStarted).reduce(function(s,c){return s+calcContractRent(c);},0);
  const totalArea = groupSpaces.reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
  const occupiedArea = groupSpaces.filter(isHeld).reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
  const occupancyPct = totalArea > 0 ? Math.round(occupiedArea/totalArea*100) : 0;
  const vacantSpaces = groupSpaces.filter(function(s){return !isHeld(s);});
  const occupiedSpaces = groupSpaces.filter(isHeld);

  const oneYearMs = 365*24*60*60*1000;
  const expiringContracts = startedGroupContracts.filter(function(c){
    if (!c.end_date) return false;
    var diff = new Date(c.end_date).getTime() - Date.now();
    return diff > 0 && diff <= oneYearMs;
  }).sort(function(a,b){return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();});

  const totalGuaranteeAmount = groupGuarantees.reduce(function(s,g){return s+(Number(g.amount_required)||0);},0);
  const expiringGuarantees = groupGuarantees.filter(function(g){
    if (!g.end_date) return false;
    var diff = new Date(g.end_date).getTime() - Date.now();
    return diff > 0 && diff <= oneYearMs;
  });

  const unassignedProps = properties.filter(function(p){return !p.group_id;});

  return (
    <div dir="rtl">
      <PageHero title="קבוצות נכסים" icon="🗂️" tone="violet" actionLabel="+ קבוצה" onAction={openNew}
        subtitle={groups.length + " קבוצות | " + properties.filter(function(p){return p.group_id;}).length + "/" + properties.length + " נכסים משויכים"} />

      {loading ? <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div> : groups.length===0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📁</div>
          <div>אין קבוצות</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ צור קבוצה</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* List */}
          <div className={(selected ? "hidden lg:block " : "") + "space-y-2"}>
            {groups.map(function(g) {
              const props = properties.filter(function(p){return p.group_id===g.id;});
              const propIds = props.map(function(p){return p.id;});
              const gContracts = contracts.filter(function(c){return propIds.includes(c.property_id);});
              const gRevenue = gContracts.filter(contractStarted).reduce(function(s,c){return s+calcContractRent(c);},0);
              return (
                <div key={g.id} onClick={function(){setSelected(selected===g.id?null:g.id);}}
                  className={"rounded-xl border p-3 cursor-pointer transition-all " +
                    (selected===g.id?"border-blue-500 bg-blue-50 shadow-sm":"border-slate-200 bg-white hover:shadow-sm")}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">📁</span>
                    <span className="font-bold text-slate-800 text-sm">{g.group_name}</span>
                  </div>
                  <div className="text-xs text-slate-500 flex justify-between mt-1.5">
                    <span>{props.length} נכסים</span>
                    <span className="font-semibold text-green-700">{fmtMoney(gRevenue)}/חו'</span>
                  </div>
                </div>
              );
            })}
            {unassignedProps.length > 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 mt-3">
                <div className="text-xs font-bold text-slate-500 mb-1">📋 ללא קבוצה</div>
                <div className="text-xs text-slate-400">{unassignedProps.length} נכסים</div>
              </div>
            )}
          </div>

          {/* Detail */}
          <div className={(selected ? "" : "hidden lg:block ") + "lg:col-span-3"}>
            {selected && <button onClick={function(){setSelected(null);}} className="lg:hidden flex items-center gap-1 text-sm font-semibold text-blue-600 mb-2">→ חזרה לרשימה</button>}
            {!selGroup ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
                <div className="text-5xl mb-3">📁</div>
                <div>בחר קבוצה לצפייה בפרטים</div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Header */}
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-3xl">📁</span>
                        <h2 className="text-2xl font-bold text-slate-800">{selGroup.group_name}</h2>
                      </div>
                      {selGroup.notes && <div className="text-sm text-slate-500 mt-1">{selGroup.notes}</div>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={function(){openEdit(selGroup);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                      <button onClick={function(){handleDelete(selGroup.id);}} className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">🗑</button>
                    </div>
                  </div>

                  {/* KPIs */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div className="rounded-xl p-3 text-center border border-green-200 bg-green-50">
                      <div className="text-base font-bold text-green-800">{fmtMoney(totalRevenue)}</div>
                      <div className="text-xs text-green-600">הכנסה חודשית</div>
                    </div>
                    <div className="rounded-xl p-3 text-center border border-blue-200 bg-blue-50">
                      <div className="text-lg font-black text-blue-700">{occupancyPct}%</div>
                      <div className="text-xs text-blue-600">תפוסה (לפי שטח)</div>
                    </div>
                    <div className="rounded-xl p-3 text-center border border-purple-200 bg-purple-50 cursor-pointer hover:ring-2 hover:ring-blue-300"
                      onClick={function(){router.push("/properties");}}>
                      <div className="text-lg font-black text-purple-700">{groupProps.length}</div>
                      <div className="text-xs text-purple-600">נכסים →</div>
                    </div>
                    <div className="rounded-xl p-3 text-center border border-slate-200 bg-slate-50">
                      <div className="text-lg font-black text-slate-700">{occupiedSpaces.length}/{groupSpaces.length}</div>
                      <div className="text-xs text-slate-500">יחידות{vacantSpaces.length > 0 ? " (" + vacantSpaces.length + " פנויות)" : ""}</div>
                    </div>
                    <div className="rounded-xl p-3 text-center border border-amber-200 bg-amber-50 cursor-pointer hover:ring-2 hover:ring-amber-300"
                      onClick={function(){router.push("/contracts");}}>
                      <div className="text-lg font-black text-amber-700">{startedGroupContracts.length}</div>
                      <div className="text-xs text-amber-600">חוזים →</div>
                    </div>
                  </div>

                  {/* Additional info row */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 text-xs">
                    <div className="flex justify-between border-b border-slate-100 pb-1">
                      <span className="text-slate-500">סה"כ שטח</span>
                      <span className="font-semibold text-slate-700">{totalArea.toLocaleString("he-IL")} מ"ר</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-1">
                      <span className="text-slate-500">סה"כ ערבויות</span>
                      <span className="font-semibold text-slate-700">{fmtMoney(totalGuaranteeAmount)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-1">
                      <span className="text-slate-500">הכנסה שנתית</span>
                      <span className="font-semibold text-green-700">{fmtMoney(totalRevenue * 12)}</span>
                    </div>
                  </div>
                </div>

                {/* Properties in group */}
                {groupProps.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                      <span className="font-semibold text-slate-700 text-sm">🏢 נכסים בקבוצה ({groupProps.length})</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {groupProps.map(function(p) {
                        const pContracts = contracts.filter(function(c){return c.property_id===p.id;});
                        const pSpaces = spaces.filter(function(s){return s.property_id===p.id;});
                        const pOccupied = pSpaces.filter(isHeld).length;
                        const pRevenue = pContracts.filter(contractStarted).reduce(function(s,c){return s+calcContractRent(c);},0);
                        return (
                          <div key={p.id} className="px-5 py-3 hover:bg-slate-50 cursor-pointer"
                            onClick={function(){router.push("/properties");}}>
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                                  <span>🏢</span>{p.name}
                                  {p.city && <span className="text-xs font-normal text-slate-400">📍 {p.city}</span>}
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5">
                                  {p.total_area ? p.total_area + ' מ"ר | ' : ""}
                                  {pSpaces.length} יחידות ({pOccupied} מושכרות) |
                                  {" " + pContracts.filter(contractStarted).length} חוזים
                                </div>
                              </div>
                              <div className="text-left">
                                <div className="font-bold text-green-700 text-sm">{fmtMoney(pRevenue)}/חו'</div>
                                <div className="text-xs text-slate-400">{pSpaces.length > 0 ? Math.round(pOccupied/pSpaces.length*100) : 0}% תפוסה</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Vacant units */}
                {vacantSpaces.length > 0 && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/30 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-blue-200 flex items-center justify-between">
                      <span className="font-bold text-blue-800 text-sm">🏠 יחידות פנויות בקבוצה ({vacantSpaces.length})</span>
                      <span className="text-xs text-blue-600">סה"כ {vacantSpaces.reduce(function(s,sp){return s+(Number(sp.area)||0);},0).toLocaleString("he-IL")} מ"ר זמין</span>
                    </div>
                    <div className="divide-y divide-blue-100 max-h-96 overflow-y-auto">
                      {vacantSpaces.map(function(sp) {
                        const prop = properties.find(function(p){return p.id===sp.property_id;});
                        return (
                          <div key={sp.id} className="px-5 py-2 flex items-center justify-between hover:bg-blue-50 cursor-pointer"
                            onClick={function(){router.push("/units?propertyId="+sp.property_id);}}>
                            <div className="flex items-center gap-2">
                              <span className="text-blue-500">📍</span>
                              <span className="font-semibold text-slate-700 text-sm">{sp.space_name}</span>
                              <span className="text-xs text-slate-500">{prop?.name}</span>
                            </div>
                            <span className="text-sm text-slate-600">{sp.area || "—"} מ"ר</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Expiring contracts */}
                {expiringContracts.length > 0 && (
                  <div className="rounded-xl border border-orange-200 bg-orange-50/30 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-orange-200">
                      <span className="font-bold text-orange-800 text-sm">⏰ חוזים שמסתיימים בשנה הקרובה ({expiringContracts.length})</span>
                    </div>
                    <div className="divide-y divide-orange-100 max-h-96 overflow-y-auto">
                      {expiringContracts.map(function(c) {
                        var daysLeft = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / (24*60*60*1000));
                        var monthsLeft = Math.floor(daysLeft / 30);
                        const prop = properties.find(function(p){return p.id===c.property_id;});
                        return (
                          <div key={c.id} className="px-5 py-3 hover:bg-orange-50 cursor-pointer"
                            onClick={function(){router.push("/contracts");}}>
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-semibold text-slate-800 text-sm">{c.tenants?.name}</div>
                                <div className="text-xs text-slate-500 mt-0.5">🏢 {prop?.name}</div>
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

                {/* Expiring guarantees */}
                {expiringGuarantees.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50/30 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-red-200">
                      <span className="font-bold text-red-800 text-sm">⚠️ ערבויות שפוגות בשנה הקרובה ({expiringGuarantees.length})</span>
                    </div>
                    <div className="divide-y divide-red-100 max-h-64 overflow-y-auto">
                      {expiringGuarantees.map(function(gu) {
                        const gContract = groupContracts.find(function(c){return c.id===gu.contract_id;});
                        const prop = gContract ? properties.find(function(p){return p.id===gContract.property_id;}) : null;
                        return (
                          <div key={gu.id} className="px-5 py-2.5 flex items-center justify-between hover:bg-red-50">
                            <div>
                              <div className="text-sm font-semibold text-slate-800">{gContract?.tenants?.name || "—"}</div>
                              <div className="text-xs text-slate-500">{prop?.name} | {gu.guarantee_type}</div>
                            </div>
                            <div className="text-left">
                              <div className="text-sm font-bold text-red-700">{fmtMoney(Number(gu.amount_required) || 0)}</div>
                              <div className="text-xs text-slate-500">פוגה {fmtDate(gu.end_date)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {groupProps.length === 0 && (
                  <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
                    <div className="text-4xl mb-2">🏢</div>
                    <div className="text-sm">אין נכסים בקבוצה זו</div>
                    <button onClick={function(){router.push("/properties");}} className="mt-3 text-blue-600 hover:underline text-sm">שייך נכסים לקבוצה →</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew?"קבוצה חדשה":"עריכה"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם *</label>
                <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} placeholder="מרכז מסחרי / קמפוס"/>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={3} className={ic}/>
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
    </div>
  );
}
