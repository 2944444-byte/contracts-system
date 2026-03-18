"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';

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

  useEffect(function() { loadUsers(); }, []);

  async function loadUsers() {
    const { data } = await supabase.from("user_profiles").select("*").order("created_at",{ascending:false});
    setUsers(data??[]); setLoading(false);
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
      <div className="mb-6 flex items-center justify-between">
        <div><h1 className="text-3xl font-bold text-slate-800">משתמשים</h1><p className="text-sm text-slate-500 mt-1">{users.length} משתמשים</p></div>
        <button onClick={function(){setEditId("new");setFEmail("");setFName("");setFRole("viewer");setFPassword("");}} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">+ משתמש</button>
      </div>

      {msg && <div className={"mb-4 rounded-xl border px-4 py-3 text-sm font-semibold "+(msg.startsWith("✅")?"bg-green-50 border-green-200 text-green-700":"bg-red-50 border-red-200 text-red-700")}>{msg}</div>}

      <div className="grid grid-cols-3 gap-3 mb-5">
        {ROLES.map(function(r){const cnt=users.filter(function(u){return u.role===r.v&&u.is_active;}).length;return <div key={r.v} className="rounded-xl border border-slate-200 bg-white p-3 text-center"><div className="text-2xl">{r.icon}</div><div className="text-xl font-black text-slate-800">{cnt}</div><div className="text-xs text-slate-500">{r.l}</div></div>;})}
      </div>

      {loading ? <div className="text-center py-12 text-slate-400">טוען...</div> : (
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
    </div>
  );
}
