"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function PropertyGroupsPage() {
  const router = useRouter();
  const [groups,     setGroups]     = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);

  const [fName,  setFName]  = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fProps, setFProps] = useState<string[]>([]);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: g }, { data: p }] = await Promise.all([
      supabase.from("property_groups").select("*, properties(id, name, total_rentable_area)").order("name"),
      supabase.from("properties").select("id, name, total_rentable_area, group_id").order("name"),
    ]);
    setGroups(g ?? []);
    setProperties(p ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFNotes(""); setFProps([]);
  }

  function openEdit(g: any) {
    setIsNew(false); setEditingId(g.id);
    setFName(g.name ?? ""); setFNotes(g.notes ?? "");
    setFProps((g.properties ?? []).map(function(p: any) { return p.id; }));
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם קבוצה"); return; }
    setSaving(true);
    try {
      let groupId = editingId;
      if (isNew) {
        const { data } = await supabase.from("property_groups")
          .insert({ name: fName.trim(), notes: fNotes || null })
          .select().single();
        groupId = data.id;
      } else {
        await supabase.from("property_groups")
          .update({ name: fName.trim(), notes: fNotes || null })
          .eq("id", editingId);
      }
      // שייך נכסים
      await supabase.from("properties").update({ group_id: null })
        .eq("group_id", groupId);
      if (fProps.length > 0) {
        await supabase.from("properties").update({ group_id: groupId })
          .in("id", fProps);
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm("למחוק קבוצה \"" + name + "\"? הנכסים ישוחררו מהקבוצה.")) return;
    await supabase.from("properties").update({ group_id: null }).eq("group_id", id);
    await supabase.from("property_groups").delete().eq("id", id);
    await loadAll();
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">קבוצות נכסים</h1>
          <p className="text-sm text-slate-500 mt-1">ניהול וקיבוץ נכסים לדיווח משותף</p>
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
          <div className="text-5xl mb-3">🏙️</div>
          <div className="font-medium">אין קבוצות נכסים</div>
          <div className="text-sm mt-1">קבוצות מאפשרות דיווח מאוחד על מספר נכסים</div>
          <button onClick={openNew} className="mt-4 text-blue-600 hover:underline text-sm">+ צור קבוצה ראשונה</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map(function(g) {
            const props   = g.properties ?? [];
            const area    = props.reduce(function(s: number, p: any) { return s + (p.total_rentable_area ?? 0); }, 0);
            return (
              <div key={g.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-800 text-lg">🏙️ {g.name}</div>
                    {g.notes && <div className="text-xs text-slate-400 mt-0.5">{g.notes}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function() { openEdit(g); }}
                      className="text-xs border border-blue-200 rounded-lg px-3 py-1.5 text-blue-700 hover:bg-blue-50 font-semibold">
                      עריכה
                    </button>
                    <button onClick={function() { handleDelete(g.id, g.name); }}
                      className="text-xs border border-red-100 rounded-lg px-3 py-1.5 text-red-500 hover:bg-red-50">
                      מחיקה
                    </button>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex gap-4 text-sm mb-3">
                    <div className="text-center">
                      <div className="font-bold text-slate-800">{props.length}</div>
                      <div className="text-xs text-slate-400">נכסים</div>
                    </div>
                    {area > 0 && (
                      <div className="text-center">
                        <div className="font-bold text-slate-800">{area.toLocaleString()}</div>
                        <div className="text-xs text-slate-400">מ"ר</div>
                      </div>
                    )}
                  </div>
                  {props.length > 0 ? (
                    <div className="space-y-1">
                      {props.map(function(p: any) {
                        return (
                          <div key={p.id}
                            onClick={function() { router.push("/properties"); }}
                            className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">
                            <span className="font-medium text-slate-700">🏢 {p.name}</span>
                            {p.total_rentable_area && (
                              <span className="text-xs text-slate-400">{p.total_rentable_area.toLocaleString()} מ"ר</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 text-center py-2">אין נכסים בקבוצה</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* נכסים לא משויכים */}
      {properties.filter(function(p) { return !p.group_id; }).length > 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-white p-4">
          <div className="text-xs font-bold text-slate-400 mb-2">נכסים ללא קבוצה:</div>
          <div className="flex flex-wrap gap-2">
            {properties.filter(function(p) { return !p.group_id; }).map(function(p) {
              return (
                <span key={p.id} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                  🏢 {p.name}
                </span>
              );
            })}
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
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "קבוצה חדשה" : "עריכת קבוצה"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם הקבוצה *</label>
                <input type="text" value={fName}
                  onChange={function(e) { setFName(e.target.value); }} className={ic}
                  placeholder="לדוגמה: נכסי תל אביב / קבוצת מרכז" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes}
                  onChange={function(e) { setFNotes(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">
                  נכסים בקבוצה ({fProps.length} נבחרו)
                </label>
                <div className="space-y-1.5 rounded-lg border border-slate-200 p-3 bg-slate-50 max-h-48 overflow-y-auto">
                  {properties.map(function(p) {
                    const checked = fProps.includes(p.id);
                    return (
                      <label key={p.id} className="flex items-center gap-3 cursor-pointer hover:bg-white rounded-lg p-2">
                        <input type="checkbox" checked={checked}
                          onChange={function() {
                            setFProps(function(prev) {
                              return prev.includes(p.id)
                                ? prev.filter(function(x) { return x !== p.id; })
                                : [...prev, p.id];
                            });
                          }} className="w-4 h-4" />
                        <span className="text-sm font-medium text-slate-800">{p.name}</span>
                        {p.total_rentable_area && (
                          <span className="text-xs text-slate-400 mr-auto">{p.total_rentable_area.toLocaleString()} מ"ר</span>
                        )}
                      </label>
                    );
                  })}
                </div>
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
