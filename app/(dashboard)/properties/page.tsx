"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const PROPERTY_TYPES = [
  { value: "office",     label: "משרדים",      icon: "🏢" },
  { value: "commercial", label: "מסחרי",       icon: "🏪" },
  { value: "industrial", label: "תעשייה",      icon: "🏭" },
  { value: "logistics",  label: "לוגיסטיקה",   icon: "📦" },
  { value: "mixed",      label: "מעורב",       icon: "🏗️" },
  { value: "other",      label: "אחר",         icon: "🏠" },
];

function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default function PropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<any[]>([]);
  const [groups,     setGroups]     = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState<any>(null);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);

  const [fName,    setFName]    = useState("");
  const [fAddress, setFAddress] = useState("");
  const [fCity,    setFCity]    = useState("");
  const [fType,    setFType]    = useState("office");
  const [fArea,    setFArea]    = useState("");
  const [fNotes,   setFNotes]   = useState("");
  const [fGroupId, setFGroupId] = useState("");
  const [fMgmtFee, setFMgmtFee] = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: props }, { data: grps }] = await Promise.all([
      supabase.from("properties")
        .select("*, spaces(id,status,area), units(id,status,area), contracts(id,status,tenants(name),rent_per_sqm,charged_area,investment_addition), property_groups(name)")
        .order("name"),
      supabase.from("property_groups").select("id,name").order("name"),
    ]);
    setProperties(props ?? []);
    setGroups(grps ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFAddress(""); setFCity(""); setFType("office");
    setFArea(""); setFNotes(""); setFGroupId(""); setFMgmtFee("");
  }

  function openEdit(p: any) {
    setIsNew(false); setEditingId(p.id);
    setFName(p.name ?? ""); setFAddress(p.address ?? ""); setFCity(p.city ?? "");
    setFType(p.property_type ?? "office"); setFArea(p.total_rentable_area?.toString() ?? "");
    setFNotes(p.notes ?? ""); setFGroupId(p.group_id ?? ""); setFMgmtFee(p.mgmt_fee_per_sqm?.toString() ?? "");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם נכס"); return; }
    setSaving(true);
    try {
      const payload = {
        name:                fName.trim(),
        address:             fAddress || null,
        city:                fCity || null,
        property_type:       fType,
        total_rentable_area: fArea ? Number(fArea) : null,
        notes:               fNotes || null,
        group_id:            fGroupId || null,
        mgmt_fee_per_sqm:    fMgmtFee ? Number(fMgmtFee) : null,
      };
      if (isNew) {
        const { data } = await supabase.from("properties").insert(payload).select().single();
        await logAudit({ entity_type: "property", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("properties").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "property", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm("למחוק נכס \"" + name + "\"?")) return;
    await supabase.from("properties").delete().eq("id", id);
    if (selected?.id === id) setSelected(null);
    await loadAll();
  }

  const filtered = properties.filter(function(p) {
    return !search || p.name?.includes(search) || p.city?.includes(search) || p.address?.includes(search);
  });

  function getStats(p: any) {
    const items = p.spaces?.length ? p.spaces : p.units ?? [];
    const total    = items.length;
    const occupied = items.filter(function(u: any) { return u.status === "rented"; }).length;
    const area     = items.reduce(function(s: number, u: any) { return s + (u.area ?? 0); }, 0);
    const pct      = total > 0 ? Math.round(occupied / total * 100) : 0;
    const activeContracts = (p.contracts ?? []).filter(function(c: any) {
      return ["active","expiring","extended"].includes(c.status);
    });
    const revenue = activeContracts.reduce(function(s: number, c: any) {
      return s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
    }, 0);
    return { total, occupied, area, pct, activeContracts, revenue };
  }

  const typeInfo = function(v: string) {
    return PROPERTY_TYPES.find(function(t) { return t.value === v; }) ?? PROPERTY_TYPES[5];
  };

  return (
    <div dir="rtl" className="flex gap-5 h-[calc(100vh-120px)]">
      {/* רשימה */}
      <div className="w-80 shrink-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-slate-800">נכסים</h1>
            <button onClick={openNew}
              className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 font-bold">
              + חדש
            </button>
          </div>
          <input type="text" value={search} onChange={function(e) { setSearch(e.target.value); }}
            placeholder="חיפוש נכס..." className={ic} />
          {groups.length > 0 && (
            <div className="mt-2 text-xs text-slate-400">{groups.length} קבוצות | {properties.length} נכסים</div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-slate-400 text-sm">טוען...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">לא נמצאו נכסים</div>
          ) : (
            filtered.map(function(p) {
              const s = getStats(p);
              const ti = typeInfo(p.property_type);
              const isSelected = selected?.id === p.id;
              return (
                <div key={p.id}
                  onClick={function() { setSelected(p); }}
                  className={"flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-slate-50 " +
                    (isSelected ? "bg-blue-50 border-r-2 border-r-blue-600" : "hover:bg-slate-50")}>
                  <div className={"w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 " +
                    (isSelected ? "bg-blue-600" : "bg-slate-100")}>
                    {ti.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={"font-semibold text-sm truncate " + (isSelected ? "text-blue-800" : "text-slate-800")}>
                      {p.name}
                    </div>
                    <div className="text-xs text-slate-400">{p.city ?? p.address ?? ti.label}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={"text-xs font-bold " + (s.pct >= 80 ? "text-green-600" : s.pct >= 50 ? "text-yellow-600" : "text-red-500")}>
                      {s.pct}%
                    </div>
                    <div className="text-xs text-slate-400">{s.occupied}/{s.total}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* פירוט */}
      {selected ? (
        <div className="flex-1 rounded-xl border border-slate-200 bg-white shadow-sm overflow-y-auto">
          {(() => {
            const p  = selected;
            const s  = getStats(p);
            const ti = typeInfo(p.property_type);
            return (
              <div>
                {/* Header */}
                <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-100 flex items-center justify-between z-10">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-2xl">{ti.icon}</div>
                    <div>
                      <div className="font-bold text-slate-800 text-lg">{p.name}</div>
                      <div className="text-xs text-slate-400">{ti.label}{p.city ? " | " + p.city : ""}{p.property_groups?.name ? " | " + p.property_groups.name : ""}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function() { router.push("/units"); }}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                      🚪 יחידות
                    </button>
                    <button onClick={function() { openEdit(p); }}
                      className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                      ✏️ עריכה
                    </button>
                    <button onClick={function() { handleDelete(p.id, p.name); }}
                      className="rounded-lg border border-red-100 px-3 py-2 text-xs text-red-500 hover:bg-red-50">
                      🗑
                    </button>
                  </div>
                </div>

                {/* KPI */}
                <div className="grid grid-cols-4 gap-3 p-6 pb-0">
                  <div className="rounded-xl border border-slate-200 p-3 text-center">
                    <div className={"text-2xl font-black " + (s.pct >= 80 ? "text-green-700" : s.pct >= 50 ? "text-yellow-600" : "text-red-600")}>{s.pct}%</div>
                    <div className="text-xs text-slate-400">תפוסה</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3 text-center">
                    <div className="text-2xl font-black text-slate-800">{s.total}</div>
                    <div className="text-xs text-slate-400">יחידות</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3 text-center">
                    <div className="text-xl font-black text-green-700">₪{Math.round(s.revenue).toLocaleString()}</div>
                    <div className="text-xs text-slate-400">הכנסה/חודש</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3 text-center">
                    <div className="text-xl font-black text-slate-800">{s.area.toLocaleString()}</div>
                    <div className="text-xs text-slate-400">מ"ר</div>
                  </div>
                </div>

                {/* Progress */}
                <div className="px-6 pt-4">
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className={"h-2 rounded-full " + (s.pct >= 80 ? "bg-green-500" : s.pct >= 50 ? "bg-yellow-400" : "bg-red-400")}
                      style={{ width: s.pct + "%" }} />
                  </div>
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>{s.occupied} מושכרות</span>
                    <span>{s.total - s.occupied} פנויות</span>
                  </div>
                </div>

                {/* פרטים */}
                <div className="grid grid-cols-2 gap-4 p-6">
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-slate-500 uppercase">פרטי נכס</div>
                    {[
                      { label: "כתובת", value: p.address },
                      { label: "עיר", value: p.city },
                      { label: "שטח כולל", value: p.total_rentable_area ? p.total_rentable_area.toLocaleString() + " מ\"ר" : null },
                      { label: "דמי ניהול", value: p.mgmt_fee_per_sqm ? "₪" + p.mgmt_fee_per_sqm + "/מ\"ר" : null },
                      { label: "קבוצה", value: p.property_groups?.name },
                    ].map(function(row) {
                      if (!row.value) return null;
                      return (
                        <div key={row.label} className="flex justify-between items-center py-1.5 border-b border-slate-100">
                          <span className="text-xs text-slate-500">{row.label}</span>
                          <span className="text-sm font-medium text-slate-800">{row.value}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-slate-500 uppercase">חוזים פעילים ({s.activeContracts.length})</div>
                    {s.activeContracts.length === 0 ? (
                      <div className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                        אין חוזים פעילים
                      </div>
                    ) : (
                      s.activeContracts.map(function(c: any) {
                        const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                        return (
                          <div key={c.id}
                            onClick={function() { router.push("/contracts"); }}
                            className="rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-blue-50 transition-colors">
                            <div className="font-semibold text-slate-800 text-sm">{c.tenants?.name}</div>
                            <div className="text-xs text-green-700 font-bold">₪{Math.round(monthly).toLocaleString()}/חודש</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                {p.notes && (
                  <div className="mx-6 mb-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{p.notes}</div>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="flex-1 rounded-xl border-2 border-dashed border-slate-200 bg-white flex items-center justify-center">
          <div className="text-center text-slate-400">
            <div className="text-5xl mb-3">🏢</div>
            <div className="font-medium">בחר נכס מהרשימה</div>
            <div className="text-sm mt-1">או <button onClick={openNew} className="text-blue-600 hover:underline">הוסף נכס חדש</button></div>
          </div>
        </div>
      )}

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "נכס חדש" : "עריכת נכס"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם הנכס *</label>
                <input type="text" value={fName} onChange={function(e) { setFName(e.target.value); }} className={ic} placeholder="לדוגמה: מגדל עזריאלי" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג נכס</label>
                <div className="grid grid-cols-3 gap-2">
                  {PROPERTY_TYPES.map(function(t) {
                    return (
                      <button key={t.value} type="button" onClick={function() { setFType(t.value); }}
                        className={"rounded-lg border p-2 text-center transition-all " +
                          (fType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div className="text-xl">{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType === t.value ? "text-blue-700" : "text-slate-600")}>{t.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
                  <input type="text" value={fAddress} onChange={function(e) { setFAddress(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">עיר</label>
                  <input type="text" value={fCity} onChange={function(e) { setFCity(e.target.value); }} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שטח שכיר (מ"ר)</label>
                  <input type="number" value={fArea} onChange={function(e) { setFArea(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול (₪/מ"ר)</label>
                  <input type="number" value={fMgmtFee} onChange={function(e) { setFMgmtFee(e.target.value); }} className={ic} />
                </div>
              </div>
              {groups.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">קבוצת נכסים</label>
                  <select value={fGroupId} onChange={function(e) { setFGroupId(e.target.value); }} className={ic}>
                    <option value="">ללא קבוצה</option>
                    {groups.map(function(g) { return <option key={g.id} value={g.id}>{g.name}</option>; })}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} rows={3} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">ביטול</button>
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
