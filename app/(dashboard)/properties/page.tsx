"use client";
import { useEffect, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function formatDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

const PROPERTY_TYPES: Record<string, string> = {
  commercial:  "מסחרי",
  offices:     "משרדים",
  logistics:   "לוגיסטי",
  warehouse:   "מחסן",
  mixed:       "מעורב",
  other:       "אחר",
};

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function PropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // מודל עריכה / יצירה
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [isNew, setIsNew]             = useState(false);
  const [editName, setEditName]       = useState("");
  const [editAlias, setEditAlias]     = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCity, setEditCity]       = useState("");
  const [editType, setEditType]       = useState("commercial");
  const [editArea, setEditArea]       = useState("");
  const [editNotes, setEditNotes]     = useState("");
  const [saving, setSaving]           = useState(false);

  async function load() {
    const { data } = await supabase
      .from("properties")
      .select(`
        *,
        units(id, name, area, status),
        contracts(id, status, tenant_id, rent_per_sqm, charged_area,
          investment_addition, start_date, end_date,
          tenants(name))
      `)
      .order("name");
    setProperties(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = properties.filter(p =>
    !search || p.name?.includes(search) || p.address?.includes(search) || p.city?.includes(search)
  );

  function openEdit(p: any) {
    setIsNew(false);
    setEditingId(p.id);
    setEditName(p.name ?? "");
    setEditAlias(p.alias ?? "");
    setEditAddress(p.address ?? "");
    setEditCity(p.city ?? "");
    setEditType(p.property_type ?? "commercial");
    setEditArea(p.total_rentable_area?.toString() ?? "");
    setEditNotes(p.notes ?? "");
  }

  function openNew() {
    setIsNew(true);
    setEditingId("new");
    setEditName(""); setEditAlias(""); setEditAddress("");
    setEditCity(""); setEditType("commercial"); setEditArea(""); setEditNotes("");
  }

  async function handleSave() {
    if (!editName.trim()) { alert("חובה: שם נכס"); return; }
    setSaving(true);
    try {
      const payload = {
        name:                editName.trim(),
        alias:               editAlias || null,
        address:             editAddress || null,
        city:                editCity || null,
        property_type:       editType,
        total_rentable_area: editArea ? Number(editArea) : null,
        notes:               editNotes || null,
      };
      if (isNew) {
        const { error } = await supabase.from("properties").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("properties").update(payload).eq("id", editingId);
        if (error) throw error;
      }
      setEditingId(null);
      await load();
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`למחוק את הנכס "${name}"?\n⚠️ לא ניתן למחוק נכס עם חוזים פעילים.`)) return;
    const { error } = await supabase.from("properties").delete().eq("id", id);
    if (error) { alert("שגיאה: " + error.message); return; }
    await load();
  }

  // חישוב תפוסה
  function calcOccupancy(p: any) {
    const contracts = p.contracts ?? [];
    const activeContracts = contracts.filter((c: any) =>
      c.status === "active" || c.status === "expiring" || c.status === "extended"
    );
    const rentedArea = activeContracts.reduce((s: number, c: any) =>
      s + (c.charged_area ?? 0), 0);
    const totalArea = p.total_rentable_area || 0;
    const pct = totalArea > 0 ? Math.round((rentedArea / totalArea) * 100) : 0;
    const monthlyRevenue = activeContracts.reduce((s: number, c: any) =>
      s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0), 0);
    return { rentedArea, totalArea, pct, activeContracts, monthlyRevenue };
  }

  const totalRevenue = properties.reduce((s, p) => s + calcOccupancy(p).monthlyRevenue, 0);
  const totalArea    = properties.reduce((s, p) => s + (p.total_rentable_area || 0), 0);

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">נכסים</h1>
          <p className="text-sm text-slate-500 mt-1">{properties.length} נכסים | {totalArea.toLocaleString()} מ"ר | ₪{totalRevenue.toLocaleString()}/חודש</p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + נכס חדש
        </button>
      </div>

      {/* חיפוש */}
      <div className="mb-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 חיפוש לפי שם, כתובת או עיר..."
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-3 py-3 w-6"></th>
                <th className="px-4 py-3 font-semibold">שם נכס</th>
                <th className="px-4 py-3 font-semibold">כתובת</th>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">שטח כולל</th>
                <th className="px-4 py-3 font-semibold">תפוסה</th>
                <th className="px-4 py-3 font-semibold">הכנסה חודשית</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">
                  <div className="text-4xl mb-2">🏢</div>
                  <div>{search ? "לא נמצאו נכסים" : "אין נכסים עדיין"}</div>
                </td></tr>
              ) : filtered.map(p => {
                const occ = calcOccupancy(p);
                const isExpanded = expandedId === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr onClick={() => setExpandedId(prev => prev === p.id ? null : p.id)}
                      className={`border-t border-slate-100 cursor-pointer transition-colors ${isExpanded ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                      <td className="px-3 py-3 text-slate-400 text-center text-xs">
                        {isExpanded ? "▲" : "▼"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{p.name}</div>
                        {p.alias && <div className="text-xs text-slate-400">{p.alias}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.address ? `${p.address}${p.city ? ", "+p.city : ""}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {PROPERTY_TYPES[p.property_type] ?? "אחר"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {p.total_rentable_area ? `${p.total_rentable_area.toLocaleString()} מ"ר` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {occ.totalArea > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-200 rounded-full h-1.5 w-16">
                              <div className={`h-1.5 rounded-full ${occ.pct >= 80 ? "bg-green-500" : occ.pct >= 50 ? "bg-yellow-500" : "bg-red-400"}`}
                                style={{ width: `${occ.pct}%` }} />
                            </div>
                            <span className={`text-xs font-semibold ${occ.pct >= 80 ? "text-green-700" : occ.pct >= 50 ? "text-yellow-700" : "text-red-600"}`}>
                              {occ.pct}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">לא מוגדר</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {occ.monthlyRevenue > 0 ? "₪"+occ.monthlyRevenue.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(p)}
                            className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50 font-medium">עריכה</button>
                          <button onClick={() => handleDelete(p.id, p.name)}
                            className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">מחיקה</button>
                        </div>
                      </td>
                    </tr>

                    {/* פאנל פרטים */}
                    {isExpanded && (
                      <tr key={p.id+"-details"}>
                        <td colSpan={8} className="p-0 border-t border-blue-100">
                          <div className="bg-blue-50 px-6 py-5">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

                              {/* פרטי נכס */}
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">🏢 פרטי נכס</div>
                                <div className="space-y-1.5 text-sm">
                                  <div className="flex justify-between"><span className="text-slate-500">סוג</span><span className="font-medium">{PROPERTY_TYPES[p.property_type] ?? "אחר"}</span></div>
                                  {p.address && <div className="flex justify-between"><span className="text-slate-500">כתובת</span><span className="font-medium text-left">{p.address}{p.city ? ", "+p.city : ""}</span></div>}
                                  {p.total_rentable_area && <div className="flex justify-between"><span className="text-slate-500">שטח להשכרה</span><span className="font-medium">{p.total_rentable_area.toLocaleString()} מ"ר</span></div>}
                                  <div className="flex justify-between"><span className="text-slate-500">מושכר</span><span className="font-medium">{occ.rentedArea.toLocaleString()} מ"ר ({occ.pct}%)</span></div>
                                  <div className="flex justify-between"><span className="text-slate-500">פנוי</span><span className="font-medium text-orange-600">{(occ.totalArea - occ.rentedArea).toLocaleString()} מ"ר</span></div>
                                </div>
                                {p.notes && <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">{p.notes}</div>}
                              </div>

                              {/* חוזים פעילים */}
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">📄 חוזים פעילים ({occ.activeContracts.length})</div>
                                {occ.activeContracts.length === 0 ? (
                                  <div className="text-slate-400 text-xs">אין חוזים פעילים</div>
                                ) : occ.activeContracts.map((c: any) => {
                                  const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                                  return (
                                    <div key={c.id} className="py-2 border-b border-slate-100 last:border-0">
                                      <div className="font-medium text-slate-800 text-sm">{c.tenants?.name}</div>
                                      <div className="text-xs text-slate-500">{formatDate(c.start_date)} — {formatDate(c.end_date)}</div>
                                      {c.charged_area && <div className="text-xs text-slate-500">{c.charged_area} מ"ר</div>}
                                      {monthly > 0 && <div className="text-xs font-semibold text-green-700">₪{monthly.toLocaleString()}/חודש</div>}
                                    </div>
                                  );
                                })}
                              </div>

                              {/* פעולות */}
                              <div className="space-y-3">
                                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                  <div className="text-2xl font-bold text-green-800 mb-1">₪{occ.monthlyRevenue.toLocaleString()}</div>
                                  <div className="text-xs text-slate-500 mb-3">הכנסה חודשית מהנכס</div>
                                  <div className="text-xs text-slate-500">שנתי: ₪{(occ.monthlyRevenue * 12).toLocaleString()}</div>
                                </div>
                                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-2">
                                  <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">⚡ פעולות</div>
                                  <button onClick={() => openEdit(p)}
                                    className="w-full rounded-lg border border-blue-200 py-2 text-sm text-blue-800 hover:bg-blue-50 font-semibold">✏️ עריכת פרטים</button>
                                  <button onClick={() => router.push(`/contracts/new?property=${p.id}`)}
                                    className="w-full rounded-lg border border-green-200 py-2 text-sm text-green-700 hover:bg-green-50 font-semibold">+ חוזה חדש</button>
                                  <button onClick={() => router.push(`/units?property=${p.id}`)}
                                    className="w-full rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50 font-medium">🚪 ניהול יחידות</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* מודל עריכה / יצירה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "נכס חדש" : "עריכת נכס"}</h2>
              <button onClick={() => setEditingId(null)} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם נכס *</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className={ic} placeholder="שם הנכס" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">כינוי קצר</label>
                <input type="text" value={editAlias} onChange={e => setEditAlias(e.target.value)} className={ic} placeholder="לדוגמה: מתחם לוגיסטי צפון" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
                  <input type="text" value={editAddress} onChange={e => setEditAddress(e.target.value)} className={ic} placeholder="רחוב ומספר" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">עיר</label>
                  <input type="text" value={editCity} onChange={e => setEditCity(e.target.value)} className={ic} placeholder="תל אביב" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סוג נכס</label>
                  <select value={editType} onChange={e => setEditType(e.target.value)} className={ic}>
                    {Object.entries(PROPERTY_TYPES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שטח כולל להשכרה (מ"ר)</label>
                  <input type="number" value={editArea} onChange={e => setEditArea(e.target.value)} className={ic} placeholder="5000" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                  rows={2} className={ic + " resize-none"} placeholder="הערות..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingId(null)}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                  {saving ? "שומר..." : isNew ? "צור נכס" : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
