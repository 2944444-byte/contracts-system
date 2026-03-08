"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import TenantForm from "../../../components/TenantForm";

export default function TenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from("tenants").select("*").order("created_at", { ascending: false }),
      supabase.from("contracts").select("id, tenant_id, status").in("status", ["active","expiring","upcoming"]),
    ]);
    setTenants(t ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(data: any) {
    if (editing) await supabase.from("tenants").update(data).eq("id", editing.id);
    else await supabase.from("tenants").insert(data);
    setShowForm(false); setEditing(null); await load();
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק שוכר זה?")) return;
    await supabase.from("tenants").delete().eq("id", id);
    setTenants(prev => prev.filter(t => t.id !== id));
  }

  const filtered = tenants.filter(t =>
    t.legal_name?.includes(search) || t.name?.includes(search) || t.phone?.includes(search) ||
    t.primary_email?.toLowerCase().includes(search.toLowerCase())
  );

  function contractCount(tenantId: string) {
    return contracts.filter(c => c.tenant_id === tenantId).length;
  }

  return (
    <div dir="rtl" className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">👥 ניהול שוכרים</h1>
          <p className="text-sm text-slate-500 mt-1">{tenants.length} שוכרים במערכת</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800">
          ＋ שוכר חדש
        </button>
      </div>

      <div className="mb-5">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 חיפוש לפי שם, טלפון או אימייל..."
          className="w-full max-w-md rounded-lg border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-right bg-white" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 border-b text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3">שם שוכר</th>
              <th className="px-5 py-3">ת.ז / ח.פ</th>
              <th className="px-5 py-3">טלפון</th>
              <th className="px-5 py-3">אימייל</th>
              <th className="px-5 py-3">חוזים פעילים</th>
              <th className="px-5 py-3">אנשי קשר</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array(4).fill(0).map((_,i) => (
              <tr key={i} className="border-t animate-pulse">
                {Array(7).fill(0).map((_,j) => <td key={j} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded w-24" /></td>)}
              </tr>
            )) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="py-16 text-center text-slate-400">
                {search ? "לא נמצאו שוכרים" : "אין שוכרים — לחץ שוכר חדש"}
              </td></tr>
            ) : filtered.map(t => (
              <tr key={t.id} className="border-t hover:bg-slate-50">
                <td className="px-5 py-3 font-semibold text-slate-800">{t.legal_name ?? t.name}</td>
                <td className="px-5 py-3 text-slate-500">{t.id_number ?? "—"}</td>
                <td className="px-5 py-3 text-slate-800 font-medium">{t.phone ?? "—"}</td>
                <td className="px-5 py-3 text-blue-600">{t.primary_email ?? "—"}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${contractCount(t.id) > 0 ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {contractCount(t.id)}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-400 text-xs">
                  {t.contacts?.length > 0 ? `${t.contacts.length} איש קשר` : "—"}
                </td>
                <td className="px-5 py-3">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setEditing(t); setShowForm(true); }}
                      className="rounded-lg border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={() => handleDelete(t.id)}
                      className="rounded-lg border border-red-100 px-3 py-1 text-xs text-red-500 hover:bg-red-50">🗑</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-bold text-lg text-slate-800">{editing ? "עריכת שוכר" : "שוכר חדש"}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null); }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-5">
              <TenantForm tenant={editing} onSubmit={handleSubmit} onCancel={() => { setShowForm(false); setEditing(null); }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
