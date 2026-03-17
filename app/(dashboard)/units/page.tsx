"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const SPACE_TYPES = [
  { v:"office",    l:"משרד",       icon:"💼" },
  { v:"store",     l:"חנות",       icon:"🏪" },
  { v:"warehouse", l:"מחסן",       icon:"📦" },
  { v:"clinic",    l:"קליניקה",    icon:"🏥" },
  { v:"other",     l:"אחר",        icon:"🚪" },
];

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

  const [fPropertyId, setFPropertyId] = useState("");
  const [fName,       setFName]       = useState("");
  const [fType,       setFType]       = useState("office");
  const [fArea,       setFArea]       = useState("");
  const [fFloor,      setFFloor]      = useState("");
  const [fStatus,     setFStatus]     = useState("vacant");
  const [fNotes,      setFNotes]      = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: sp }, { data: pr }, { data: c }] = await Promise.all([
      supabase.from("spaces").select("*, properties(name)").order("properties(name)").order("name"),
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("contracts")
        .select("id, tenant_id, tenants(name), contract_spaces(space_id)")
        .in("status",["active","expiring","extended"]),
    ]);
    setSpaces(sp ?? []);
    setProperties(pr ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFName(""); setFType("office"); setFArea(""); setFFloor(""); setFStatus("vacant"); setFNotes("");
  }

  function openEdit(s: any) {
    setIsNew(false); setEditingId(s.id);
    setFPropertyId(s.property_id??""); setFName(s.name??""); setFType(s.space_type??"office");
    setFArea(s.area?.toString()??""); setFFloor(s.floor?.toString()??""); setFStatus(s.status??"vacant"); setFNotes(s.notes??"");
  }

  async function handleSave() {
    if (!fPropertyId || !fName.trim()) { alert("חובה: נכס + שם"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id: fPropertyId, name: fName.trim(),
        space_type: fType, area: fArea ? Number(fArea) : null,
        floor: fFloor ? Number(fFloor) : null, status: fStatus, notes: fNotes||null,
      };
      if (isNew) {
        const { data } = await supabase.from("spaces").insert(payload).select().single();
        await logAudit({ entity_type:"space", entity_id:data.id, action:"create" });
      } else {
        await supabase.from("spaces").update(payload).eq("id", editingId);
        await logAudit({ entity_type:"space", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק יחידה?")) return;
    await supabase.from("spaces").delete().eq("id", id);
    await loadAll();
  }

  // מצא שוכר לפי חדר
  function tenantForSpace(spaceId: string): string | null {
    for (const c of contracts) {
      if ((c.contract_spaces??[]).some(function(cs:any){return cs.space_id===spaceId;})) {
        return c.tenants?.name ?? null;
      }
    }
    return null;
  }

  const filtered = spaces.filter(function(s) {
    const mp = filterProp==="all" || s.property_id===filterProp;
    const ms = filterSt==="all" || s.status===filterSt;
    return mp && ms;
  });

  const vacant   = spaces.filter(function(s){return s.status==="vacant";}).length;
  const occupied = spaces.filter(function(s){return s.status==="occupied";}).length;
  const totalArea = spaces.reduce(function(s,sp){return s+(sp.area??0);},0);
  const occArea   = spaces.filter(function(s){return s.status==="occupied";}).reduce(function(s,sp){return s+(sp.area??0);},0);

  const typeInfo = function(v: string) { return SPACE_TYPES.find(function(t){return t.v===v;})??SPACE_TYPES[4]; };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">יחידות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {spaces.length} יחידות | {occupied} מושכרות | {vacant} פנויות
          </p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + יחידה חדשה
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label:"מושכרות", value:occupied, pct:spaces.length>0?Math.round(occupied/spaces.length*100):0, color:"text-green-700", bg:"bg-green-50", border:"border-green-200", filter:"occupied"  },
          { label:"פנויות",  value:vacant,   pct:spaces.length>0?Math.round(vacant/spaces.length*100):0,   color:"text-blue-700",  bg:"bg-blue-50",  border:"border-blue-200",  filter:"vacant"    },
          { label:"שטח מוחכר",value:occArea+" מ\"ר", pct:totalArea>0?Math.round(occArea/totalArea*100):0, color:"text-slate-700", bg:"bg-white", border:"border-slate-200", filter:"occupied" },
          { label:"סה\"כ שטח",value:totalArea+" מ\"ר", pct:100, color:"text-slate-600", bg:"bg-white", border:"border-slate-200", filter:"all" },
        ].map(function(k) {
          return (
            <button key={k.label} onClick={function(){setFilterSt(filterSt===k.filter?"all":k.filter);}}
              className={"rounded-xl border p-3 text-center transition-all " + k.bg + " " + k.border +
                (filterSt===k.filter?" ring-2 ring-blue-400":"")}>
              <div className={"text-xl font-black " + k.color}>{k.value}</div>
              <div className="text-xs text-slate-400">{k.pct}% | {k.label}</div>
            </button>
          );
        })}
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={filterProp} onChange={function(e){setFilterProp(e.target.value);}}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="all">כל הנכסים</option>
          {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
        </select>
        {[{v:"all",l:"הכל"},{v:"occupied",l:"🟢 מושכר"},{v:"vacant",l:"🔵 פנוי"}].map(function(s) {
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {s.l}
            </button>
          );
        })}
      </div>

      {/* גריד */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🚪</div><div>אין יחידות</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף יחידה</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(function(s) {
            const ti      = typeInfo(s.space_type);
            const tenant  = tenantForSpace(s.id);
            const isOcc   = s.status==="occupied";
            return (
              <div key={s.id} className={"rounded-xl border p-4 transition-all hover:shadow-md " +
                (isOcc ? "border-green-200 bg-green-50" : "border-blue-100 bg-blue-50 border-dashed")}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{ti.icon}</span>
                    <span className="font-bold text-slate-800 text-sm">{s.name}</span>
                  </div>
                  <span className={"text-xs px-1.5 py-0.5 rounded-full font-semibold " +
                    (isOcc?"bg-green-100 text-green-700":"bg-blue-100 text-blue-700")}>
                    {isOcc?"מושכר":"פנוי"}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mb-1">{s.properties?.name}</div>
                {s.area && <div className="text-xs text-slate-500">{s.area} מ"ר{s.floor ? " | קומה "+s.floor : ""}</div>}
                {tenant && <div className="text-xs text-green-700 font-semibold mt-1">👤 {tenant}</div>}
                <div className="flex gap-1 mt-2">
                  <button onClick={function(){openEdit(s);}} className="flex-1 text-xs border border-slate-200 rounded py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                  <button onClick={function(){handleDelete(s.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "יחידה חדשה" : "עריכת יחידה"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={fPropertyId} onChange={function(e){setFPropertyId(e.target.value);}} className={ic}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם יחידה *</label>
                <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} placeholder="קומה 2 / חנות 3" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {SPACE_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFType(t.v);}}
                        className={"rounded-lg border p-1.5 text-center " + (fType===t.v?"border-blue-500 bg-blue-50":"border-slate-200")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs " + (fType===t.v?"text-blue-700 font-bold":"text-slate-500")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ"ר)</label>
                  <input type="number" value={fArea} onChange={function(e){setFArea(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">קומה</label>
                  <input type="number" value={fFloor} onChange={function(e){setFFloor(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}>
                  <option value="vacant">פנוי</option>
                  <option value="occupied">מושכר</option>
                  <option value="maintenance">בתחזוקה</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
