"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
      const { data: property, error: propError } = await supabase
        .from("properties")
        .insert({ name, address, property_type: type, total_rentable_area: Number(area) })
        .select()
        .single();
      if (propError) throw propError;
      for (const u of units) {
        if (u.name) {
          await supabase.from("spaces").insert({
            property_id: property.id,
            name: u.name,
            area: Number(u.area),
            space_type: u.use_type,
          });
        }
      }
      router.push("/properties");
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
      setSaving(false);
    }
  }

  const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-700 text-2xl">←</button>
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
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">סוג נכס</label>
            <select value={type} onChange={e => setType(e.target.value)} className={ic}>
              <option value="">-- בחר --</option>
              {PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">שטח כולל (מ"ר)</label>
            <input type="number" value={area} onChange={e => setArea(e.target.value)} className={ic} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-500">יחידות</h2>
            <button onClick={addUnit} className="text-xs text-blue-600 hover:underline">+ הוסף יחידה</button>
          </div>
          {units.map((u, i) => (
            <div key={i} className="mb-3 rounded-lg border border-slate-100 p-3 space-y-2">
              <div className="flex gap-2">
                <input type="text" value={u.name} onChange={e => updateUnit(i, "name", e.target.value)} placeholder="שם יחידה" className={ic} />
                <input type="number" value={u.area} onChange={e => updateUnit(i, "area", e.target.value)} placeholder='מ"ר' className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="flex gap-2 items-center">
                <select value={u.use_type} onChange={e => updateUnit(i, "use_type", e.target.value)} className={ic}>
                  <option value="">-- סוג --</option>
                  {UNIT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                {units.length > 1 && (
                  <button onClick={() => removeUnit(i)} className="text-red-400 hover:text-red-600 text-xs">🗑</button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={() => router.back()} className="rounded-lg border border-slate-300 px-5 py-2 text-sm text-slate-600">ביטול</button>
          <button onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {saving ? "שומר..." : "צור נכס"}
          </button>
        </div>
      </div>
    </div>
  );
}
