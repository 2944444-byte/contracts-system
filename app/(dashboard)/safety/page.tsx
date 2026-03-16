"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const INSPECTION_TYPES = [
  { v: "fire_extinguisher",  l: "מטפים",           icon: "🧯" },
  { v: "fire_alarm",         l: "גלאי עשן",         icon: "🔔" },
  { v: "sprinkler",          l: "ספרינקלרים",       icon: "💧" },
  { v: "emergency_exit",     l: "יציאות חירום",     icon: "🚪" },
  { v: "elevator",           l: "מעלית",            icon: "🛗" },
  { v: "electrical",         l: "חשמל",             icon: "⚡" },
  { v: "generator",          l: "גנרטור",           icon: "🔋" },
  { v: "other",              l: "אחר",              icon: "🔒" },
];

function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function SafetyPage() {
  const [inspections, setInspections] = useState<any[]>([]);
  const [properties,  setProperties]  = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [editingId,   setEditingId]   = useState("");
  const [isNew,       setIsNew]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [filterProp,  setFilterProp]  = useState("all");
  const [filterSt,    setFilterSt]    = useState("all");

  const [fPropertyId,       setFPropertyId]       = useState("");
  const [fType,             setFType]             = useState("fire_extinguisher");
  const [fStatus,           setFStatus]           = useState("pending");
  const [fLastDate,         setFLastDate]         = useState("");
  const [fNextDate,         setFNextDate]         = useState("");
  const [fInspector,        setFInspector]        = useState("");
  const [fCertificateNum,   setFCertificateNum]   = useState("");
  const [fNotes,            setFNotes]            = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: ins }, { data: pr }] = await Promise.all([
      supabase.from("safety_inspections")
        .select("*, properties(name)")
        .order("next_inspection_date", { ascending: true }),
      supabase.from("properties").select("id, name").order("name"),
    ]);
    setInspections(ins ?? []);
    setProperties(pr ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFType("fire_extinguisher"); setFStatus("pending");
    setFLastDate(""); setFNextDate(""); setFInspector(""); setFCertificateNum(""); setFNotes("");
  }

  function openEdit(ins: any) {
    setIsNew(false); setEditingId(ins.id);
    setFPropertyId(ins.property_id ?? ""); setFType(ins.inspection_type ?? "fire_extinguisher");
    setFStatus(ins.status ?? "pending"); setFLastDate(ins.last_inspection_date?.split("T")[0] ?? "");
    setFNextDate(ins.next_inspection_date?.split("T")[0] ?? ""); setFInspector(ins.inspector ?? "");
    setFCertificateNum(ins.certificate_number ?? ""); setFNotes(ins.notes ?? "");
  }

  async function handleSave() {
    if (!fPropertyId) { alert("חובה: נכס"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id:          fPropertyId,
        inspection_type:      fType,
        status:               fStatus,
        last_inspection_date: fLastDate || null,
        next_inspection_date: fNextDate || null,
        inspector:            fInspector || null,
        certificate_number:   fCertificateNum || null,
        notes:                fNotes || null,
      };
      if (isNew) {
        const { data } = await supabase.from("safety_inspections").insert(payload).select().single();
        await logAudit({ entity_type: "safety", entity_id: data.id, action: "create" });
        // צור התראה אם קרוב
        if (fNextDate && daysLeft(fNextDate) <= 60) {
          await supabase.from("alerts").insert({
            title: "בדיקת בטיחות קרובה: " + typeInfo(fType).l,
            severity: daysLeft(fNextDate) <= 30 ? "urgent" : "warning",
            due_date: fNextDate, entity_type: "safety", status: "open",
          });
        }
      } else {
        await supabase.from("safety_inspections").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "safety", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function markCompleted(id: string) {
    const today = new Date().toISOString().split("T")[0];
    await supabase.from("safety_inspections").update({
      status: "completed",
      last_inspection_date: today,
    }).eq("id", id);
    await logAudit({ entity_type: "safety", entity_id: id, action: "completed" });
    await loadAll();
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק בדיקה?")) return;
    await supabase.from("safety_inspections").delete().eq("id", id);
    await loadAll();
  }

  const typeInfo = function(v: string) {
    return INSPECTION_TYPES.find(function(t) { return t.v === v; }) ?? INSPECTION_TYPES[7];
  };

  const filtered = inspections.filter(function(ins) {
    const mp = filterProp === "all" || ins.property_id === filterProp;
    const ms = filterSt === "all" || ins.status === filterSt ||
      (filterSt === "urgent" && ins.next_inspection_date && daysLeft(ins.next_inspection_date) <= 30 && ins.status !== "completed") ||
      (filterSt === "overdue" && ins.next_inspection_date && daysLeft(ins.next_inspection_date) < 0 && ins.status !== "completed");
    return mp && ms;
  });

  const overdue   = inspections.filter(function(i) { return i.next_inspection_date && daysLeft(i.next_inspection_date) < 0  && i.status !== "completed"; }).length;
  const urgent30  = inspections.filter(function(i) { return i.next_inspection_date && daysLeft(i.next_inspection_date) <= 30 && daysLeft(i.next_inspection_date) >= 0 && i.status !== "completed"; }).length;
  const completed = inspections.filter(function(i) { return i.status === "completed"; }).length;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">בדיקות בטיחות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {inspections.length} בדיקות
            {overdue  > 0 && <span className="text-red-600 font-bold"> | {overdue} באיחור!</span>}
            {urgent30 > 0 && <span className="text-orange-600 font-semibold"> | {urgent30} ב-30 יום</span>}
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + בדיקה חדשה
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "באיחור!",    value: overdue,   bg: overdue>0?"bg-red-50":"bg-white",    border: overdue>0?"border-red-200":"border-slate-200",    color: overdue>0?"text-red-700":"text-slate-400",    filter: "overdue"   },
          { label: "ב-30 יום",  value: urgent30,  bg: urgent30>0?"bg-orange-50":"bg-white", border: urgent30>0?"border-orange-200":"border-slate-200", color: urgent30>0?"text-orange-700":"text-slate-400", filter: "urgent"    },
          { label: "הושלמו",    value: completed, bg: "bg-green-50",  border: "border-green-100",  color: "text-green-700",  filter: "completed" },
          { label: "סה\"כ",     value: inspections.length, bg: "bg-white", border: "border-slate-200", color: "text-slate-700", filter: "all" },
        ].map(function(k) {
          return (
            <button key={k.label} onClick={function(){setFilterSt(filterSt===k.filter?"all":k.filter);}}
              className={"rounded-xl border p-3 text-center transition-all " + k.bg + " " + k.border +
                (filterSt===k.filter?" ring-2 ring-blue-400":"")}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
            </button>
          );
        })}
      </div>

      {/* פילטר נכס */}
      <div className="mb-4">
        <select value={filterProp} onChange={function(e){setFilterProp(e.target.value);}}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="all">כל הנכסים</option>
          {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
        </select>
      </div>

      {/* רשימה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🔒</div><div>אין בדיקות בטיחות</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">נכס</th>
                <th className="px-4 py-3 font-semibold">בדיקה אחרונה</th>
                <th className="px-4 py-3 font-semibold">בדיקה הבאה</th>
                <th className="px-4 py-3 font-semibold">ימים</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(ins) {
                const ti = typeInfo(ins.inspection_type);
                const d  = ins.next_inspection_date ? daysLeft(ins.next_inspection_date) : null;
                const isCompleted = ins.status === "completed";
                const rowColor = isCompleted ? "opacity-60" : d !== null && d < 0 ? "bg-red-50" : d !== null && d <= 30 ? "bg-orange-50" : d !== null && d <= 60 ? "bg-yellow-50" : "hover:bg-slate-50";
                return (
                  <tr key={ins.id} className={"border-t border-slate-100 " + rowColor}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{ti.icon}</span>
                        <span className="font-semibold text-slate-800">{ti.l}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{ins.properties?.name}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(ins.last_inspection_date)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(ins.next_inspection_date)}</td>
                    <td className="px-4 py-3">
                      {d !== null && !isCompleted && (
                        <span className={"font-bold text-sm " +
                          (d < 0 ? "text-red-600" : d <= 30 ? "text-orange-600" : d <= 60 ? "text-yellow-600" : "text-slate-500")}>
                          {d < 0 ? "פג לפני " + Math.abs(d) + " י" : d + " י"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (isCompleted ? "bg-green-100 text-green-700" : d !== null && d < 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600")}>
                        {isCompleted ? "✓ בוצע" : d !== null && d < 0 ? "באיחור" : "ממתין"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {!isCompleted && (
                          <button onClick={function(){markCompleted(ins.id);}}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 font-semibold">
                            ✓ בוצע
                          </button>
                        )}
                        <button onClick={function(){openEdit(ins);}}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                        <button onClick={function(){handleDelete(ins.id);}}
                          className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "בדיקה חדשה" : "עריכת בדיקה"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={fPropertyId} onChange={function(e){setFPropertyId(e.target.value);}} className={ic}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג בדיקה</label>
                <div className="grid grid-cols-4 gap-2">
                  {INSPECTION_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFType(t.v);}}
                        className={"rounded-lg border p-2 text-center " +
                          (fType===t.v ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType===t.v ? "text-blue-700" : "text-slate-600")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בדיקה אחרונה</label>
                  <input type="date" value={fLastDate} onChange={function(e){setFLastDate(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בדיקה הבאה</label>
                  <input type="date" value={fNextDate} onChange={function(e){setFNextDate(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בודק מוסמך</label>
                  <input type="text" value={fInspector} onChange={function(e){setFInspector(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר תעודה</label>
                  <input type="text" value={fCertificateNum} onChange={function(e){setFCertificateNum(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}>
                  <option value="pending">ממתין</option>
                  <option value="scheduled">מתוזמן</option>
                  <option value="completed">בוצע</option>
                  <option value="overdue">באיחור</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={2} className={ic} />
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
