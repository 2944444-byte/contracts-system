"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const SPACE_TYPES = [
  { value: "unit",          label: "יחידה סגורה",     icon: "🚪", desc: "משרד, חנות, מחסן, אולם לוגיסטי" },
  { value: "operational",   label: "שטח תפעולי",      icon: "⚙️", desc: "טעינה/פריקה, שטח שירות, חצר עבודה" },
  { value: "open_storage",  label: "שטח פתוח",        icon: "📦", desc: "רחבת אחסון, חצר, שטח חיצוני" },
  { value: "parking",       label: "חניה",             icon: "🅿️", desc: "חנייה צמודה, חניון, לפי שימוש" },
  { value: "other",         label: "אחר",              icon: "📐", desc: "" },
];

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  vacant:   { label: "פנויה",     bg: "bg-green-100",  color: "text-green-700"  },
  rented:   { label: "מושכרת",   bg: "bg-blue-100",   color: "text-blue-700"   },
  future:   { label: "עתידית",   bg: "bg-purple-100", color: "text-purple-700" },
  inactive: { label: "לא פעילה", bg: "bg-slate-100",  color: "text-slate-500"  },
};

export default function UnitsPage() {
  const [properties,   setProperties]   = useState<any[]>([]);
  const [selectedProp, setSelectedProp] = useState("");
  const [spaces,       setSpaces]       = useState<any[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [filterType,   setFilterType]   = useState("all");
  const [search,       setSearch]       = useState("");

  // מודל עריכה
  const [editingId, setEditingId] = useState("");
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);

  // שדות
  const [fName,       setFName]       = useState("");
  const [fType,       setFType]       = useState("unit");
  const [fArea,       setFArea]       = useState("");
  const [fFloor,      setFFloor]      = useState("");
  const [fStatus,     setFStatus]     = useState("vacant");
  const [fQuantity,   setFQuantity]   = useState("");   // לחניות
  const [fCommercial, setFCommercial] = useState(false); // מסחרי
  const [fNotes,      setFNotes]      = useState("");

  useEffect(function() {
    supabase.from("properties").select("id, name").order("name")
      .then(function({ data }) { setProperties(data ?? []); });
  }, []);

  useEffect(function() {
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

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFType("unit"); setFArea(""); setFFloor("");
    setFStatus("vacant"); setFQuantity(""); setFCommercial(false); setFNotes("");
  }

  function openEdit(s: any) {
    setIsNew(false); setEditingId(s.id);
    setFName(s.space_name ?? ""); setFType(s.space_type ?? "unit");
    setFArea(s.area?.toString() ?? ""); setFFloor(s.floor ?? "");
    setFStatus(s.status ?? "vacant"); setFQuantity(s.quantity?.toString() ?? "");
    setFCommercial(s.is_commercial ?? false); setFNotes(s.notes ?? "");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם"); return; }
    setSaving(true);
    try {
      const payload: any = {
        property_id:   selectedProp,
        space_name:    fName.trim(),
        space_type:    fType,
        status:        fStatus,
        floor:         fFloor || null,
        notes:         fNotes || null,
        is_commercial: fCommercial,
        revenue_capable: fCommercial,
      };
      // שדות לפי סוג
      if (fType === "parking") {
        payload.quantity = fQuantity ? Number(fQuantity) : null;
        payload.area     = null;
      } else {
        payload.area     = fArea ? Number(fArea) : null;
        payload.quantity = null;
      }

      if (isNew) {
        await supabase.from("spaces").insert(payload);
      } else {
        await supabase.from("spaces").update(payload).eq("id", editingId);
      }
      setEditingId("");
      await loadSpaces();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm("למחוק \"" + name + "\"?")) return;
    await supabase.from("spaces").delete().eq("id", id);
    await loadSpaces();
  }

  // סיכומים
  const byType = SPACE_TYPES.map(function(t) {
    const items = spaces.filter(function(s) { return s.space_type === t.value; });
    const area  = items.filter(function(s) { return s.space_type !== "parking"; })
                       .reduce(function(acc, s) { return acc + (s.area ?? 0); }, 0);
    const qty   = items.filter(function(s) { return s.space_type === "parking"; })
                       .reduce(function(acc, s) { return acc + (s.quantity ?? 1); }, 0);
    return { ...t, count: items.length, area, qty,
      vacant: items.filter(function(s) { return s.status === "vacant"; }).length };
  }).filter(function(t) { return t.count > 0; });

  const filtered = spaces.filter(function(s) {
    const matchType   = filterType === "all" || s.space_type === filterType;
    const matchSearch = !search || s.space_name?.includes(search);
    return matchType && matchSearch;
  });

  const typeInfo = (v: string) => SPACE_TYPES.find(function(t) { return t.value === v; }) ?? SPACE_TYPES[4];

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">יחידות ושטחים</h1>
          <p className="text-sm text-slate-500 mt-1">ניהול כל סוגי השטחים לפי נכס</p>
        </div>
        {selectedProp && (
          <button onClick={openNew}
            className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
            + שטח חדש
          </button>
        )}
      </div>

      {/* בחירת נכס */}
      <div className="mb-5">
        <select value={selectedProp} onChange={function(e) { setSelectedProp(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">-- בחר נכס --</option>
          {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
        </select>
      </div>

      {!selectedProp ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🏢</div>
          <div>בחר נכס להצגת השטחים</div>
        </div>
      ) : loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <>
          {/* כרטיסי סיכום לפי סוג */}
          {byType.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {byType.map(function(t) {
                return (
                  <button key={t.value}
                    onClick={function() { setFilterType(filterType === t.value ? "all" : t.value); }}
                    className={"rounded-xl border p-4 shadow-sm text-center transition-all " +
                      (filterType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50")}>
                    <div className="text-2xl mb-1">{t.icon}</div>
                    <div className="font-bold text-slate-800">
                      {t.value === "parking" ? t.qty + " מקומות" : t.area.toLocaleString() + " מ\"ר"}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{t.label}</div>
                    <div className="text-xs text-green-600 mt-0.5">{t.vacant} פנויים</div>
                  </button>
                );
              })}
            </div>
          )}

          {/* חיפוש ופילטר */}
          <div className="mb-4 flex gap-3">
            <input type="text" value={search} onChange={function(e) { setSearch(e.target.value); }}
              placeholder="חיפוש..."
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <select value={filterType} onChange={function(e) { setFilterType(e.target.value); }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
              <option value="all">כל הסוגים</option>
              {SPACE_TYPES.map(function(t) { return <option key={t.value} value={t.value}>{t.icon} {t.label}</option>; })}
            </select>
          </div>

          {/* טבלה */}
          {spaces.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-4xl mb-2">🚪</div>
              <div>אין שטחים לנכס זה</div>
              <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף שטח</button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold">שם / מספר</th>
                    <th className="px-4 py-3 font-semibold">סוג</th>
                    <th className="px-4 py-3 font-semibold">קומה</th>
                    <th className="px-4 py-3 font-semibold">שטח / כמות</th>
                    <th className="px-4 py-3 font-semibold">סטטוס</th>
                    <th className="px-4 py-3 font-semibold">מסחרי</th>
                    <th className="px-4 py-3 font-semibold">הערות</th>
                    <th className="px-4 py-3 font-semibold">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(function(s) {
                    const ti = typeInfo(s.space_type);
                    const sc = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.vacant;
                    return (
                      <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">{s.space_name}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {ti.icon} {ti.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{s.floor ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-700 font-medium">
                          {s.space_type === "parking"
                            ? (s.quantity ?? 1) + " מקומות"
                            : s.area ? s.area + " מ\"ר" : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + sc.bg + " " + sc.color}>
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {s.is_commercial ? <span className="text-green-600 text-xs font-bold">✓</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{s.notes ?? ""}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button onClick={function() { openEdit(s); }}
                              className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">עריכה</button>
                            <button onClick={function() { handleDelete(s.id, s.space_name); }}
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
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "שטח חדש" : "עריכת שטח"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">

              {/* בחירת סוג — כרטיסים */}
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג שטח</label>
                <div className="grid grid-cols-2 gap-2">
                  {SPACE_TYPES.map(function(t) {
                    return (
                      <button key={t.value} type="button"
                        onClick={function() { setFType(t.value); }}
                        className={"rounded-xl border p-3 text-right transition-all " +
                          (fType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div className="text-lg mb-0.5">{t.icon}</div>
                        <div className={"text-xs font-bold " + (fType === t.value ? "text-blue-700" : "text-slate-700")}>
                          {t.label}
                        </div>
                        {t.desc && <div className="text-xs text-slate-400 leading-tight mt-0.5">{t.desc}</div>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* שם */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם / מספר *</label>
                <input type="text" value={fName} onChange={function(e) { setFName(e.target.value); }}
                  className={ic}
                  placeholder={fType === "parking" ? "חניה 1 / חניון צפון" : fType === "unit" ? "חנות 3 / משרד א1" : "שטח טעינה / רחבה"} />
              </div>

              {/* שדות לפי סוג */}
              {fType === "parking" ? (
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 space-y-3">
                  <div className="text-xs font-bold text-blue-700 mb-2">🅿️ פרטי חניה</div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">מספר מקומות</label>
                    <input type="number" value={fQuantity} onChange={function(e) { setFQuantity(e.target.value); }}
                      className={ic} placeholder="1" />
                  </div>
                  <div className="text-xs text-slate-500">
                    💡 חניות מוגדרות לפי מספר מקומות — לא לפי שטח מ&quot;ר
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ&quot;ר)</label>
                    <input type="number" value={fArea} onChange={function(e) { setFArea(e.target.value); }}
                      className={ic} placeholder="120" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">קומה</label>
                    <input type="text" value={fFloor} onChange={function(e) { setFFloor(e.target.value); }}
                      className={ic} placeholder="1 / קרקע / מרתף" />
                  </div>
                </div>
              )}

              {/* מסחרי — רק ליחידות סגורות */}
              {fType === "unit" && (
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={fCommercial}
                      onChange={function(e) { setFCommercial(e.target.checked); }}
                      className="w-4 h-4" />
                    <div>
                      <div className="text-sm font-semibold text-slate-800">יחידה מסחרית</div>
                      <div className="text-xs text-slate-500">מאפשר תמחור לפי אחוז מפידיון</div>
                    </div>
                  </label>
                </div>
              )}

              {/* סטטוס */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(STATUS_CONFIG).map(function([k, v]) {
                    return (
                      <button key={k} type="button" onClick={function() { setFStatus(k); }}
                        className={"rounded-lg border py-2 text-xs font-semibold transition-all " +
                          (fStatus === k ? v.bg + " " + v.color + " border-current" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                        {v.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* הערות */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} className={ic} />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  ביטול
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                  {saving ? "שומר..." : isNew ? "צור שטח" : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
