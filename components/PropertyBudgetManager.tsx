"use client";
import { useEffect, useState } from "react";
import { getPropertyBudgets, upsertPropertyBudget, deletePropertyBudget } from "../lib/db-helpers";

interface Props { propertyId: string; propertyName: string; onClose: () => void; }

export default function PropertyBudgetManager({ propertyId, propertyName, onClose }: Props) {
  const [budgets, setBudgets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const currentYear = new Date().getFullYear();

  async function load() {
    setLoading(true);
    setBudgets(await getPropertyBudgets(propertyId));
    setLoading(false);
  }
  useEffect(() => { load(); }, [propertyId]);

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await upsertPropertyBudget(editing);
      setMsg("✅ נשמר"); setEditing(null); await load();
    } catch { setMsg("שגיאה בשמירה"); }
    setSaving(false); setTimeout(() => setMsg(""), 3000);
  }

  const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400";
  const total = (b: any) => (b.management_budget||0) + (b.waste_cost||0) + (b.insurance_cost||0);

  return (
    <div dir="rtl" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg text-slate-800">תקציבים שנתיים</h2>
          <p className="text-xs text-slate-400">{propertyName}</p>
        </div>
        <button onClick={() => setEditing({ property_id: propertyId, year: currentYear+1, management_budget: 0, waste_cost: 0, insurance_cost: 0 })}
          className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-800">＋ הוסף שנה</button>
      </div>

      {loading ? <div className="text-center py-8 text-slate-400">טוען...</div> : (
        <div className="overflow-x-auto">
        <table className="w-full text-right text-sm min-w-[640px]">
          <thead className="text-xs text-slate-500 border-b bg-slate-50">
            <tr>
              <th className="px-3 py-2">שנה</th><th className="px-3 py-2">ניהול</th>
              <th className="px-3 py-2">אשפה</th><th className="px-3 py-2">ביטוח</th>
              <th className="px-3 py-2">סה&quot;כ</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {budgets.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-400">אין תקציבים — לחץ &quot;הוסף שנה&quot;</td></tr>}
            {budgets.map(b => (
              <tr key={b.id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2.5 font-bold">{b.year}</td>
                <td className="px-3 py-2.5">₪{b.management_budget?.toLocaleString()}</td>
                <td className="px-3 py-2.5">₪{b.waste_cost?.toLocaleString()}</td>
                <td className="px-3 py-2.5">₪{b.insurance_cost?.toLocaleString()}</td>
                <td className="px-3 py-2.5 font-bold">₪{total(b).toLocaleString()}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1">
                    <button onClick={() => setEditing({...b})} className="rounded px-2 py-1 text-xs border border-slate-200 hover:bg-slate-100">✏️</button>
                    <button onClick={async () => { if(!confirm("למחוק?")) return; await deletePropertyBudget(b.id); setBudgets(p => p.filter(x => x.id !== b.id)); }}
                      className="rounded px-2 py-1 text-xs border border-red-200 text-red-500 hover:bg-red-50">🗑</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {editing && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-4">
          <h3 className="font-bold text-slate-700">{editing.id ? `עריכת ${editing.year}` : "תקציב חדש"}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
              <input type="number" value={editing.year} disabled={!!editing.id}
                onChange={e => setEditing((p: any) => ({...p, year: Number(e.target.value)}))}
                className={ic + " disabled:bg-slate-100"} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול שנתי (₪)</label>
              <input type="number" value={editing.management_budget}
                onChange={e => setEditing((p: any) => ({...p, management_budget: Number(e.target.value)}))} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">עלות אשפה (₪)</label>
              <input type="number" value={editing.waste_cost}
                onChange={e => setEditing((p: any) => ({...p, waste_cost: Number(e.target.value)}))} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">עלות ביטוח (₪)</label>
              <input type="number" value={editing.insurance_cost}
                onChange={e => setEditing((p: any) => ({...p, insurance_cost: Number(e.target.value)}))} className={ic} />
            </div>
          </div>
          <div className="rounded-lg bg-white border px-4 py-3 flex justify-between text-sm">
            <span className="text-slate-600">סה&quot;כ שנתי</span>
            <span className="font-bold">₪{total(editing).toLocaleString()}</span>
          </div>
          {msg && <div className={`rounded px-3 py-1.5 text-sm ${msg.includes("שגיאה") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{msg}</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
            <button onClick={handleSave} disabled={saving}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              {saving ? "שומר..." : "💾 שמור"}
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2 border-t">
        <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">סגור</button>
      </div>
    </div>
  );
}
