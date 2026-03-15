"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function GroupsPage() {
  const [groups,    setGroups]    = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editingId, setEditingId] = useState("");
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [selected,  setSelected]  = useState<any>(null);

  const [fName,    setFName]    = useState("");
  const [fDesc,    setFDesc]    = useState("");
  const [fManager, setFManager] = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const { data } = await supabase.from("property_groups")
      .select("*, properties(id, name, property_type, spaces(id,status), units(id,status), contracts(id,status,rent_per_sqm,charged_area,investment_addition,tenants(name)))")
      .order("name");
    setGroups(data ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFDesc(""); setFManager("");
  }

  function openEdit(g: any) {
    setIsNew(false); setEditingId(g.id);
    setFName(g.name ?? ""); setFDesc(g.description ?? ""); setFManager(g.manager ?? "");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם קבוצה"); return; }
    setSaving(true);
    try {
      const payload = { name: fName.trim(), description: fDesc || null, manager: fManager || null };
      if (isNew) {
        const { data } = await supabase.from("property_groups").insert(payload).select().single();
        await logAudit({ entity_type: "property_group", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("property_groups").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "property_group", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm("למחוק קבוצה \"" + name + "\"? הנכסים בה לא יימחקו.")) return;
    await supabase.from("property_groups").delete().eq("id", id);
    if (selected?.id === id) setSelected(null);
    await loadAll();
  }

  function getGroupStats(g: any) {
    const props = g.properties ?? [];
    const allSpaces = props.flatMap(function(p: any) { return p.spaces?.length ? p.spaces : p.units ?? []; });
    const occupied  = allSpaces.filter(function(u: any) { return u.status === "rented"; }).length;
    const pct       = allSpaces.length > 0 ? Math.round(occupied / allSpaces.length * 100) : 0;
    const activeContracts = props.flatMap(function(p: any) {
      return (p.contracts ?? []).filter(function(c: any) { return ["active","expiring","extended"].includes(c.status); });
    });
    const revenue = activeContracts.reduce(function(s: number, c: any) {
      return s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
    }, 0);
    return { propCount: props.length, unitCount: allSpaces.length, occupied, pct, revenue, contractCount: activeContracts.length };
  }

  const totalRevenue = groups.reduce(function(s, g) { return s + getGroupStats(g).revenue; }, 0);
  const totalProps   = groups.reduce(function(s, g) { return s + getGroupStats(g).propCount; }, 0);

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">קבוצות נכסים</h1>
          <p className="text-sm text-slate-500 mt-1">
            {groups.length} קבוצות | {totalProps} נכסים | ₪{Math.round(totalRevenue).toLocaleString()}/חודש
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + קבוצה חדשה
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🏗️</div>
          <div>אין קבוצות נכסים</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ צור קבוצה</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.map(function(g) {
            const s = getGroupStats(g);
            return (
              <div key={g.id} className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center text-xl">
                      🏗️
                    </div>
                    <div>
                      <div className="font-bold text-slate-800">{g.name}</div>
                      {g.manager && <div className="text-xs text-slate-400">מנהל: {g.manager}</div>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={function() { openEdit(g); }}
                      className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">
                      ✏️
                    </button>
                    <button onClick={function() { handleDelete(g.id, g.name); }}
                      className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">
                      🗑
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="text-center rounded-lg bg-slate-50 p-2">
                    <div className="text-lg font-black text-slate-800">{s.propCount}</div>
                    <div className="text-xs text-slate-400">נכסים</div>
                  </div>
                  <div className="text-center rounded-lg bg-slate-50 p-2">
                    <div className={"text-lg font-black " + (s.pct >= 80 ? "text-green-700" : s.pct >= 50 ? "text-yellow-600" : "text-red-600")}>
                      {s.pct}%
                    </div>
                    <div className="text-xs text-slate-400">תפוסה</div>
                  </div>
                  <div className="text-center rounded-lg bg-slate-50 p-2">
                    <div className="text-lg font-black text-green-700">
                      ₪{s.revenue >= 1000 ? Math.round(s.revenue/1000) + "K" : Math.round(s.revenue)}
                    </div>
                    <div className="text-xs text-slate-400">/חודש</div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-1.5 mb-3">
                  <div className={"h-1.5 rounded-full " + (s.pct >= 80 ? "bg-green-500" : s.pct >= 50 ? "bg-yellow-400" : "bg-red-400")}
                    style={{ width: s.pct + "%" }} />
                </div>

                {/* רשימת נכסים */}
                {s.propCount > 0 && (
                  <div className="space-y-1">
                    {(g.properties ?? []).slice(0, 3).map(function(p: any) {
                      return (
                        <div key={p.id} className="flex items-center justify-between text-xs text-slate-500 py-0.5">
                          <span>🏢 {p.name}</span>
                        </div>
                      );
                    })}
                    {s.propCount > 3 && (
                      <div className="text-xs text-blue-500">+ {s.propCount - 3} נכסים נוספים</div>
                    )}
                  </div>
                )}

                {g.description && (
                  <div className="mt-3 text-xs text-slate-400 border-t border-slate-100 pt-2">{g.description}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "קבוצה חדשה" : "עריכת קבוצה"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם הקבוצה *</label>
                <input type="text" value={fName} onChange={function(e) { setFName(e.target.value); }}
                  className={ic} placeholder="לדוגמה: מגדלי תל אביב" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מנהל אחראי</label>
                <input type="text" value={fManager} onChange={function(e) { setFManager(e.target.value); }}
                  className={ic} placeholder="שם המנהל" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תיאור</label>
                <textarea value={fDesc} onChange={function(e) { setFDesc(e.target.value); }}
                  rows={2} className={ic} placeholder="תיאור קצר..." />
              </div>
              <div className="flex gap-3 pt-1">
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
