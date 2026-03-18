"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const INSPECTION_TYPES = [
  { v:"fire",        l:"כיבוי אש",       icon:"🔥" },
  { v:"elevator",    l:"מעלית",          icon:"🛗" },
  { v:"electrical",  l:"חשמל",           icon:"⚡" },
  { v:"gas",         l:"גז",             icon:"🔵" },
  { v:"hvac",        l:'מיזוג אוויר',    icon:"❄️" },
  { v:"accessibility",l:"נגישות",        icon:"♿" },
  { v:"structure",   l:"קונסטרוקציה",    icon:"🏗️" },
  { v:"other",       l:"אחר",            icon:"🔒" },
];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function daysLeft(d: string) { return Math.ceil((new Date(d).getTime()-Date.now())/86400000); }

export default function SafetyPage() {
  const [inspections, setInspections] = useState<any[]>([]);
  const [properties,  setProperties]  = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [editingId,   setEditingId]   = useState("");
  const [isNew,       setIsNew]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [filterType,  setFilterType]  = useState("all");
  const [filterProp,  setFilterProp]  = useState("all");

  const [fPropertyId,     setFPropertyId]     = useState("");
  const [fType,           setFType]           = useState("fire");
  const [fInspector,      setFInspector]      = useState("");
  const [fCertNum,        setFCertNum]        = useState("");
  const [fLastDate,       setFLastDate]       = useState("");
  const [fNextDate,       setFNextDate]       = useState("");
  const [fStatus,         setFStatus]         = useState("valid");
  const [fNotes,          setFNotes]          = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: ins }, { data: pr }] = await Promise.all([
      supabase.from("safety_inspections")
        .select("*, properties(name)")
        .order("next_inspection_date"),
      supabase.from("properties").select("id,name").order("name"),
    ]);
    setInspections(ins ?? []);
    setProperties(pr ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFType("fire"); setFInspector(""); setFCertNum("");
    setFLastDate(""); setFNextDate(""); setFStatus("valid"); setFNotes("");
  }

  function openEdit(ins: any) {
    setIsNew(false); setEditingId(ins.id);
    setFPropertyId(ins.property_id??""); setFType(ins.inspection_type??"fire");
    setFInspector(ins.inspector??""); setFCertNum(ins.certificate_number??"");
    setFLastDate(ins.last_inspection_date?.split("T")[0]??"");
    setFNextDate(ins.next_inspection_date?.split("T")[0]??"");
    setFStatus(ins.status??"valid"); setFNotes(ins.notes??"");
  }

  async function handleSave() {
    if (!fPropertyId) { alert("חובה: נכס"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id:           fPropertyId,
        inspection_type:       fType,
        inspector:             fInspector||null,
        certificate_number:    fCertNum||null,
        last_inspection_date:  fLastDate||null,
        next_inspection_date:  fNextDate||null,
        status:                fStatus,
        notes:                 fNotes||null,
      };
      if (isNew) {
        const { data } = await supabase.from("safety_inspections").insert(payload).select().single();
        await logAudit({ entity_type:"safety", entity_id:data.id, action:"create" });
      } else {
        await supabase.from("safety_inspections").update(payload).eq("id", editingId);
        await logAudit({ entity_type:"safety", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק בדיקה?")) return;
    await supabase.from("safety_inspections").delete().eq("id", id);
    await loadAll();
  }

  const filtered = inspections.filter(function(ins) {
    const mt = filterType==="all" || ins.inspection_type===filterType;
    const mp = filterProp==="all" || ins.property_id===filterProp;
    return mt && mp;
  });

  const expiring = inspections.filter(function(ins) {
    return ins.next_inspection_date && daysLeft(ins.next_inspection_date) <= 60 && ins.status!=="expired";
  });
  const expired = inspections.filter(function(ins) { return ins.status==="expired"; });
  const valid   = inspections.filter(function(ins) { return ins.status==="valid"; });

  const typeInfo = function(v: string) {
    return INSPECTION_TYPES.find(function(t){return t.v===v;}) ?? INSPECTION_TYPES[7];
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">בדיקות בטיחות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {valid.length} תקינות
            {expiring.length > 0 && <span className="text-yellow-600 font-semibold"> | {expiring.length} פגות ב-60 יום</span>}
            {expired.length > 0 && <span className="text-red-600 font-semibold"> | {expired.length} פגו!</span>}
          </p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + בדיקה חדשה
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          {label:"תקינות",       value:valid.length,    color:"text-green-700",  bg:"bg-green-50",   border:"border-green-200"  },
          {label:"פגות ב-60י",  value:expiring.length, color:"text-yellow-700", bg:"bg-yellow-50",  border:"border-yellow-200" },
          {label:"פגו!",         value:expired.length,  color:"text-red-700",   bg:expired.length>0?"bg-red-50":"bg-white",    border:expired.length>0?"border-red-200":"border-slate-200" },
          {label:"סה\"כ",        value:inspections.length, color:"text-slate-600", bg:"bg-white",   border:"border-slate-200"  },
        ].map(function(k) {
          return (
            <div key={k.label} className={"rounded-xl border p-3 text-center " + k.bg + " " + k.border}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
            </div>
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
        {[{v:"all",l:"הכל"}, ...INSPECTION_TYPES.map(function(t){return {v:t.v,l:t.icon+" "+t.l};})].map(function(f) {
          return (
            <button key={f.v} onClick={function(){setFilterType(f.v);}}
              className={"rounded-xl border px-2.5 py-1.5 text-xs font-semibold " +
                (filterType===f.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {f.l}
            </button>
          );
        })}
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🔒</div><div>אין בדיקות בטיחות</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף בדיקה</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">סוג</th>
                <th className="px-4 py-3 font-semibold text-slate-700">נכס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">מפקח</th>
                <th className="px-4 py-3 font-semibold text-slate-700">בדיקה אחרונה</th>
                <th className="px-4 py-3 font-semibold text-slate-700">בדיקה הבאה</th>
                <th className="px-4 py-3 font-semibold text-slate-700">סטטוס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(ins) {
                const ti   = typeInfo(ins.inspection_type);
                const d    = ins.next_inspection_date ? daysLeft(ins.next_inspection_date) : null;
                const rowBg = ins.status==="expired" ? "bg-red-50" : d!==null&&d<=30 ? "bg-orange-50" : d!==null&&d<=60 ? "bg-yellow-50" : "hover:bg-slate-50";
                return (
                  <tr key={ins.id} className={"border-t border-slate-100 " + rowBg}>
                    <td className="px-4 py-3">
                      <span className="text-xl">{ti.icon}</span>
                      <span className="text-xs font-semibold text-slate-700 mr-1">{ti.l}</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{ins.properties?.name}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{ins.inspector || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(ins.last_inspection_date)}</td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-slate-700">{fmtDate(ins.next_inspection_date)}</div>
                      {d!==null && d<=60 && ins.status!=="expired" && (
                        <div className={"text-xs font-bold " + (d<=0?"text-red-600":d<=30?"text-orange-600":"text-yellow-600")}>
                          {d<=0 ? "פג!" : d+" יום"}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (ins.status==="valid"?"bg-green-100 text-green-700":ins.status==="expired"?"bg-red-100 text-red-700":"bg-yellow-100 text-yellow-700")}>
                        {ins.status==="valid"?"תקינה":ins.status==="expired"?"פגה":"בהמתנה"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={function(){openEdit(ins);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">✏️</button>
                        <button onClick={function(){handleDelete(ins.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew?"בדיקה חדשה":"עריכת בדיקה"}</h2>
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
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג בדיקה</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {INSPECTION_TYPES.map(function(t) {
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מפקח</label>
                  <input type="text" value={fInspector} onChange={function(e){setFInspector(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר תעודה</label>
                  <input type="text" value={fCertNum} onChange={function(e){setFCertNum(e.target.value);}} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בדיקה אחרונה</label>
                  <input type="date" value={fLastDate} onChange={function(e){setFLastDate(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בדיקה הבאה</label>
                  <input type="date" value={fNextDate} onChange={function(e){setFNextDate(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}>
                  <option value="valid">תקינה</option>
                  <option value="pending">בהמתנה</option>
                  <option value="expired">פגה</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} />
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
