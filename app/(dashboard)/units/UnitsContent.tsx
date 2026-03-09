
"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const UNIT_TYPES = ["משרד", "מסחרי", "מחסן", "לוגיסטי", "תעשייתי", "אחר"];

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  vacant:       { label: "פנוי",           color: "text-red-700",    bg: "bg-red-100 border-red-200" },
  occupied:     { label: "תפוס",           color: "text-green-700",  bg: "bg-green-100 border-green-200" },
  reserved:     { label: "שמור (עתידי)",   color: "text-blue-700",   bg: "bg-blue-100 border-blue-200" },
  future_vacant:{ label: "מתפנה בקרוב",   color: "text-orange-700", bg: "bg-orange-100 border-orange-200" },
};

export default function UnitsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [properties, setProperties] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPropertyId, setSelectedPropertyId] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editUnit, setEditUnit] = useState<any>(null);
  const [selectedUnit, setSelectedUnit] = useState<any>(null);
  const [unitContract, setUnitContract] = useState<any>(null);
  const [form, setForm] = useState({ property_id: "", name: "", area: "", use_type: "", floor: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

  async function load() {
    const [{ data: props }, { data: unitData }, { data: contracts }] = await Promise.all([
      supabase.from("properties").select("id, name"),
      supabase.from("units").select("*, properties(name)"),
      supabase.from("contracts").select("id, status, start_date, end_date, unit_ids, tenant_id, tenants(name, contact_phone, contact_email), rent_per_sqm, charged_area"),
    ]);

    const today = new Date(); today.setHours(0,0,0,0);

    // עדכון סטטוס יחידות אוטומטי לפי חוזים
    const enriched = (unitData ?? []).map((unit: any) => {
      const activeLease = (contracts ?? []).find((c: any) =>
        c.status === "active" && Array.isArray(c.unit_ids) && c.unit_ids.includes(unit.id)
      );
      const pendingLease = (contracts ?? []).find((c: any) =>
        c.status === "upcoming" && Array.isArray(c.unit_ids) && c.unit_ids.includes(unit.id)
      );

      let status = "vacant";
      let tenant = null;
      let leaseInfo = null;

      if (activeLease) {
        const endDate = new Date(activeLease.end_date);
        const daysLeft = Math.ceil((endDate.getTime() - today.getTime()) / (1000*60*60*24));
        status = daysLeft <= 60 ? "future_vacant" : "occupied";
        tenant = activeLease.tenants;
        leaseInfo = activeLease;
      } else if (pendingLease) {
        status = "reserved";
        tenant = pendingLease.tenants;
        leaseInfo = pendingLease;
      }

      return { ...unit, computedStatus: status, tenant, leaseInfo };
    });

    setProperties(props ?? []);
    setUnits(enriched);
    setLoading(false);
  }

  useEffect(() => {
    load().then(() => {
      const pid = searchParams.get("propertyId");
      if (pid) { setForm(f => ({ ...f, property_id: pid })); setShowForm(true); }
    });
  }, []);

  const filtered = units.filter(u => {
    const matchProp = selectedPropertyId === "all" || u.property_id === selectedPropertyId;
    const matchStatus = selectedStatus === "all" || u.computedStatus === selectedStatus;
    const matchSearch = !search || u.name?.includes(search) || u.properties?.name?.includes(search);
    return matchProp && matchStatus && matchSearch;
  });

  const stats = {
    total: units.length,
    vacant: units.filter(u => u.computedStatus === "vacant").length,
    occupied: units.filter(u => u.computedStatus === "occupied").length,
    reserved: units.filter(u => u.computedStatus === "reserved").length,
    future_vacant: units.filter(u => u.computedStatus === "future_vacant").length,
    occupancyPct: units.length > 0 ? Math.round(units.filter(u => u.computedStatus === "occupied").length / units.length * 100) : 0,
  };

  function openNew() {
    setEditUnit(null);
    setForm({ property_id: properties[0]?.id ?? "", name: "", area: "", use_type: "", floor: "", notes: "" });
    setShowForm(true);
  }

  function openEdit(u: any) {
    setEditUnit(u);
    setForm({ property_id: u.property_id, name: u.name ?? "", area: u.area?.toString() ?? "", use_type: u.use_type ?? "", floor: u.floor?.toString() ?? "", notes: u.notes ?? "" });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name || !form.property_id) { alert("שם ונכס הם חובה"); return; }
    setSaving(true);
    if (editUnit) {
      await supabase.from("units").update({ ...form, area: Number(form.area), floor: form.floor ? Number(form.floor) : null }).eq("id", editUnit.id);
    } else {
      await supabase.from("units").insert({ ...form, area: Number(form.area), floor: form.floor ? Number(form.floor) : null, status: "vacant" });
    }
    setSaving(false); setShowForm(false); setEditUnit(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק יחידה זו?")) return;
    await supabase.from("units").delete().eq("id", id);
    setSelectedUnit(null); load();
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">יחידות</h1>
          <p className="text-sm text-slate-500 mt-1">נהל את כל היחידות בנכסים שלך</p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">+ יחידה חדשה</button>
      </div>

      {/* סטטיסטיקות */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'סה"כ יחידות', value: stats.total, cls: "text-slate-800" },
          { label: "פנויות", value: stats.vacant, cls: "text-red-600" },
          { label: "תפוסות", value: stats.occupied, cls: "text-green-600" },
          { label: "שמורות", value: stats.reserved, cls: "text-blue-600" },
          { label: "אחוז תפוסה", value: stats.occupancyPct + "%", cls: "text-purple-600" },
        ].map((s, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-center">
            <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* פילטרים */}
      <div className="mb-4 flex flex-wrap gap-3">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  חיפוש..." className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 flex-1 min-w-48" />
        <select value={selectedPropertyId} onChange={e => setSelectedPropertyId(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none">
          <option value="all">כל הנכסים ({units.length})</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none">
          <option value="all">כל הסטטוסים</option>
          {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
              <tr>
                <th className="px-4 py-3 font-semibold">שם יחידה</th>
                <th className="px-4 py-3 font-semibold">נכס</th>
                <th className="px-4 py-3 font-semibold">קומה</th>
                <th className="px-4 py-3 font-semibold">שטח מ"ר</th>
                <th className="px-4 py-3 font-semibold">סוג שימוש</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">שוכר</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">
                  <div className="text-4xl mb-2">🏠</div>
                  <div>{search ? "לא נמצאו יחידות" : "אין יחידות עדיין"}</div>
                </td></tr>
              ) : filtered.map(unit => {
                const sc = statusConfig[unit.computedStatus] ?? statusConfig.vacant;
                return (
                  <tr key={unit.id} className="border-t border-slate-50 hover:bg-slate-50 cursor-pointer" onClick={() => { setSelectedUnit(unit); setUnitContract(unit.leaseInfo); }}>
                    <td className="px-4 py-3 font-semibold text-slate-800">{unit.name}</td>
                    <td className="px-4 py-3 text-slate-600">{unit.properties?.name}</td>
                    <td className="px-4 py-3 text-slate-500">{unit.floor ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700 font-medium">{unit.area}</td>
                    <td className="px-4 py-3 text-slate-600">{unit.use_type || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${sc.bg} ${sc.color}`}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      {unit.tenant
                        ? <span className="font-medium text-blue-600">{unit.tenant.name}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-2">
                        <button onClick={() => openEdit(unit)} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-500 hover:text-blue-600">עריכה</button>
                        <button onClick={() => handleDelete(unit.id)} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:text-red-600">מחיקה</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* פאנל יחידה */}
      {selectedUnit && (
        <div className="fixed inset-y-0 left-0 w-96 bg-white border-r border-slate-200 shadow-xl z-40 overflow-y-auto" dir="rtl">
          <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3">
            <button onClick={() => setSelectedUnit(null)} className="text-slate-400 hover:text-slate-700 text-xl">←</button>
            <div className="flex-1">
              <div className="font-bold text-slate-800">{selectedUnit.name}</div>
              <div className="text-xs text-slate-400">{selectedUnit.properties?.name}</div>
            </div>
            <button onClick={() => setSelectedUnit(null)} className="text-2xl text-slate-400">&times;</button>
          </div>
          <div className="p-6 space-y-4">
            {/* פרטי יחידה */}
            <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">סטטוס</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusConfig[selectedUnit.computedStatus]?.bg} ${statusConfig[selectedUnit.computedStatus]?.color}`}>
                  {statusConfig[selectedUnit.computedStatus]?.label}
                </span>
              </div>
              {selectedUnit.area && <div className="flex justify-between"><span className="text-slate-500">שטח</span><span className="font-medium">{selectedUnit.area} מ"ר</span></div>}
              {selectedUnit.floor != null && <div className="flex justify-between"><span className="text-slate-500">קומה</span><span className="font-medium">{selectedUnit.floor}</span></div>}
              {selectedUnit.use_type && <div className="flex justify-between"><span className="text-slate-500">סוג שימוש</span><span className="font-medium">{selectedUnit.use_type}</span></div>}
              {selectedUnit.notes && <div className="text-xs text-slate-400 pt-1 border-t border-slate-200">{selectedUnit.notes}</div>}
            </div>

            {/* שוכר וחוזה */}
            {selectedUnit.computedStatus === "vacant" ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-5 text-center">
                <div className="text-3xl mb-2">📭</div>
                <div className="font-medium text-slate-600 mb-3">יחידה פנויה</div>
                <button onClick={() => router.push("/contracts/new")} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">+ הוסף חוזה</button>
              </div>
            ) : unitContract && (
              <div className="space-y-3">
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm space-y-1.5">
                  <div className="font-bold text-blue-800 mb-2">👤 {selectedUnit.tenant?.name}</div>
                  {selectedUnit.tenant?.contact_phone && <div className="flex justify-between"><span className="text-blue-600">טלפון</span><a href={"tel:"+selectedUnit.tenant.contact_phone} className="font-medium">{selectedUnit.tenant.contact_phone}</a></div>}
                  {selectedUnit.tenant?.contact_email && <div className="flex justify-between"><span className="text-blue-600">אימייל</span><span className="text-xs">{selectedUnit.tenant.contact_email}</span></div>}
                </div>
                <div className="rounded-xl bg-slate-50 p-4 text-sm space-y-1.5">
                  <div className="font-medium text-slate-600 mb-1">📅 תקופה</div>
                  <div className="flex justify-between"><span className="text-slate-500">התחלה</span><span className="font-medium">{unitContract.start_date}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">סיום</span><span className="font-medium">{unitContract.end_date}</span></div>
                  {(() => {
                    const days = Math.ceil((new Date(unitContract.end_date).getTime() - new Date().getTime()) / (1000*60*60*24));
                    return <div className={`rounded-lg px-3 py-1.5 text-xs text-center font-medium mt-1 ${days < 0 ? "bg-red-100 text-red-700" : days < 60 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                      {days < 0 ? `פג לפני ${Math.abs(days)} ימים` : `${days} ימים לסיום`}
                    </div>;
                  })()}
                </div>
                {unitContract.rent_per_sqm && (
                  <div className="rounded-xl bg-green-50 border border-green-100 p-4 text-sm space-y-1.5">
                    <div className="font-medium text-green-700 mb-1">💰 תשלום</div>
                    <div className="flex justify-between"><span className="text-slate-500">מחיר למ"ר</span><span className="font-bold">₪{unitContract.rent_per_sqm}</span></div>
                    {unitContract.charged_area && <div className="flex justify-between"><span className="text-slate-500">שטח מחויב</span><span>{unitContract.charged_area} מ"ר</span></div>}
                    <div className="border-t border-green-200 pt-1.5 flex justify-between">
                      <span className="font-bold text-green-700">חודשי</span>
                      <span className="font-bold text-green-700">₪{(unitContract.rent_per_sqm * unitContract.charged_area).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={() => openEdit(selectedUnit)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
              <button onClick={() => handleDelete(selectedUnit.id)} className="rounded-lg border border-red-100 py-2 px-3 text-sm text-red-400 hover:bg-red-50">🗑️</button>
            </div>
          </div>
        </div>
      )}

      {/* טופס יחידה */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-slate-800">{editUnit ? "עריכת יחידה" : "יחידה חדשה"}</h2>
              <button onClick={() => setShowForm(false)} className="text-2xl text-slate-400">&times;</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">נכס *</label>
                <select value={form.property_id} onChange={e => setForm(f => ({...f, property_id: e.target.value}))} className={ic}>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">שם יחידה *</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="קומה 3 — A" className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">קומה</label>
                  <input type="number" value={form.floor} onChange={e => setForm(f => ({...f, floor: e.target.value}))} placeholder="3" className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">שטח מ"ר</label>
                  <input type="number" value={form.area} onChange={e => setForm(f => ({...f, area: e.target.value}))} placeholder="0" className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">סוג שימוש</label>
                  <select value={form.use_type} onChange={e => setForm(f => ({...f, use_type: e.target.value}))} className={ic}>
                    <option value="">בחר סוג</option>
                    {UNIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">הערות</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} className={ic} placeholder="הערות נוספות..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-slate-600 hover:bg-slate-50">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? "שומר..." : "שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
