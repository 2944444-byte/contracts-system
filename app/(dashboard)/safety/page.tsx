"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const INSPECTION_TYPES = [
  { value: "fire",          label: "כיבוי אש",       icon: "🔥", interval: 12 },
  { value: "elevator",      label: "מעלית",          icon: "🛗", interval: 6  },
  { value: "electrical",    label: "חשמל",           icon: "⚡", interval: 12 },
  { value: "generator",     label: "גנרטור",         icon: "🔋", interval: 6  },
  { value: "hvac",          label: "מיזוג / HVAC",   icon: "❄️", interval: 12 },
  { value: "accessibility", label: "נגישות",         icon: "♿", interval: 24 },
  { value: "building",      label: "בדיקת מבנה",    icon: "🏗️", interval: 12 },
  { value: "other",         label: "אחר",            icon: "📋", interval: 12 },
];

function daysLeft(d: string) {
  if (!d) return 999;
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
  const [filterType,  setFilterType]  = useState("all");

  const [fPropertyId,    setFPropertyId]    = useState("");
  const [fType,          setFType]          = useState("fire");
  const [fLastDate,      setFLastDate]      = useState("");
  const [fNextDate,      setFNextDate]      = useState("");
  const [fStatus,        setFStatus]        = useState("pending");
  const [fInspector,     setFInspector]     = useState("");
  const [fCertNum,       setFCertNum]       = useState("");
  const [fNotes,         setFNotes]         = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: ins }, { data: props }] = await Promise.all([
      supabase.from("safety_inspections")
        .select("*, properties(name)")
        .order("next_inspection_date", { ascending: true }),
      supabase.from("properties").select("id,name").order("name"),
    ]);
    setInspections(ins ?? []);
    setProperties(props ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFType("fire"); setFLastDate(""); setFNextDate("");
    setFStatus("pending"); setFInspector(""); setFCertNum(""); setFNotes("");
  }

  function openEdit(ins: any) {
    setIsNew(false); setEditingId(ins.id);
    setFPropertyId(ins.property_id ?? ""); setFType(ins.inspection_type ?? "fire");
    setFLastDate(ins.last_inspection_date?.split("T")[0] ?? "");
    setFNextDate(ins.next_inspection_date?.split("T")[0] ?? "");
    setFStatus(ins.status ?? "pending"); setFInspector(ins.inspector_name ?? "");
    setFCertNum(ins.certificate_number ?? ""); setFNotes(ins.notes ?? "");
  }

  function calcNextDate(lastDate: string, typeVal: string) {
    if (!lastDate) return;
    const t = INSPECTION_TYPES.find(function(x) { return x.value === typeVal; });
    const months = t?.interval ?? 12;
    const d = new Date(lastDate);
    d.setMonth(d.getMonth() + months);
    setFNextDate(d.toISOString().split("T")[0]);
  }

  async function handleSave() {
    if (!fPropertyId) { alert("חובה: נכס"); return; }
    if (!fNextDate)   { alert("חובה: תאריך בדיקה הבאה"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id:            fPropertyId,
        inspection_type:        fType,
        last_inspection_date:   fLastDate || null,
        next_inspection_date:   fNextDate,
        status:                 fStatus,
        inspector_name:         fInspector || null,
        certificate_number:     fCertNum || null,
        notes:                  fNotes || null,
      };
      if (isNew) {
        const { data } = await supabase.from("safety_inspections").insert(payload).select().single();
        await logAudit({ entity_type: "safety", entity_id: data.id, action: "create" });
        // צור התראה אם בתוך 30 יום
        if (daysLeft(fNextDate) <= 30) {
          await supabase.from("alerts").insert({
            title: "בדיקת בטיחות קרובה — " + (properties.find(function(p) { return p.id === fPropertyId; })?.name ?? ""),
            alert_type: "safety_inspection", priority: "high",
            related_entity_type: "property", related_entity_id: fPropertyId, is_handled: false,
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

  async function markDone(id: string) {
    const today = new Date().toISOString().split("T")[0];
    await supabase.from("safety_inspections").update({ status: "completed", last_inspection_date: today }).eq("id", id);
    await logAudit({ entity_type: "safety", entity_id: id, action: "mark_complete" });
    await loadAll();
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק?")) return;
    await supabase.from("safety_inspections").delete().eq("id", id);
    await loadAll();
  }

  function statusBadge(ins: any) {
    if (ins.status === "completed") return { label: "✓ בוצע", bg: "bg-green-100", color: "text-green-700" };
    const d = daysLeft(ins.next_inspection_date);
    if (d < 0)   return { label: "באיחור!",   bg: "bg-red-100",    color: "text-red-700"    };
    if (d <= 14)  return { label: d + " ימים", bg: "bg-red-100",    color: "text-red-700"    };
    if (d <= 30)  return { label: d + " ימים", bg: "bg-yellow-100", color: "text-yellow-700" };
    if (d <= 60)  return { label: d + " ימים", bg: "bg-orange-100", color: "text-orange-700" };
    return             { label: "תקין",      bg: "bg-green-100",  color: "text-green-700"  };
  }

  const typeInfo = function(v: string) {
    return INSPECTION_TYPES.find(function(t) { return t.value === v; }) ?? INSPECTION_TYPES[7];
  };

  const filtered = inspections.filter(function(ins) {
    const mp = filterProp === "all" || ins.property_id === filterProp;
    const mt = filterType === "all" || ins.inspection_type === filterType;
    return mp && mt;
  });

  const urgentCount = inspections.filter(function(i) {
    return i.status !== "completed" && daysLeft(i.next_inspection_date) <= 30;
  }).length;
  const overdueCount = inspections.filter(function(i) {
    return i.status !== "completed" && daysLeft(i.next_inspection_date) < 0;
  }).length;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">בטיחות ורישיונות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {overdueCount > 0 && <span className="text-red-600 font-semibold">{overdueCount} באיחור | </span>}
            {urgentCount > 0 && <span className="text-yellow-600 font-semibold">{urgentCount} עד 30 יום | </span>}
            {inspections.length} בדיקות במעקב
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + בדיקה חדשה
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {INSPECTION_TYPES.slice(0,4).map(function(t) {
          const cnt = inspections.filter(function(i) { return i.inspection_type === t.value; }).length;
          const urgent = inspections.filter(function(i) {
            return i.inspection_type === t.value && i.status !== "completed" && daysLeft(i.next_inspection_date) <= 30;
          }).length;
          return (
            <button key={t.value} onClick={function() { setFilterType(filterType === t.value ? "all" : t.value); }}
              className={"rounded-xl border p-3 text-center transition-all " +
                (filterType === t.value ? "border-blue-500 bg-blue-50" :
                  urgent > 0 ? "border-yellow-200 bg-yellow-50" : "border-slate-200 bg-white hover:bg-slate-50")}>
              <div className="text-2xl">{t.icon}</div>
              <div className="text-xs font-semibold text-slate-700 mt-1">{t.label}</div>
              <div className="text-lg font-black text-slate-800">{cnt}</div>
              {urgent > 0 && <div className="text-xs text-yellow-600 font-bold">{urgent} דחוף</div>}
            </button>
          );
        })}
      </div>

      {/* פילטרים */}
      <div className="mb-4 flex gap-3 flex-wrap">
        <select value={filterProp} onChange={function(e) { setFilterProp(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
          <option value="all">כל הנכסים</option>
          {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
        </select>
        <select value={filterType} onChange={function(e) { setFilterType(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
          <option value="all">כל סוגי הבדיקות</option>
          {INSPECTION_TYPES.map(function(t) { return <option key={t.value} value={t.value}>{t.icon} {t.label}</option>; })}
        </select>
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🔒</div>
          <div>אין בדיקות בטיחות</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף בדיקה</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">סוג בדיקה</th>
                <th className="px-4 py-3 font-semibold">נכס</th>
                <th className="px-4 py-3 font-semibold">בוצע לאחרונה</th>
                <th className="px-4 py-3 font-semibold">הבא ב</th>
                <th className="px-4 py-3 font-semibold">מבצע</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(ins) {
                const sb = statusBadge(ins);
                const ti = typeInfo(ins.inspection_type);
                const d  = daysLeft(ins.next_inspection_date);
                return (
                  <tr key={ins.id} className={"border-t border-slate-100 " +
                    (ins.status !== "completed" && d < 0 ? "bg-red-50" :
                      ins.status !== "completed" && d <= 30 ? "bg-yellow-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + sb.bg + " " + sb.color}>
                        {sb.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-base ml-1">{ti.icon}</span>
                      <span className="text-xs text-slate-700">{ti.label}</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{ins.properties?.name}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(ins.last_inspection_date)}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{fmtDate(ins.next_inspection_date)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{ins.inspector_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {ins.status !== "completed" && (
                          <button onClick={function() { markDone(ins.id); }}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 font-semibold">
                            ✓ בוצע
                          </button>
                        )}
                        <button onClick={function() { openEdit(ins); }}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                        <button onClick={function() { handleDelete(ins.id); }}
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

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "בדיקה חדשה" : "עריכת בדיקה"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={fPropertyId} onChange={function(e) { setFPropertyId(e.target.value); }} className={ic}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג בדיקה</label>
                <div className="grid grid-cols-4 gap-2">
                  {INSPECTION_TYPES.map(function(t) {
                    return (
                      <button key={t.value} type="button" onClick={function() { setFType(t.value); }}
                        className={"rounded-lg border p-2 text-center transition-all " +
                          (fType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div className="text-lg">{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType === t.value ? "text-blue-700" : "text-slate-600")}>{t.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בוצע לאחרונה</label>
                  <input type="date" value={fLastDate}
                    onChange={function(e) { setFLastDate(e.target.value); calcNextDate(e.target.value, fType); }}
                    className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">הבאה *</label>
                  <input type="date" value={fNextDate} onChange={function(e) { setFNextDate(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e) { setFStatus(e.target.value); }} className={ic}>
                  <option value="pending">ממתין לביצוע</option>
                  <option value="completed">בוצע</option>
                  <option value="overdue">באיחור</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שם מבצע</label>
                  <input type="text" value={fInspector} onChange={function(e) { setFInspector(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר תעודה</label>
                  <input type="text" value={fCertNum} onChange={function(e) { setFCertNum(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
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
