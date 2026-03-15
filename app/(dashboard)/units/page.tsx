"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const SPACE_TYPES = [
  { value: "office",    label: "משרד",       icon: "💼" },
  { value: "storage",   label: "מחסן",       icon: "📦" },
  { value: "parking",   label: "חניה",       icon: "🅿️" },
  { value: "shop",      label: "חנות",       icon: "🏪" },
  { value: "other",     label: "אחר",        icon: "📋" },
];

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  available: { label: "פנוי",      bg: "bg-green-100",  color: "text-green-700"  },
  rented:    { label: "מושכר",     bg: "bg-blue-100",   color: "text-blue-700"   },
  reserved:  { label: "שמור",      bg: "bg-yellow-100", color: "text-yellow-700" },
  inactive:  { label: "לא פעיל",  bg: "bg-slate-100",  color: "text-slate-500"  },
};

export default function UnitsPage() {
  const [spaces,     setSpaces]     = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterProp, setFilterProp] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterSt,   setFilterSt]   = useState("all");

  const [fPropertyId, setFPropertyId] = useState("");
  const [fName,       setFName]       = useState("");
  const [fType,       setFType]       = useState("office");
  const [fFloor,      setFFloor]      = useState("");
  const [fArea,       setFArea]       = useState("");
  const [fStatus,     setFStatus]     = useState("available");
  const [fNotes,      setFNotes]      = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: sp }, { data: pr }] = await Promise.all([
      supabase.from("spaces")
        .select("*, properties(name)")
        .order("property_id").order("name"),
      supabase.from("properties").select("id, name").order("name"),
    ]);
    setSpaces(sp ?? []);
    setProperties(pr ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFName(""); setFType("office"); setFFloor("");
    setFArea(""); setFStatus("available"); setFNotes("");
  }

  function openEdit(s: any) {
    setIsNew(false); setEditingId(s.id);
    setFPropertyId(s.property_id ?? ""); setFName(s.name ?? ""); setFType(s.space_type ?? "office");
    setFFloor(s.floor?.toString() ?? ""); setFArea(s.area?.toString() ?? "");
    setFStatus(s.status ?? "available"); setFNotes(s.notes ?? "");
  }

  async function handleSave() {
    if (!fPropertyId) { alert("חובה: נכס"); return; }
    if (!fName.trim()) { alert("חובה: שם/מספר יחידה"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id: fPropertyId,
        name:        fName.trim(),
        space_type:  fType,
        floor:       fFloor ? Number(fFloor) : null,
        area:        fArea  ? Number(fArea)  : null,
        status:      fStatus,
        notes:       fNotes || null,
      };
      if (isNew) {
        const { data } = await supabase.from("spaces").insert(payload).select().single();
        await logAudit({ entity_type: "space", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("spaces").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "space", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק יחידה?")) return;
    await supabase.from("spaces").delete().eq("id", id);
    await loadAll();
  }

  async function quickStatus(id: string, status: string) {
    await supabase.from("spaces").update({ status }).eq("id", id);
    await loadAll();
  }

  const filtered = spaces.filter(function(s) {
    const mp = filterProp === "all" || s.property_id === filterProp;
    const mt = filterType === "all" || s.space_type  === filterType;
    const ms = filterSt   === "all" || s.status       === filterSt;
    return mp && mt && ms;
  });

  const totalArea      = filtered.reduce(function(s, sp) { return s + (sp.area ?? 0); }, 0);
  const occupiedCount  = filtered.filter(function(s) { return s.status === "rented"; }).length;
  const availableCount = filtered.filter(function(s) { return s.status === "available"; }).length;

  const typeInfo = function(v: string) {
    return SPACE_TYPES.find(function(t) { return t.value === v; }) ?? SPACE_TYPES[4];
  };

  // קבץ לפי נכס
  const grouped: Record<string, any[]> = {};
  filtered.forEach(function(s) {
    const key = s.property_id ?? "none";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">יחידות ומשרדים</h1>
          <p className="text-sm text-slate-500 mt-1">
            {occupiedCount} מושכרות | {availableCount} פנויות | {totalArea.toLocaleString()} מ"ר
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + יחידה חדשה
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {Object.entries(STATUS_CONFIG).map(function([k, v]) {
          const cnt = spaces.filter(function(s) { return s.status === k; }).length;
          return (
            <button key={k} onClick={function() { setFilterSt(filterSt === k ? "all" : k); }}
              className={"rounded-xl border p-3 text-center transition-all " + v.bg +
                (filterSt === k ? " ring-2 ring-blue-400" : "")}>
              <div className={"text-2xl font-black " + v.color}>{cnt}</div>
              <div className={"text-xs font-semibold " + v.color}>{v.label}</div>
            </button>
          );
        })}
      </div>

      {/* פילטרים */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <select value={filterProp} onChange={function(e) { setFilterProp(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
          <option value="all">כל הנכסים</option>
          {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
        </select>
        <div className="flex gap-1">
          {SPACE_TYPES.map(function(t) {
            const cnt = spaces.filter(function(s) { return s.space_type === t.value; }).length;
            if (!cnt) return null;
            return (
              <button key={t.value} onClick={function() { setFilterType(filterType === t.value ? "all" : t.value); }}
                className={"rounded-xl border px-3 py-2 text-xs font-semibold " +
                  (filterType === t.value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
                {t.icon} {t.label} ({cnt})
              </button>
            );
          })}
        </div>
      </div>

      {/* תצוגה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🚪</div>
          <div>אין יחידות</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף יחידה</button>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(function([propId, items]) {
            const propName = items[0]?.properties?.name ?? "ללא נכס";
            return (
              <div key={propId} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-semibold text-slate-700">🏢 {propName}</span>
                  <span className="text-xs text-slate-400">{items.length} יחידות</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
                  {items.map(function(s) {
                    const ti  = typeInfo(s.space_type);
                    const sc  = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.available;
                    return (
                      <div key={s.id}
                        className={"rounded-xl border p-3 transition-all hover:shadow-md cursor-default " +
                          (s.status === "rented" ? "border-blue-200 bg-blue-50" :
                            s.status === "available" ? "border-green-200 bg-green-50" :
                            "border-slate-200 bg-white")}>
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-xl">{ti.icon}</span>
                          <span className={"text-xs px-1.5 py-0.5 rounded-full font-semibold " + sc.bg + " " + sc.color}>
                            {sc.label}
                          </span>
                        </div>
                        <div className="font-bold text-slate-800 text-sm">{s.name}</div>
                        <div className="text-xs text-slate-400">{ti.label}{s.floor != null ? " | קומה " + s.floor : ""}</div>
                        {s.area && <div className="text-xs text-slate-500 mt-0.5">{s.area} מ"ר</div>}
                        <div className="flex gap-1 mt-2">
                          {s.status === "available" && (
                            <button onClick={function() { quickStatus(s.id, "rented"); }}
                              className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded hover:bg-blue-700">השכר</button>
                          )}
                          {s.status === "rented" && (
                            <button onClick={function() { quickStatus(s.id, "available"); }}
                              className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded hover:bg-green-700">פנה</button>
                          )}
                          <button onClick={function() { openEdit(s); }}
                            className="text-xs border border-slate-200 px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-50">✏️</button>
                          <button onClick={function() { handleDelete(s.id); }}
                            className="text-xs border border-red-100 px-1.5 py-0.5 rounded text-red-400 hover:bg-red-50">🗑</button>
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

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "יחידה חדשה" : "עריכת יחידה"}</h2>
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
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג</label>
                <div className="grid grid-cols-5 gap-2">
                  {SPACE_TYPES.map(function(t) {
                    return (
                      <button key={t.value} type="button" onClick={function() { setFType(t.value); }}
                        className={"rounded-lg border p-2 text-center " +
                          (fType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType === t.value ? "text-blue-700" : "text-slate-600")}>{t.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שם / מספר *</label>
                  <input type="text" value={fName} onChange={function(e) { setFName(e.target.value); }} className={ic} placeholder="101 / A1 / חניה 5" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">קומה</label>
                  <input type="number" value={fFloor} onChange={function(e) { setFFloor(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שטח מ"ר</label>
                  <input type="number" value={fArea} onChange={function(e) { setFArea(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e) { setFStatus(e.target.value); }} className={ic}>
                  {Object.entries(STATUS_CONFIG).map(function([v, c]) {
                    return <option key={v} value={v}>{c.label}</option>;
                  })}
                </select>
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
