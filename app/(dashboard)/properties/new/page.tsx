
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProperty, createUnit } from "../../../../lib/db";

const PROPERTY_TYPES = ["משרדים", "מסחרי", "תעשייתי", "לוגיסטי", "מעורב", "אחר"];
const UNIT_TYPES = ["משרד", "מסחרי", "מחסן", "לוגיסטי", "תעשייתי", "אחר"];

export default function NewPropertyPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState("");
  const [area, setArea] = useState("");
  const [units, setUnits] = useState([{ name: "", area: "", use_type: "" }]);
  const [saving, setSaving] = useState(false);

  function addUnit() {
    setUnits(prev => [...prev, { name: "", area: "", use_type: "" }]);
  }

  function updateUnit(i: number, field: string, value: string) {
    setUnits(prev => prev.map((u, idx) => idx === i ? { ...u, [field]: value } : u));
  }

  function removeUnit(i: number) {
    setUnits(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!name) { alert("שם נכס הוא חובה"); return; }
    setSaving(true);
    try {
      const property = await createProperty({ name, address, type, total_rentable_area: Number(area) });
      for (const u of units) {
        if (u.name) await createUnit({ property_id: property.id, name: u.name, area: Number(u.area), use_type: u.use_type });
      }
      router.push("/properties");
    } catch(e) {
      alert("שגיאה: " + e);
      setSaving(false);
    }
  }

  const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-700 text-2xl">&larr;</button>
        <h1 className="text-2xl font-bold text-slate-800">נכס חדש</h1>
      </div>
      <div className="space-y-5">

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">פרטי נכס</h2>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">שם נכס *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="לדוגמה: מגדל העסקים" className={ic} />
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">כתובת</label>
            <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="רחוב, עיר" className={ic} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">סוג נכס</label>
              <select value={type} onChange={e => setType(e.target.value)} className={ic}>
                <option value="">בחר סוג</option>
                {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">שטח כולל להשכרה (מ"ר)</label>
              <input type="number" value={area} onChange={e => setArea(e.target.value)} placeholder="0" className={ic} />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-500">יחידות</h2>
            <button onClick={addUnit} className="text-xs text-blue-600 hover:underline font-medium">+ הוסף יחידה</button>
          </div>
          <div className="space-y-3">
            {units.map((u, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">שם יחידה</label>
                  <input type="text" value={u.name} onChange={e => updateUnit(i, "name", e.target.value)} placeholder="קומה 1" className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">שטח מ"ר</label>
                  <input type="number" value={u.area} onChange={e => updateUnit(i, "area", e.target.value)} placeholder="0" className={ic} />
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-slate-600">סוג שימוש</label>
                    <select value={u.use_type} onChange={e => updateUnit(i, "use_type", e.target.value)} className={ic}>
                      <option value="">בחר סוג</option>
                      {UNIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {units.length > 1 && (
                    <button onClick={() => removeUnit(i)} className="text-red-400 hover:text-red-600 text-xl pb-1">&times;</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={() => router.back()} className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">ביטול</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {saving ? "שומר..." : "שמור נכס"}
          </button>
        </div>
      </div>
    </div>
  );
}
