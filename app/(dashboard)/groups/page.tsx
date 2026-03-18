"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function GroupsPage() {
  const router = useRouter();
  const [groups,     setGroups]     = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [fName,  setFName]  = useState("");
  const [fNotes, setFNotes] = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: g }, { data: p }] = await Promise.all([
      supabase.from("property_groups").select("*").order("name"),
      supabase.from("properties").select("id,name,group_id").order("name"),
    ]);
    setGroups(g??[]); setProperties(p??[]); setLoading(false);
  }

  function openNew() { setIsNew(true); setEditingId("new"); setFName(""); setFNotes(""); }
  function openEdit(g: any) { setIsNew(false); setEditingId(g.id); setFName(g.name??""); setFNotes(g.notes??""); }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם קבוצה"); return; }
    setSaving(true);
    try {
      if (isNew) { const { data } = await supabase.from("property_groups").insert({name:fName.trim(),notes:fNotes||null}).select().single(); await logAudit({entity_type:"group",entity_id:data.id,action:"create"}); }
      else { await supabase.from("property_groups").update({name:fName.trim(),notes:fNotes||null}).eq("id",editingId); }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק קבוצה?")) return;
    await supabase.from("property_groups").delete().eq("id",id); await loadAll();
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div><h1 className="text-3xl font-bold text-slate-800">קבוצות נכסים</h1>
        <p className="text-sm text-slate-500 mt-1">{groups.length} קבוצות | {properties.filter(function(p){return p.group_id;}).length}/{properties.length} נכסים משויכים</p></div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">+ קבוצה</button>
      </div>

      {loading ? <div className="text-center py-12 text-slate-400">טוען...</div> : groups.length===0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400"><div className="text-5xl mb-3">📁</div><div>אין קבוצות</div><button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ צור קבוצה</button></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.map(function(g) {
            const props=properties.filter(function(p){return p.group_id===g.id;});
            return (
              <div key={g.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                <div className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2"><span className="text-2xl">📁</span><h3 className="font-bold text-slate-800">{g.name}</h3></div>
                    <div className="flex gap-1"><button onClick={function(){openEdit(g);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">✏️</button><button onClick={function(){handleDelete(g.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button></div>
                  </div>
                  {g.notes&&<div className="text-xs text-slate-500 mb-3">{g.notes}</div>}
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-500 mb-2">נכסים ({props.length})</div>
                    {props.length===0 ? <div className="text-xs text-slate-400">אין נכסים</div> : (
                      <div className="space-y-1">{props.slice(0,4).map(function(p){return <div key={p.id} className="flex items-center gap-2 text-xs text-slate-700"><span>🏢</span><span>{p.name}</span></div>;})}
                      {props.length>4&&<div className="text-xs text-slate-400">+{props.length-4} נוספים...</div>}</div>
                    )}
                  </div>
                </div>
                <div className="border-t border-slate-100 px-5 py-2.5 flex justify-between items-center">
                  <span className="text-xs text-slate-400">{props.length} נכסים</span>
                  <button onClick={function(){router.push("/properties");}} className="text-xs text-blue-600 hover:underline">נהל →</button>
                </div>
              </div>
            );
          })}
          {properties.filter(function(p){return !p.group_id;}).length>0&&(
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-2 mb-3"><span className="text-2xl">📋</span><h3 className="font-semibold text-slate-600">ללא קבוצה</h3></div>
              <div className="space-y-1">{properties.filter(function(p){return !p.group_id;}).map(function(p){return <div key={p.id} className="text-xs text-slate-500 flex items-center gap-1"><span>🏢</span><span>{p.name}</span></div>;})}</div>
            </div>
          )}
        </div>
      )}

      {editingId&&(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="px-6 py-4 border-b flex items-center justify-between"><h2 className="font-bold text-slate-800 text-lg">{isNew?"קבוצה חדשה":"עריכה"}</h2><button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button></div>
            <div className="p-6 space-y-4">
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">שם *</label><input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} placeholder="מרכז מסחרי / קמפוס"/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={3} className={ic}/></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"שומר...":"שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
