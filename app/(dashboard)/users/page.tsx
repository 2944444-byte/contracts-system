"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
const ROLES = [{v:"admin",l:"מנהל מערכת",icon:"👑",color:"bg-red-100 text-red-700"},{v:"manager",l:"מנהל",icon:"👤",color:"bg-blue-100 text-blue-700"},{v:"viewer",l:"צופה",icon:"👁",color:"bg-slate-100 text-slate-600"}];

export default function UsersPage() {
  const [users,  setUsers]  = useState<any[]>([]);
  const [loading,setLoading]= useState(true);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState("");
  const [msg,    setMsg]    = useState("");
  const [fEmail,    setFEmail]    = useState("");
  const [fName,     setFName]     = useState("");
  const [fRole,     setFRole]     = useState("viewer");
  const [fPassword, setFPassword] = useState("");

  // Property-access assignment modal.
  const [properties, setProperties] = useState<any[]>([]);
  const [pgroups,     setPgroups]    = useState<any[]>([]);
  const [accessUser,  setAccessUser] = useState<any | null>(null);
  const [accessSel,   setAccessSel]  = useState<Record<string, boolean>>({});
  const [accessSaving,setAccessSaving]= useState(false);

  useEffect(function() { loadUsers(); }, []);

  async function loadUsers() {
    const [{ data }, { data: p }, { data: g }] = await Promise.all([
      supabase.from("user_profiles").select("*").order("created_at",{ascending:false}),
      supabase.from("properties").select("id,name,group_id").order("name"),
      supabase.from("property_groups").select("id,group_name").order("group_name"),
    ]);
    setUsers(data??[]); setProperties(p??[]); setPgroups(g??[]); setLoading(false);
  }

  // ─── Per-user property access (drives the letters CC mechanism) ───
  async function openAccess(u: any) {
    const { data } = await supabase.from("user_property_access").select("property_id").eq("user_id", u.id);
    const sel: Record<string, boolean> = {};
    (data ?? []).forEach(function(r: any){ sel[r.property_id] = true; });
    setAccessSel(sel);
    setAccessUser(u);
  }
  function toggleAccess(pid: string) {
    setAccessSel(function(prev){ var n = { ...prev }; if (n[pid]) delete n[pid]; else n[pid] = true; return n; });
  }
  function setGroupAccess(propIds: string[], on: boolean) {
    setAccessSel(function(prev){ var n = { ...prev }; propIds.forEach(function(id){ if (on) n[id] = true; else delete n[id]; }); return n; });
  }
  async function saveAccess() {
    if (!accessUser) return;
    setAccessSaving(true);
    try {
      const { data: cur } = await supabase.from("user_property_access").select("id,property_id").eq("user_id", accessUser.id);
      const curIds: Record<string, string> = {};
      (cur ?? []).forEach(function(r: any){ curIds[r.property_id] = r.id; });
      const want = Object.keys(accessSel).filter(function(k){ return accessSel[k]; });
      const toAdd = want.filter(function(pid){ return !curIds[pid]; });
      const toRemoveIds = Object.keys(curIds).filter(function(pid){ return !accessSel[pid]; }).map(function(pid){ return curIds[pid]; });
      if (toAdd.length > 0) {
        await supabase.from("user_property_access").insert(toAdd.map(function(pid){ return { user_id: accessUser.id, property_id: pid, role: accessUser.role || "manager" }; }));
      }
      if (toRemoveIds.length > 0) {
        await supabase.from("user_property_access").delete().in("id", toRemoveIds);
      }
      setAccessUser(null); showMsg("✅ הרשאות הנכסים נשמרו");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setAccessSaving(false); }
  }

  function showMsg(m: string) { setMsg(m); setTimeout(function(){setMsg("");},3000); }

  async function handleCreate() {
    if (!fEmail.trim()||!fPassword||!fName.trim()) { alert("חובה: אימייל + סיסמה + שם"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/create-user",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:fEmail.trim(),password:fPassword,fullName:fName.trim(),role:fRole})});
      const d = await res.json();
      if (!res.ok) throw new Error(d.error??"שגיאה");
      setEditId(""); showMsg("✅ משתמש נוצר"); await loadUsers();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleUpdateRole(id: string, role: string) {
    await supabase.from("user_profiles").update({role}).eq("id",id);
    showMsg("✅ תפקיד עודכן"); await loadUsers();
  }

  async function handleToggle(id: string, cur: boolean) {
    await supabase.from("user_profiles").update({is_active:!cur}).eq("id",id);
    showMsg(!cur?"✅ הופעל":"✅ הושבת"); await loadUsers();
  }

  const roleInfo = function(v: string) { return ROLES.find(function(r){return r.v===v;})??ROLES[2]; };

  return (
    <div dir="rtl">
      <PageHero title="משתמשים" subtitle={users.length + " משתמשים"} icon="👥" tone="slate"
        actionLabel="+ משתמש" onAction={function(){setEditId("new");setFEmail("");setFName("");setFRole("viewer");setFPassword("");}} />

      {msg && <div className={"mb-4 rounded-xl border px-4 py-3 text-sm font-semibold "+(msg.startsWith("✅")?"bg-green-50 border-green-200 text-green-700":"bg-red-50 border-red-200 text-red-700")}>{msg}</div>}

      <div className="grid grid-cols-3 gap-3 mb-5">
        {ROLES.map(function(r){const cnt=users.filter(function(u){return u.role===r.v&&u.is_active;}).length;return <div key={r.v} className="rounded-xl border border-slate-200 bg-white p-3 text-center"><div className="text-2xl">{r.icon}</div><div className="text-xl font-black text-slate-800">{cnt}</div><div className="text-xs text-slate-500">{r.l}</div></div>;})}
      </div>

      {loading ? <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div> : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b"><tr><th className="px-4 py-3 font-semibold text-slate-700">משתמש</th><th className="px-4 py-3 font-semibold text-slate-700">אימייל</th><th className="px-4 py-3 font-semibold text-slate-700">תפקיד</th><th className="px-4 py-3 font-semibold text-slate-700">סטטוס</th><th className="px-4 py-3 font-semibold text-slate-700">פעולות</th></tr></thead>
            <tbody>
              {users.map(function(u) {
                const ri=roleInfo(u.role);
                return (
                  <tr key={u.id} className={"border-t border-slate-100 "+(u.is_active?"hover:bg-slate-50":"opacity-50 bg-slate-50")}>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">{(u.full_name??u.email??"?")[0].toUpperCase()}</div><span className="font-semibold text-slate-800">{u.full_name??"—"}</span></div></td>
                    <td className="px-4 py-3 text-slate-500 text-xs" dir="ltr">{u.email}</td>
                    <td className="px-4 py-3"><span className={"text-xs px-2 py-0.5 rounded-full font-semibold "+ri.color}>{ri.icon} {ri.l}</span></td>
                    <td className="px-4 py-3"><span className={"text-xs px-2 py-0.5 rounded-full font-semibold "+(u.is_active?"bg-green-100 text-green-700":"bg-slate-100 text-slate-500")}>{u.is_active?"פעיל":"מושבת"}</span></td>
                    <td className="px-4 py-3"><div className="flex gap-1">
                      <select value={u.role} onChange={function(e){handleUpdateRole(u.id,e.target.value);}} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">{ROLES.map(function(r){return <option key={r.v} value={r.v}>{r.l}</option>;})}</select>
                      <button onClick={function(){openAccess(u);}} className="text-xs border border-indigo-200 text-indigo-600 rounded px-2 py-1 hover:bg-indigo-50" title="שייך נכסים — מי שמשויך מקבל עותק (CC) של מכתבי החיובים לאותו נכס">🏢 נכסים</button>
                      <button onClick={function(){handleToggle(u.id,u.is_active);}} className={"text-xs border rounded px-2 py-1 "+(u.is_active?"border-red-100 text-red-500 hover:bg-red-50":"border-green-200 text-green-600 hover:bg-green-50")}>{u.is_active?"השבת":"הפעל"}</button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editId==="new" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="px-6 py-4 border-b flex items-center justify-between"><h2 className="font-bold text-slate-800 text-lg">משתמש חדש</h2><button onClick={function(){setEditId("");}} className="text-2xl text-slate-400">×</button></div>
            <div className="p-6 space-y-4">
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">שם מלא *</label><input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">אימייל *</label><input type="email" value={fEmail} onChange={function(e){setFEmail(e.target.value);}} className={ic} dir="ltr"/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">סיסמה *</label><input type="password" value={fPassword} onChange={function(e){setFPassword(e.target.value);}} className={ic}/></div>
              <div><label className="mb-2 block text-xs font-semibold text-slate-700">תפקיד</label><div className="grid grid-cols-3 gap-2">{ROLES.map(function(r){return <button key={r.v} type="button" onClick={function(){setFRole(r.v);}} className={"rounded-xl border p-2.5 text-center "+(fRole===r.v?"border-blue-500 bg-blue-50":"border-slate-200 hover:bg-slate-50")}><div className="text-xl">{r.icon}</div><div className={"text-xs font-semibold "+(fRole===r.v?"text-blue-700":"text-slate-600")}>{r.l}</div></button>;})}</div></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleCreate} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"יוצר...":"צור משתמש"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Property-access assignment ─── */}
      {accessUser && (() => {
        var ungrouped = properties.filter(function(p){ return !p.group_id; });
        var selCount = Object.keys(accessSel).filter(function(k){ return accessSel[k]; }).length;
        var renderProp = function(p: any) {
          var on = !!accessSel[p.id];
          return (
            <label key={p.id} className={"flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm "+(on?"border-indigo-300 bg-indigo-50":"border-slate-200 hover:bg-slate-50")}>
              <input type="checkbox" checked={on} onChange={function(){toggleAccess(p.id);}} className="w-4 h-4 accent-indigo-600"/>
              <span className="text-slate-700">{p.name}</span>
            </label>
          );
        };
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setAccessUser(null);}}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-800 text-lg">נכסים מורשים — {accessUser.full_name || accessUser.email}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">המשתמש יקבל עותק (CC) של מכתבי החיובים לנכסים המסומנים. {selCount} נבחרו.</p>
                </div>
                <button onClick={function(){setAccessUser(null);}} className="text-2xl text-slate-400">×</button>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex gap-2">
                  <button onClick={function(){setGroupAccess(properties.map(function(p){return p.id;}), true);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">בחר הכל</button>
                  <button onClick={function(){setGroupAccess(properties.map(function(p){return p.id;}), false);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">נקה הכל</button>
                </div>
                {pgroups.map(function(g){
                  var gp = properties.filter(function(p){ return p.group_id === g.id; });
                  if (gp.length === 0) return null;
                  var allOn = gp.every(function(p){ return accessSel[p.id]; });
                  return (
                    <div key={g.id}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm font-bold text-slate-700">📁 {g.group_name}</span>
                        <button onClick={function(){setGroupAccess(gp.map(function(p){return p.id;}), !allOn);}} className="text-[11px] text-indigo-600 hover:underline">{allOn?"נקה קבוצה":"בחר קבוצה"}</button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{gp.map(renderProp)}</div>
                    </div>
                  );
                })}
                {ungrouped.length > 0 && (
                  <div>
                    <div className="text-sm font-bold text-slate-700 mb-1.5">🏢 ללא קבוצה</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{ungrouped.map(renderProp)}</div>
                  </div>
                )}
                {properties.length === 0 && <div className="text-sm text-slate-400 text-center py-6">אין נכסים</div>}
                <div className="flex gap-3 pt-2">
                  <button onClick={function(){setAccessUser(null);}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                  <button onClick={saveAccess} disabled={accessSaving} className="flex-1 rounded-xl bg-indigo-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{accessSaving?"שומר...":"שמור הרשאות"}</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
