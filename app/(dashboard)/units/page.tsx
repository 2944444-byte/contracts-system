"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
const SPACE_TYPES = [{v:"office",l:"××©×¨×",icon:"ð¼"},{v:"store",l:"×× ××ª",icon:"ðª"},{v:"warehouse",l:"×××¡×",icon:"ð¦"},{v:"clinic",l:"×§××× ××§×",icon:"ð¥"},{v:"other",l:"×××¨",icon:"ðª"}];

export default function UnitsPage() {
  const [spaces,     setSpaces]     = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterProp, setFilterProp] = useState("all");
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
      supabase.from("spaces").select("*, properties(name)").order("space_name"),
      supabase.from("properties").select("id,name").order("space_name"),
      supabase.from("contracts").select("id,tenant_id,tenants(name),contract_spaces(space_id)").in("status",["active","expiring","extended"]),
    ]);
    setSpaces(sp??[]); setProperties(pr??[]); setContracts(c??[]); setLoading(false);
  }

  function openNew() { setIsNew(true); setEditingId("new"); setFPropertyId(""); setFName(""); setFType("office"); setFArea(""); setFFloor(""); setFStatus("vacant"); setFNotes(""); }
  function openEdit(s: any) { setIsNew(false); setEditingId(s.id); setFPropertyId(s.property_id??""); setFName(s.name??""); setFType(s.space_type??"office"); setFArea(s.area?.toString()??""); setFFloor(s.floor?.toString()??""); setFStatus(s.status??"vacant"); setFNotes(s.notes??""); }

  async function handleSave() {
    if (!fPropertyId||!fName.trim()) { alert("××××: × ××¡ + ×©×"); return; }
    setSaving(true);
    try {
      const payload={property_id:fPropertyId,name:fName.trim(),space_type:fType,area:fArea?Number(fArea):null,floor:fFloor?Number(fFloor):null,status:fStatus,notes:fNotes||null};
      if (isNew) { const { data } = await supabase.from("spaces").insert(payload).select().single(); await logAudit({entity_type:"space",entity_id:data.id,action:"create"}); }
      else { await supabase.from("spaces").update(payload).eq("id",editingId); }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("×©××××: "+e?.message); }
    finally { setSaving(false); }
  }

  function tenantForSpace(spaceId: string) {
    for (const c of contracts) { if ((c.contract_spaces??[]).some(function(cs:any){return cs.space_id===spaceId;})) return c.tenants?.name??null; }
    return null;
  }

  const filtered = spaces.filter(function(s){ return (filterProp==="all"||s.property_id===filterProp)&&(filterSt==="all"||s.status===filterSt); });
  const vacant=spaces.filter(function(s){return s.status==="vacant";}).length;
  const occupied=spaces.filter(function(s){return s.status==="occupied";}).length;
  const totalArea=spaces.reduce(function(s,sp){return s+(sp.area??0);},0);
  const typeInfo=function(v:string){return SPACE_TYPES.find(function(t){return t.v===v;})??SPACE_TYPES[4];};

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between"><div><h1 className="text-3xl font-bold text-slate-800">××××××ª</h1><p className="text-sm text-slate-500 mt-1">{spaces.length} ××××××ª | {occupied} ×××©××¨××ª | {vacant} ×¤× ××××ª</p></div><button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">+ ×××××</button></div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[{label:"×××©××¨××ª",value:occupied,pct:spaces.length>0?Math.round(occupied/spaces.length*100):0,color:"text-green-700",bg:"bg-green-50",f:"occupied"},{label:"×¤× ××××ª",value:vacant,pct:spaces.length>0?Math.round(vacant/spaces.length*100):0,color:"text-blue-700",bg:"bg-blue-50",f:"vacant"},{label:'×©×× ×××××¨',value:spaces.filter(function(s){return s.status==="occupied";}).reduce(function(s,sp){return s+(sp.area??0);},0)+' ×"×¨',pct:totalArea>0?Math.round(spaces.filter(function(s){return s.status==="occupied";}).reduce(function(s,sp){return s+(sp.area??0);},0)/totalArea*100):0,color:"text-slate-700",bg:"bg-white",f:"occupied"},{label:'×©×× ××××',value:totalArea+' ×"×¨',pct:100,color:"text-slate-500",bg:"bg-white",f:"all"}].map(function(k){
          return <button key={k.label} onClick={function(){setFilterSt(filterSt===k.f?"all":k.f);}} className={"rounded-xl border p-3 text-center transition-all "+k.bg+(filterSt===k.f?" border-blue-500 ring-2 ring-blue-300":" border-slate-200")}><div className={"text-xl font-black "+k.color}>{k.value}</div><div className="text-xs text-slate-400">{k.pct}% | {k.label}</div></button>;
        })}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={filterProp} onChange={function(e){setFilterProp(e.target.value);}} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="all">×× ×× ××¡××</option>{properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
        </select>
        {[{v:"all",l:"×××"},{v:"occupied",l:"ð¢ ×××©××¨"},{v:"vacant",l:"ðµ ×¤× ××"}].map(function(s){ return <button key={s.v} onClick={function(){setFilterSt(s.v);}} className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>{s.l}</button>; })}
      </div>

      {loading ? <div className="text-center py-12 text-slate-400">×××¢×...</div> : filtered.length===0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400"><div className="text-5xl mb-3">ðª</div><div>××× ××××××ª</div><button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ ×××¡×£</button></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(function(s) {
            const ti=typeInfo(s.space_type), tenant=tenantForSpace(s.id), isOcc=s.status==="occupied";
            return (
              <div key={s.id} className={"rounded-xl border p-4 transition-all hover:shadow-md "+(isOcc?"border-green-200 bg-green-50":"border-blue-100 bg-blue-50 border-dashed")}>
                <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><span className="text-xl">{ti.icon}</span><span className="font-bold text-slate-800 text-sm">{s.name}</span></div><span className={"text-xs px-1.5 py-0.5 rounded-full font-semibold "+(isOcc?"bg-green-100 text-green-700":"bg-blue-100 text-blue-700")}>{isOcc?"×××©××¨":"×¤× ××"}</span></div>
                <div className="text-xs text-slate-400 mb-1">{s.properties?.name}</div>
                {s.area&&<div className="text-xs text-slate-500">{s.area} ×"×¨{s.floor?" | ×§××× "+s.floor:""}</div>}
                {tenant&&<div className="text-xs text-green-700 font-semibold mt-1">ð¤ {tenant}</div>}
                <button onClick={function(){openEdit(s);}} className="mt-2 w-full text-xs border border-slate-200 rounded py-1 text-slate-600 hover:bg-slate-50">×¢×¨×××</button>
              </div>
            );
          })}
        </div>
      )}

      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between"><h2 className="font-bold text-slate-800 text-lg">{isNew?"××××× ×××©×":"×¢×¨×××"}</h2><button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">Ã</button></div>
            <div className="p-6 space-y-3">
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">× ××¡ *</label><select value={fPropertyId} onChange={function(e){setFPropertyId(e.target.value);}} className={ic}><option value="">-- ×××¨ --</option>{properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}</select></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">×©× *</label><input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic}/></div>
              <div><div className="grid grid-cols-5 gap-1.5">{SPACE_TYPES.map(function(t){return <button key={t.v} type="button" onClick={function(){setFType(t.v);}} className={"rounded-lg border p-1.5 text-center "+(fType===t.v?"border-blue-500 bg-blue-50":"border-slate-200")}><div>{t.icon}</div><div className={"text-xs "+(fType===t.v?"text-blue-700 font-bold":"text-slate-500")}>{t.l}</div></button>;})}</div></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">×©×× (×"×¨)</label><input type="number" value={fArea} onChange={function(e){setFArea(e.target.value);}} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">×§×××</label><input type="number" value={fFloor} onChange={function(e){setFFloor(e.target.value);}} className={ic}/></div>
              </div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">×¡××××¡</label><select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}><option value="vacant">×¤× ××</option><option value="occupied">×××©××¨</option><option value="maintenance">×ª××××§×</option></select></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">×××××</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"×©×××¨...":"×©×××¨"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
