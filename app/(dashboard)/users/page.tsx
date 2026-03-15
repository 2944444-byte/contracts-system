"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400";

const ROLES = [
  { value: "admin",   label: "מנהל ראשי",  icon: "👑", color: "text-purple-700 bg-purple-50 border-purple-200" },
  { value: "manager", label: "מנהל נכסים", icon: "👤", color: "text-blue-700 bg-blue-50 border-blue-200"     },
  { value: "viewer",  label: "צפייה בלבד", icon: "👁️", color: "text-slate-600 bg-slate-50 border-slate-200"  },
];

export default function UsersPage() {
  const [users,    setUsers]    = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showNew,  setShowNew]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState("");

  const [fEmail,    setFEmail]    = useState("");
  const [fPassword, setFPassword] = useState("");
  const [fRole,     setFRole]     = useState("manager");
  const [fName,     setFName]     = useState("");

  useEffect(function() { loadUsers(); }, []);

  async function loadUsers() {
    // קרא מטבלת profiles שתיצור
    const { data } = await supabase.from("user_profiles")
      .select("*").order("created_at", { ascending: false });
    setUsers(data ?? []);
    setLoading(false);
  }

  async function handleCreate() {
    if (!fEmail || !fPassword) { alert("חובה: אימייל וסיסמה"); return; }
    setSaving(true);
    try {
      // יצירת משתמש דרך Supabase Auth Admin
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fEmail, password: fPassword, role: fRole, name: fName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      setMsg("✅ משתמש נוצר בהצלחה");
      setShowNew(false); setFEmail(""); setFPassword(""); setFRole("manager"); setFName("");
      setTimeout(function() { setMsg(""); }, 3000);
      await loadUsers();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function updateRole(userId: string, role: string) {
    await supabase.from("user_profiles").update({ role }).eq("id", userId);
    await loadUsers();
  }

  async function toggleActive(userId: string, isActive: boolean) {
    await supabase.from("user_profiles").update({ is_active: !isActive }).eq("id", userId);
    await loadUsers();
  }

  const roleInfo = function(v: string) {
    return ROLES.find(function(r) { return r.value === v; }) ?? ROLES[1];
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ניהול משתמשים</h1>
          <p className="text-sm text-slate-500 mt-1">{users.length} משתמשים</p>
        </div>
        <button onClick={function() { setShowNew(true); }}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + משתמש חדש
        </button>
      </div>

      {msg && (
        <div className="mb-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 font-semibold">
          {msg}
        </div>
      )}

      {/* תפקידים legend */}
      <div className="flex gap-3 mb-5 flex-wrap">
        {ROLES.map(function(r) {
          return (
            <div key={r.value} className={"rounded-xl border px-3 py-2 text-xs font-semibold " + r.color}>
              {r.icon} {r.label}
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : users.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">👥</div>
          <div>אין משתמשים — הוסף משתמש ראשון</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">משתמש</th>
                <th className="px-4 py-3 font-semibold">תפקיד</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">הצטרף</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {users.map(function(u) {
                const ri = roleInfo(u.role);
                return (
                  <tr key={u.id} className={"border-t border-slate-100 " + (!u.is_active ? "opacity-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">
                          {(u.full_name ?? u.email)?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800">{u.full_name ?? "—"}</div>
                          <div className="text-xs text-slate-400">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select value={u.role}
                        onChange={function(e) { updateRole(u.id, e.target.value); }}
                        className={"text-xs rounded-lg border px-2 py-1 font-semibold " + ri.color}>
                        {ROLES.map(function(r) { return <option key={r.value} value={r.value}>{r.icon} {r.label}</option>; })}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (u.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                        {u.is_active ? "פעיל" : "לא פעיל"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString("he-IL") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={function() { toggleActive(u.id, u.is_active); }}
                        className={"text-xs border rounded px-2 py-1 " +
                          (u.is_active ? "border-red-100 text-red-400 hover:bg-red-50" : "border-green-100 text-green-600 hover:bg-green-50")}>
                        {u.is_active ? "השבת" : "הפעל"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* מודל משתמש חדש */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setShowNew(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-800 text-lg">משתמש חדש</h2>
              <button onClick={function() { setShowNew(false); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם מלא</label>
                <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל *</label>
                <input type="email" value={fEmail} onChange={function(e){setFEmail(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סיסמה ראשונית *</label>
                <input type="password" value={fPassword} onChange={function(e){setFPassword(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">תפקיד</label>
                <div className="grid grid-cols-3 gap-2">
                  {ROLES.map(function(r) {
                    return (
                      <button key={r.value} type="button" onClick={function(){setFRole(r.value);}}
                        className={"rounded-xl border p-2.5 text-center transition-all " +
                          (fRole === r.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div className="text-xl">{r.icon}</div>
                        <div className={"text-xs font-semibold " + (fRole === r.value ? "text-blue-700" : "text-slate-600")}>{r.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={function(){setShowNew(false);}}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleCreate} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "יוצר..." : "צור משתמש"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
