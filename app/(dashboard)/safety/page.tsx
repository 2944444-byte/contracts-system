"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const INSPECTION_TYPES = [
  { value: "sprinklers",    label: "ספרינקלרים וגילוי אש", icon: "🔥", freq_months: 12 },
  { value: "electricity",   label: "מערכת חשמל",           icon: "⚡", freq_months: 12 },
  { value: "elevator",      label: "מעלית",                 icon: "🛗", freq_months: 3  },
  { value: "emergency_light",label: "תאורת חירום",         icon: "💡", freq_months: 12 },
  { value: "pa_system",     label: "מערכת כריזה",          icon: "📢", freq_months: 12 },
  { value: "generator",     label: "גנרטור",               icon: "🔋", freq_months: 12 },
  { value: "other",         label: "אחר",                  icon: "🔧", freq_months: 12 },
];

function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0];
}

export default function SafetyPage() {
  const [inspections, setInspections] = useState<any[]>([]);
  const [properties,  setProperties]  = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [editingId,   setEditingId]   = useState("");
  const [isNew,       setIsNew]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [filterProp,  setFilterProp]  = useState("all");

  const [fPropId,     setFPropId]     = useState("");
  const [fType,       setFType]       = useState("sprinklers");
  const [fLastDate,   setFLastDate]   = useState("");
  const [fNextDate,   setFNextDate]   = useState("");
  const [fFreqMonths, setFFreqMonths] = useState("12");
  const [fNotes,      setFNotes]      = useState("");
  const [fDocUrl,     setFDocUrl]     = useState("");
  const [fStatus,     setFStatus]     = useState("valid");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: insp }, { data: props }] = await Promise.all([
      supabase.from("safety_inspections")
        .select("*, properties(name)")
        .order("next_inspection_date", { ascending: true }),
      supabase.from("properties").select("id, name").order("name"),
    ]);
    setInspections(insp ?? []);
    setProperties(props ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropId(""); setFType("sprinklers"); setFLastDate("");
    setFNextDate(""); setFFreqMonths("12"); setFNotes(""); setFDocUrl(""); setFStatus("valid");
  }

  function openEdit(ins: any) {
    setIsNew(false); setEditingId(ins.id);
    setFPropId(ins.property_id ?? ""); setFType(ins.inspection_type ?? "sprinklers");
    setFLastDate(ins.last_inspection_date?.split("T")[0] ?? "");
    setFNextDate(ins.next_inspection_date?.split("T")[0] ?? "");
    setFFreqMonths(ins.frequency_months?.toString() ?? "12");
    setFNotes(ins.notes ?? ""); setFDocUrl(ins.document_url ?? ""); setFStatus(ins.status ?? "valid");
  }

  function autoCalcNext() {
    if (fLastDate && fFreqMonths) {
      setFNextDate(addMonths(fLastDate, Number(fFreqMonths)));
    }
  }

  async function handleSave() {
    if (!fPropId || !fNextDate) { alert("חובה: נכס ותאריך בדיקה הבאה"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id:         fPropId,
        inspection_type:     fType,
        last_inspection_date: fLastDate || null,
        next_inspection_date: fNextDate,
        frequency_months:    Number(fFreqMonths),
        notes:               fNotes || null,
        document_url:        fDocUrl || null,
        status:              fStatus,
      };
      if (isNew) {
        await supabase.from("safety_inspections").insert(payload);
      } else {
        await supabase.from("safety_inspections").update(payload).eq("id", editingId);
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק?")) return;
    await supabase.from("safety_inspections").delete().eq("id", id);
    await loadAll();
  }

  async function markDone(ins: any) {
    const today = new Date().toISOString().split("T")[0];
    const next  = addMonths(today, ins.frequency_months ?? 12);
    await supabase.from("safety_inspections").update({
      last_inspection_date: today,
      next_inspection_date: next,
      status: "valid",
    }).eq("id", ins.id);
    await loadAll();
  }

  const filtered = inspections.filter(function(i) {
    return filterProp === "all" || i.property_id === filterProp;
  });

  const expiringSoon = inspections.filter(function(i) {
    const d = daysLeft(i.next_inspection_date);
    return d <= 60 && d >= 0;
  }).length;

  const expired = inspections.filter(function(i) {
    return daysLeft(i.next_inspection_date) < 0;
  }).length;

  function statusBadge(ins: any) {
    const d = daysLeft(ins.next_inspection_date);
    if (d < 0)   return { label: "פג תוקף",    bg: "bg-red-100",    color: "text-red-700" };
    if (d <= 30)  return { label: d + " ימים",  bg: "bg-red-100",    color: "text-red-700" };
    if (d <= 60)  return { label: d + " ימים",  bg: "bg-yellow-100", color: "text-yellow-700" };
    return             { label: "תקין",        bg: "bg-green-100",  color: "text-green-700" };
  }

  const typeInfo = function(v: string) {
    return INSPECTION_TYPES.find(function(t) { return t.value === v; }) ?? INSPECTION_TYPES[6];
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">בדיקות בטיחות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {expired > 0 && <span className="text-red-600 font-semibold">{expired} פגו תוקף | </span>}
            {expiringSoon > 0 && <span className="text-yellow-600 font-semibold">{expiringSoon} פגים ב-60 יום | </span>}
            {inspections.length} בדיקות במעקב
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + בדיקה חדשה
        </button>
      </div>

      {/* סיכום */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {INSPECTION_TYPES.slice(0,4).map(function(t) {
          const items = inspections.filter(function(i) { return i.inspection_type === t.value; });
          const urgent = items.filter(function(i) { return daysLeft(i.next_inspection_date) <= 60; }).length;
          return (
            <div key={t.value} className={"rounded-xl border p-3 shadow-sm text-center " + (urgent > 0 ? "border-yellow-200 bg-yellow-50" : "border-slate-200 bg-white")}>
              <div className="text-xl">{t.icon}</div>
              <div className="text-xs font-semibold text-slate-700 mt-1">{t.label}</div>
              <div className="text-xs text-slate-400">{items.length} נכסים</div>
              {urgent > 0 && <div className="text-xs text-yellow-700 font-bold">{urgent} דחוף</div>}
            </div>
          );
        })}
      </div>

      {/* פילטר */}
      <div className="mb-4">
        <select value={filterProp} onChange={function(e) { setFilterProp(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
          <option value="all">כל הנכסים</option>
          {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
        </select>
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
          <div className="text-5xl mb-3">🔧</div>
          <div>אין בדיקות בטיחות</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף בדיקה</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold">סוג בדיקה</th>
                <th className="px-4 py-3 font-semibold">נכס</th>
                <th className="px-4 py-3 font-semibold">בדיקה אחרונה</th>
                <th className="px-4 py-3 font-semibold">בדיקה הבאה</th>
                <th className="px-4 py-3 font-semibold">תדירות</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(ins) {
                const ti = typeInfo(ins.inspection_type);
                const sb = statusBadge(ins);
                const d  = daysLeft(ins.next_inspection_date);
                return (
                  <tr key={ins.id} className={"border-t border-slate-100 " + (d < 0 ? "bg-red-50" : d <= 30 ? "bg-yellow-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <span className="text-base mr-1">{ti.icon}</span>
                      <span className="font-medium text-slate-800">{ti.label}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{ins.properties?.name}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(ins.last_inspection_date)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{fmtDate(ins.next_inspection_date)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      כל {ins.frequency_months} חודשים
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + sb.bg + " " + sb.color}>
                        {sb.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={function() { markDone(ins); }}
                          className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 font-semibold whitespace-nowrap">
                          ✓ בוצע
                        </button>
                        <button onClick={function() { openEdit(ins); }}
                          className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">
                          עריכה
                        </button>
                        <button onClick={function() { handleDelete(ins.id); }}
                          className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">
                          מחיקה
                        </button>
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
                <select value={fPropId} onChange={function(e) { setFPropId(e.target.value); }} className={ic}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג בדיקה</label>
                <div className="grid grid-cols-2 gap-2">
                  {INSPECTION_TYPES.map(function(t) {
                    return (
                      <button key={t.value} type="button"
                        onClick={function() { setFType(t.value); setFFreqMonths(t.freq_months.toString()); }}
                        className={"rounded-lg border p-2.5 text-right transition-all " +
                          (fType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <span className="text-base ml-1">{t.icon}</span>
                        <span className={"text-xs font-semibold " + (fType === t.value ? "text-blue-700" : "text-slate-700")}>
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך בדיקה אחרונה</label>
                  <input type="date" value={fLastDate}
                    onChange={function(e) { setFLastDate(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות (חודשים)</label>
                  <input type="number" value={fFreqMonths}
                    onChange={function(e) { setFFreqMonths(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">תאריך בדיקה הבאה *</label>
                  {fLastDate && (
                    <button onClick={autoCalcNext} className="text-xs text-blue-600 hover:underline">
                      ← חשב אוטומטי
                    </button>
                  )}
                </div>
                <input type="date" value={fNextDate}
                  onChange={function(e) { setFNextDate(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">קישור לאישור</label>
                <input type="url" value={fDocUrl}
                  onChange={function(e) { setFDocUrl(e.target.value); }} className={ic} placeholder="https://..." />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes}
                  onChange={function(e) { setFNotes(e.target.value); }} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">
                  ביטול
                </button>
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
