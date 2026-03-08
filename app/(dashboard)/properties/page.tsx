"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import PropertyForm from "../../../components/PropertyForm";
import PropertyBudgetManager from "../../../components/PropertyBudgetManager";

const TYPE_COLORS: Record<string, string> = {
  "משרדים": "bg-blue-100 text-blue-700", "מסחרי": "bg-purple-100 text-purple-700",
  "תעשייתי": "bg-orange-100 text-orange-700", "לוגיסטי": "bg-yellow-100 text-yellow-700",
  "מעורב": "bg-teal-100 text-teal-700", "אחר": "bg-slate-100 text-slate-600",
};

export default function PropertiesPage() {
  const [properties, setProperties] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [budgetFor, setBudgetFor] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: u }, { data: c }] = await Promise.all([
      supabase.from("properties").select("*").order("created_at", { ascending: false }),
      supabase.from("units").select("id, property_id, status"),
      supabase.from("contracts").select("id, unit_id, status, rent_per_sqm, area_m2").in("status", ["active","expiring"]),
    ]);
    setProperties(p ?? []);
    setUnits(u ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(data: any) {
    if (editing) await supabase.from("properties").update(data).eq("id", editing.id);
    else await supabase.from("properties").insert(data);
    setShowForm(false); setEditing(null); await load();
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק נכס זה? כל היחידות והחוזים יימחקו.")) return;
    await supabase.from("properties").delete().eq("id", id);
    setProperties(prev => prev.filter(p => p.id !== id));
  }

  function propStats(propId: string) {
    const propUnits = units.filter(u => u.property_id === propId);
    const occupied = propUnits.filter(u => ["occupied","expiring"].includes(u.status)).length;
    const propContracts = contracts.filter(c => propUnits.some(u => u.id === c.unit_id));
    const revenue = propContracts.reduce((s, c) => s + (c.rent_per_sqm ?? 0) * (c.area_m2 ?? 0), 0);
    return { total: propUnits.length, occupied, revenue };
  }

  const filtered = properties.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.address?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div dir="rtl" className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">🏢 ניהול נכסים</h1>
          <p className="text-sm text-slate-500 mt-1">{properties.length} נכסים במערכת</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800">
          ＋ נכס חדש
        </button>
      </div>

      <div className="mb-5">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 חיפוש לפי שם או כתובת..."
          className="w-full max-w-md rounded-lg border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-right bg-white" />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array(6).fill(0).map((_,i) => <div key={i} className="h-52 rounded-2xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-16 text-center">
          <div className="text-5xl mb-4">🏢</div>
          <p className="text-slate-500">{search ? "לא נמצאו נכסים" : "אין נכסים — לחץ נכס חדש"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(prop => {
            const { total, occupied, revenue } = propStats(prop.id);
            const pct = total > 0 ? Math.round((occupied/total)*100) : 0;
            const insuranceSoon = prop.insurance_renewal_date &&
              new Date(prop.insurance_renewal_date) < new Date(Date.now() + 60*86400000);
            return (
              <div key={prop.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                <div className="p-5 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold mb-2 ${TYPE_COLORS[prop.property_type] ?? TYPE_COLORS["אחר"]}`}>
                        {prop.property_type ?? "אחר"}
                      </span>
                      <h2 className="font-bold text-lg text-slate-800 leading-tight">{prop.name}</h2>
                      {prop.address && <p className="text-xs text-slate-400 mt-0.5">📍 {prop.address}</p>}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => { setEditing(prop); setShowForm(true); }}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 text-xs">✏️</button>
                      <button onClick={() => handleDelete(prop.id)}
                        className="rounded-lg border border-red-100 p-1.5 text-red-400 hover:bg-red-50 text-xs">🗑</button>
                    </div>
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="font-bold text-slate-800">{total}</div>
                      <div className="text-xs text-slate-400">יחידות</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-2">
                      <div className="font-bold text-green-700">{occupied}</div>
                      <div className="text-xs text-slate-400">תפוסות</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-2">
                      <div className="font-bold text-blue-700">{pct}%</div>
                      <div className="text-xs text-slate-400">תפוסה</div>
                    </div>
                  </div>
                  {prop.total_rentable_area > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">שטח להשכרה</span>
                      <span className="font-semibold">{prop.total_rentable_area?.toLocaleString()} מ&quot;ר</span>
                    </div>
                  )}
                  {revenue > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">הכנסה חודשית</span>
                      <span className="font-semibold text-green-700">₪{Math.round(revenue).toLocaleString()}</span>
                    </div>
                  )}
                  {prop.parking_spaces > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">חניות</span>
                      <span className="font-semibold">{prop.parking_spaces}</span>
                    </div>
                  )}
                  {prop.insurance_renewal_date && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">חידוש ביטוח</span>
                      <span className={`font-semibold ${insuranceSoon ? "text-orange-600" : "text-slate-600"}`}>
                        {insuranceSoon && "⚠️ "}{new Date(prop.insurance_renewal_date).toLocaleDateString("he-IL")}
                      </span>
                    </div>
                  )}
                  <button onClick={() => setBudgetFor(prop)}
                    className="w-full rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 mt-1">
                    📊 ניהול תקציבים שנתיים
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-bold text-lg text-slate-800">{editing ? "עריכת נכס" : "נכס חדש"}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null); }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-5">
              <PropertyForm property={editing} onSubmit={handleSubmit} onCancel={() => { setShowForm(false); setEditing(null); }} />
            </div>
          </div>
        </div>
      )}

      {budgetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <PropertyBudgetManager propertyId={budgetFor.id} propertyName={budgetFor.name} onClose={() => setBudgetFor(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
