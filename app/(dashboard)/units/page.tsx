"use client";
import { useState, useEffect, Fragment, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const SPACE_TYPES: Record<string, { label: string; icon: string }> = {
  unit:        { label: "יחידה סגורה",    icon: "🚪" },
  operational: { label: "שטח תפעולי",     icon: "⚙️" },
  open_storage:{ label: "שטח פתוח",       icon: "📦" },
  parking:     { label: "חניה",           icon: "🅿️" },
  other:       { label: "אחר",            icon: "📐" },
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  vacant:   { label: "פנויה",    bg: "bg-green-100",  color: "text-green-700"  },
  rented:   { label: "מושכרת",  bg: "bg-blue-100",   color: "text-blue-700"   },
  future:   { label: "עתידית",  bg: "bg-purple-100", color: "text-purple-700" },
  inactive: { label: "לא פעילה",bg: "bg-slate-100",  color: "text-slate-500"  },
};

function UnitsInner() {
  const searchParams = useSearchParams();
  const [properties, setProperties] = useState<any[]>([]);
  const [selectedProp, setSelectedProp] = useState("");
  const [spaces, setSpaces]   = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [isNew, setIsNew] = useState(false);

  // שדות עריכה
  const [editName,   setEditName]   = useState("");
  const [editType,   setEditType]   = useState("unit");
  const [editArea,   setEditArea]   = useState("");
  const [editFloor,  setEditFloor]  = useState("");
  const [editStatus, setEditStatus] = useState("vacant");
  const [editNotes,  setEditNotes]  = useState("");
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    supabase.from("properties").select("id, name").order("name")
      .then(({ data }) => setProperties(data ?? []));
    const pre = searchParams?.get("property");
    if (pre) setSelectedProp(pre);
  }, []);

  useEffect(() => {
    if (!selectedProp) { setSpaces([]); return; }
    loadSpaces();
  }, [selectedProp]);

  async function loadSpaces() {
    setLoading(true);
    const { data } = await supabase
      .from("spaces")
      .select("*")
      .eq("property_id", selectedProp)
      .order("space_type")
      .order("space_name");
    setSpaces(data ?? []);
    setLoading(false);
  }

  function openEdit(s: any) {
    setIsNew(false);
    setEditingId(s.id);
    setEditName(s.space_name ?? "");
    setEditType(s.space_type ?? "unit");
    setEditArea(s.area?.toString() ?? "");
    setEditFloor(s.floor ?? "");
    setEditStatus(s.status ?? "vacant");
    setEditNotes(s.notes ?? "");
  }

  function openNew() {
    setIsNew(true);
    setEditingId("new");
    setEditName(""); setEditType("unit"); setEditArea("");
    setEditFloor(""); setEditStatus("vacant"); setEditNotes("");
  }

  async function handleSave() {
    if (!editName.trim()) { alert("חובה: שם יחידה"); return; }
    if (!selectedProp) { alert("בחר נכס"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id: selectedProp,
        space_name: editName.trim(),
        space_type: editType,
        area: editArea ? Number(editArea) : null,
        floor: editFloor || null,
        status: editStatus,
        notes: editNotes || null,
      };
      if (isNew) {
        const { error } = await supabase.from("spaces").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("spaces").update(payload).eq("id", editingId);
        if (error) throw error;
      }
      setEditingId("");
      await loadSpaces();
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`למחוק "${name}"?`)) return;
    const { error } = await supabase.from("spaces").delete().eq("id", id);
    if (error) { alert("שגיאה: " + error.message); return; }
    await loadSpaces();
  }

  // סיכום לפי סוג
  const byType = Object.keys(SPACE_TYPES).map(type => ({
    type,
    ...SPACE_TYPES[type],
    count: spaces.filter(s => s.space_type === type).length,
    area:  spaces.filter(s => s.space_type === type).reduce((s, u) => s + (u.area ?? 0), 0),
    vacant: spaces.filter(s => s.space_type === type && s.status === "vacant").length,
  })).filter(t => t.count > 0);

  const totalArea   = spaces.reduce((s, u) => s + (u.area ?? 0), 0);
  const vacantArea  = spaces.filter(u => u.status === "vacant").reduce((s, u) => s + (u.area ?? 0), 0);
  const rentedArea  = spaces.filter(u => u.status === "rented").reduce((s, u) => s + (u.area ?? 0), 0);

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">יחידות ושטחים</h1>
          <p className="text-sm text-slate-500 mt-1">ניהול שטחים ויחידות לפי נכס</p>
        </div>
        {selectedProp && (
          <button onClick={openNew}
            className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
            + יחידה חדשה
          </button>
        )}
      </div>

      {/* בחירת נכס */}
      <div className="mb-5">
        <select value={selectedProp} onChange={e => setSelectedProp(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">-- בחר נכס --</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!selectedProp ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🏢</div>
          <div>בחר נכס להצגת היחידות</div>
        </div>
      ) : loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <>
          {/* סיכום */}
          {spaces.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-center">
                <div className="text-2xl font-bold text-slate-900">{spaces.length}</div>
                <div className="text-xs text-slate-500 mt-1">סה"כ יחידות</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-center">
                <div className="text-2xl font-bold text-slate-900">{totalArea.toLocaleString()}</div>
                <div className="text-xs text-slate-500 mt-1">מ"ר סה"כ</div>
              </div>
              <div className="rounded-xl border border-green-100 bg-green-50 p-4 shadow-sm text-center">
                <div className="text-2xl font-bold text-green-700">{rentedArea.toLocaleString()}</div>
                <div className="text-xs text-green-600 mt-1">מ"ר מושכר</div>
              </div>
              <div className="rounded-xl border border-orange-100 bg-orange-50 p-4 shadow-sm text-center">
                <div className="text-2xl font-bold text-orange-600">{vacantArea.toLocaleString()}</div>
                <div className="text-xs text-orange-500 mt-1">מ"ר פנוי</div>
              </div>
            </div>
          )}

          {/* טבלה */}
          {spaces.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-4xl mb-2">🚪</div>
              <div>אין יחידות לנכס זה</div>
              <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף יחידה</button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold">שם</th>
                    <th className="px-4 py-3 font-semibold">סוג</th>
                    <th className="px-4 py-3 font-semibold">קומה</th>
                    <th className="px-4 py-3 font-semibold">שטח</th>
                    <th className="px-4 py-3 font-semibold">סטטוס</th>
                    <th className="px-4 py-3 font-semibold">הערות</th>
                    <th className="px-4 py-3 font-semibold">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {spaces.map(s => {
                    const st = SPACE_TYPES[s.space_type] ?? SPACE_TYPES.other;
                    const sc = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.vacant;
                    return (
                      <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">{s.space_name}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {st.icon} {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{s.floor ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-700">{s.area ? `${s.area} מ"ר` : "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.color}`}>
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{s.notes ?? ""}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button onClick={() => openEdit(s)}
                              className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">עריכה</button>
                            <button onClick={() => handleDelete(s.id, s.space_name)}
                              className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">מחיקה</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setEditingId("")}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "יחידה חדשה" : "עריכת יחידה"}</h2>
              <button onClick={() => setEditingId("")} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם / מספר יחידה *</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                  className={ic} placeholder="א1 / מחסן 3 / חניה 12" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סוג</label>
                  <select value={editType} onChange={e => setEditType(e.target.value)} className={ic}>
                    {Object.entries(SPACE_TYPES).map(([k,v]) =>
                      <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                  <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className={ic}>
                    {Object.entries(STATUS_CONFIG).map(([k,v]) =>
                      <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ"ר)</label>
                  <input type="number" value={editArea} onChange={e => setEditArea(e.target.value)}
                    className={ic} placeholder="120" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">קומה</label>
                  <input type="text" value={editFloor} onChange={e => setEditFloor(e.target.value)}
                    className={ic} placeholder="1 / קרקע / מרתף" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)}
                  className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingId("")}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                  {saving ? "שומר..." : isNew ? "צור יחידה" : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UnitsPage() {
  return (
    <Suspense fallback={<div dir="rtl" className="p-8 text-center text-slate-400">טוען...</div>}>
      <UnitsInner />
    </Suspense>
  );
}
