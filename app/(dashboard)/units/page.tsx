"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import PropertyHierarchyFilter from '@/components/PropertyHierarchyFilter';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
const SPACE_TYPES = [{v:"office",l:"משרדים",icon:"💼"},{v:"retail",l:"מסחר",icon:"🏪"},{v:"store",l:"חנות",icon:"🏬"},{v:"warehouse",l:"מחסן",icon:"📦"},{v:"industrial",l:"תעשיה",icon:"🏭"},{v:"yard",l:"חצר פתוחה",icon:"🌳"},{v:"other",l:"אחר",icon:"🚪"}];

export default function UnitsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPropertyId = searchParams.get("propertyId");
  const [spaces,     setSpaces]     = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterPropIds, setFilterPropIds] = useState<string[]>([]);

  // Auto-filter when navigating from properties page
  useEffect(function() {
    if (urlPropertyId) setFilterPropIds([urlPropertyId]);
  }, [urlPropertyId]);
  const [filterSt,   setFilterSt]   = useState("all");

  const [fPropertyId,setFPropertyId]=useState("");
  const [fName,      setFName]      =useState("");
  const [fType,      setFType]      =useState("office");
  const [fArea,      setFArea]      =useState("");
  const [fFloor,     setFFloor]     =useState("");
  const [fStatus,    setFStatus]    =useState("vacant");
  const [fNotes,     setFNotes]     =useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: sp }, { data: pr }, { data: c }] = await Promise.all([
      supabase.from("spaces").select("*, properties(name, total_area)").order("space_name"),
      supabase.from("properties").select("id,name,total_area").order("name"),
      // upcoming/future included: a SIGNED lease holds its units — the shop is
      // let even though the term hasn't begun, and showing it vacant invited
      // someone to rent it twice.
      supabase.from("contracts").select("id,property_id,tenant_id,status,is_amendment,parent_contract_id,amendment_number,amendment_date,start_date,tenants(name),contract_spaces(space_id)").in("status",["active","expiring","extended","upcoming","future"]),
    ]);
    var scope = await getScopeIds();
    setSpaces(scopeRows(sp??[], scope, function(x: any){ return x.property_id; }));
    setProperties(scopeRows(pr??[], scope, function(x: any){ return x.id; }));
    setContracts(scopeRows(c??[], scope, function(x: any){ return x.property_id; }));
    setLoading(false);
  }

  function openNew() { setIsNew(true); setEditingId("new"); setFPropertyId(""); setFName(""); setFType("office"); setFArea(""); setFFloor(""); setFStatus("vacant"); setFNotes(""); }
  function openEdit(s: any) { setIsNew(false); setEditingId(s.id); setFPropertyId(s.property_id??""); setFName(s.space_name??""); setFType(s.space_type??"office"); setFArea(s.area?.toString()??""); setFFloor(s.floor?.toString()??""); setFStatus(s.status??"vacant"); setFNotes(s.notes??""); }

  async function handleSave() {
    if (!fPropertyId||!fName.trim()) { alert("חובה: נכס + שם"); return; }
    setSaving(true);
    try {
      const payload={property_id:fPropertyId,space_name:fName.trim(),space_type:fType,area:fArea?Number(fArea):null,floor:fFloor?Number(fFloor):null,status:fStatus,notes:fNotes||null};
      if (isNew) { const { data, error: _ie } = await supabase.from("spaces").insert(payload).select().single();
      if (_ie) throw new Error(_ie.message);
      if (!data?.id) throw new Error("שגיאה בשמירה"); await logAudit({entity_type:"space",entity_id:data.id,action:"create"}); }
      else { await supabase.from("spaces").update(payload).eq("id",editingId); }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק יחידה זו? פעולה זו תמחק גם חוזים מקושרים!")) return;
    const { data: linked } = await supabase.from("contract_spaces").select("contract_id").eq("space_id", id);
    const cIds = Array.from(new Set((linked||[]).map((r:any)=>r.contract_id)));
    for (const cId of cIds) {
      await supabase.from("charges").delete().eq("contract_id", cId);
      await supabase.from("contract_spaces").delete().eq("contract_id", cId);
      await supabase.from("contract_options").delete().eq("contract_id", cId);
      await supabase.from("contract_price_tiers").delete().eq("contract_id", cId);
      await supabase.from("guarantees").delete().eq("contract_id", cId);
      await supabase.from("insurances_tenant").delete().eq("contract_id", cId);
      await supabase.from("letters").delete().eq("contract_id", cId);
      await supabase.from("contracts").delete().eq("id", cId);
    }
    await supabase.from("contract_spaces").delete().eq("space_id", id);
    await supabase.from("spaces").delete().eq("id", id);
    await loadAll();
  }

  // Current tenant per unit, honoring amendments: a unit follows the LATEST
  // snapshot of each contract family (base + amendments). So after Golf's
  // 13.3.2026 amendment swapped them to חנות 4 (and חנות 6 to Yehonatan), each
  // unit shows its up-to-date occupant — not the stale original base rows.
  const spaceHolderMap: Record<string, { name: string; started: boolean }> = (function() {
    const byContract: Record<string, { contract: any; spaceIds: string[] }> = {};
    contracts.forEach(function(c: any) {
      if (!byContract[c.id]) byContract[c.id] = { contract: c, spaceIds: [] };
      (c.contract_spaces ?? []).forEach(function(cs: any) {
        if (byContract[c.id].spaceIds.indexOf(cs.space_id) === -1) byContract[c.id].spaceIds.push(cs.space_id);
      });
    });
    const families: Record<string, Array<{ contract: any; spaceIds: string[] }>> = {};
    Object.keys(byContract).forEach(function(cid) {
      const e = byContract[cid];
      const fid = e.contract.parent_contract_id || e.contract.id;
      if (!families[fid]) families[fid] = [];
      families[fid].push(e);
    });
    const rank = function(e: any): number {
      const c = e.contract;
      const dt = c.amendment_date || c.start_date;
      return (dt ? new Date(dt).getTime() : 0) * 1000 + (c.amendment_number || 0);
    };
    const map: Record<string, { name: string; started: boolean }> = {};
    Object.keys(families).forEach(function(fid) {
      const snaps = families[fid];
      const baseEntry = snaps.find(function(s) { return !s.contract.is_amendment; }) || snaps[0];
      const latest = snaps.slice().sort(function(a, b) { return rank(a) - rank(b); })[snaps.length - 1];
      const name = baseEntry.contract.tenants?.name || null;
      if (!name) return;
      const st = String(baseEntry.contract.status);
      const started = st !== "upcoming" && st !== "future";
      latest.spaceIds.forEach(function(sid) {
        // A started lease outranks a future one on the same unit.
        if (!map[sid] || (started && !map[sid].started)) map[sid] = { name: name, started: started };
      });
    });
    return map;
  })() as Record<string, { name: string; started: boolean }>;

  function tenantForSpace(spaceId: string): { name: string; started: boolean } | null {
    return spaceHolderMap[spaceId] ?? null;
  }

  const filtered = spaces.filter(function(s){
    if (filterPropIds.length>0 && !filterPropIds.includes(s.property_id)) return false;
    if (filterSt==="all") return true;
    return filterSt==="occupied" ? unitHeld(s) : !unitHeld(s);
  });
  // One truth for "is this unit taken": the cached flag OR any contract that
  // holds it — including a signed lease whose term hasn't begun. The cards
  // already worked this way; the top counters and the filter still read the
  // drift-prone flag alone and could disagree with the cards on the same page.
  const unitHeld = function(s: any): boolean { return s.status === "occupied" || !!tenantForSpace(s.id); };
  const vacant=spaces.filter(function(s){return !unitHeld(s);}).length;
  const occupied=spaces.filter(unitHeld).length;
  const totalArea=spaces.reduce(function(s,sp){return s+(Number(sp.area)??0);},0);
  const rentedArea=spaces.filter(unitHeld).reduce(function(s,sp){return s+(Number(sp.area)??0);},0);
  const typeInfo=function(v:string){return SPACE_TYPES.find(function(t){return t.v===v;})??SPACE_TYPES[5];};

  // Group filtered spaces by property
  const propGroups: Record<string,{prop:any; spaces:any[]}> = {};
  filtered.forEach(function(s) {
    const pid = s.property_id;
    if (!propGroups[pid]) {
      const prop = properties.find(function(p){return p.id===pid;});
      propGroups[pid] = { prop: prop || { id: pid, name: "לא ידוע" }, spaces: [] };
    }
    propGroups[pid].spaces.push(s);
  });

  return (
    <div dir="rtl">
      <PageHero title="יחידות" icon="🚪" tone="blue"
        subtitle={spaces.length + " יחידות | " + occupied + " מושכרות | " + vacant + " פנויות"}
        actionLabel="+ יחידה" onAction={openNew} />

      {/* Global stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          {label:"מושכרות",value:String(occupied),pct:spaces.length>0?Math.round(occupied/spaces.length*100):0,color:"text-green-700",bg:"bg-green-50"},
          {label:"פנויות",value:String(vacant),pct:spaces.length>0?Math.round(vacant/spaces.length*100):0,color:"text-blue-700",bg:"bg-blue-50"},
          {label:"שטח מושכר",value:Math.round(rentedArea)+' מ"ר',pct:totalArea>0?Math.round(rentedArea/totalArea*100):0,color:"text-slate-700",bg:"bg-white"},
          {label:"שטח כולל",value:Math.round(totalArea)+' מ"ר',pct:100,color:"text-slate-500",bg:"bg-white"},
        ].map(function(k){
          return <div key={k.label} className={"rounded-xl border border-slate-200 p-3 text-center "+k.bg}><div className={"text-xl font-black "+k.color}>{k.value}</div><div className="text-xs text-slate-400">{k.pct}% | {k.label}</div></div>;
        })}
      </div>

      {/* Hierarchy filter + status filter */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <PropertyHierarchyFilter onChange={function(f) { setFilterPropIds(f.propertyIds); }} />
        {[{v:"all",l:"הכל"},{v:"occupied",l:"🟢 מושכר"},{v:"vacant",l:"🔵 פנוי"}].map(function(s){ return <button key={s.v} onClick={function(){setFilterSt(s.v);}} className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>{s.l}</button>; })}
      </div>

      {loading ? <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div> : Object.keys(propGroups).length===0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400"><div className="text-5xl mb-3">🚪</div><div>אין יחידות</div><button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף</button></div>
      ) : (
        <div className="space-y-6">
          {Object.values(propGroups).map(function(group) {
            const propSpaces = group.spaces;
            const propOccupied = propSpaces.filter(unitHeld).length;
            const propVacant = propSpaces.filter(function(s){return s.status==="vacant";}).length;
            const propTotalArea = propSpaces.reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
            const propRentedArea = propSpaces.filter(function(s){return s.status==="occupied";}).reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
            const propDeclaredArea = Number(group.prop.total_area) || 0;

            return (
              <div key={group.prop.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* Property header with stats */}
                <div className="bg-slate-50 border-b border-slate-200 px-5 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-bold text-slate-800">🏢 {group.prop.name}</h3>
                    <span className="text-xs text-slate-400">{propSpaces.length} יחידות</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-lg bg-green-50 border border-green-100 p-2 text-center">
                      <div className="text-sm font-black text-green-700">{propOccupied}</div>
                      <div className="text-[10px] text-green-600">מושכרות</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-center">
                      <div className="text-sm font-black text-blue-700">{propVacant}</div>
                      <div className="text-[10px] text-blue-600">פנויות</div>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-100 p-2 text-center">
                      <div className="text-sm font-black text-slate-700">{Math.round(propRentedArea)} מ"ר</div>
                      <div className="text-[10px] text-slate-400">שטח מושכר</div>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-100 p-2 text-center">
                      <div className="text-sm font-black text-slate-500">{Math.round(propTotalArea)} מ"ר</div>
                      <div className="text-[10px] text-slate-400">שטח יחידות{propDeclaredArea > 0 ? " (נכס: "+Math.round(propDeclaredArea)+")" : ""}</div>
                    </div>
                  </div>
                </div>

                {/* Units grid */}
                <div className="p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {propSpaces.map(function(s) {
                    const ti=typeInfo(s.space_type), tenant=tenantForSpace(s.id);
                    // Held-but-not-started is its own state: not vacant (the
                    // unit is committed) and not simply "מושכר" (no rent yet).
                    const isFuture = !!tenant && !tenant.started;
                    const isOcc = (s.status==="occupied" || !!tenant) && !isFuture;
                    return (
                      <div key={s.id} className={"rounded-xl border p-3 transition-all hover:shadow-md "+(isOcc?"border-green-200 bg-green-50":isFuture?"border-amber-300 bg-amber-50":"border-blue-100 bg-blue-50/50 border-dashed")}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-lg">{ti.icon}</span>
                            <span className="font-bold text-slate-800 text-sm">{s.space_name}</span>
                          </div>
                          <span className={"text-[10px] px-1.5 py-0.5 rounded-full font-semibold "+(isOcc?"bg-green-100 text-green-700":isFuture?"bg-amber-100 text-amber-800":"bg-blue-100 text-blue-700")}>{isOcc?"מושכר":isFuture?"תפוס — חוזה טרם החל":"פנוי"}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mb-1">{ti.l}</div>
                        {s.area&&<div className="text-xs text-slate-500">{s.area} מ"ר{s.floor?" | קומה "+s.floor:""}</div>}
                        {tenant&&<div className={"text-xs font-semibold mt-1 cursor-pointer hover:underline "+(isFuture?"text-amber-800":"text-green-700")} onClick={function(e){e.stopPropagation();router.push("/contracts");}}>👤 {tenant.name}{isFuture?" 🔜":""} <span className="text-[10px] text-green-500">📄</span></div>}
                        <div className="mt-2 flex gap-1">
                          <button onClick={function(){openEdit(s);}} className="flex-1 text-[10px] border border-slate-200 rounded py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                          <button onClick={function(){handleDelete(s.id);}} className="text-[10px] border border-red-200 rounded py-1 px-2 text-red-500 hover:bg-red-50">🗑</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit/Create modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between"><h2 className="font-bold text-slate-800 text-lg">{isNew?"יחידה חדשה":"עריכה"}</h2><button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button></div>
            <div className="p-6 space-y-3">
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label><select value={fPropertyId} onChange={function(e){setFPropertyId(e.target.value);}} className={ic}><option value="">-- בחר --</option>{properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}</select></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">שם *</label><input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">סוג יחידה</label><div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">{SPACE_TYPES.map(function(t){return <button key={t.v} type="button" onClick={function(){setFType(t.v);}} className={"rounded-lg border p-1.5 text-center "+(fType===t.v?"border-blue-500 bg-blue-50":"border-slate-200")}><div>{t.icon}</div><div className={"text-xs "+(fType===t.v?"text-blue-700 font-bold":"text-slate-500")}>{t.l}</div></button>;})}</div></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ"ר)</label><input type="number" value={fArea} onChange={function(e){setFArea(e.target.value);}} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">קומה</label><input type="number" value={fFloor} onChange={function(e){setFFloor(e.target.value);}} className={ic}/></div>
              </div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label><select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}><option value="vacant">פנוי</option><option value="occupied">מושכר</option><option value="maintenance">תחזוקה</option></select></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={2} className={ic} placeholder="הערות..."/></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"שומר...":"שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
