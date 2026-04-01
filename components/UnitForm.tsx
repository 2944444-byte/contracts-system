"use client";
import { useState } from "react";

const UNIT_TYPES = ["משרדים", "מסחר", "חנות", "מחסן", "תעשיה", "חצר פתוחה", "אחר"];
const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

interface Props { unit?: any; properties: any[]; onSubmit: (data: any) => void; onCancel: () => void; }

export default function UnitForm({ unit, properties, onSubmit, onCancel }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    property_id: unit?.property_id ?? "",
    unit_name: unit?.unit_name ?? "",
    floor: unit?.floor ?? "",
    area_m2: unit?.area_m2 ?? "",
    usage_type: unit?.usage_type ?? "משרד",
    asking_rent_per_sqm: unit?.asking_rent_per_sqm ?? "",
    expected_vacancy_date: unit?.expected_vacancy_date ?? "",
    description: unit?.description ?? "",
  });

  function set(f: string, v: any) { setForm(p => ({ ...p, [f]: v })); }

  async function handleSubmit() {
    if (!form.property_id) { alert("יש לבחור נכס"); return; }
    if (!form.unit_name.trim()) { alert("שם יחידה חובה"); return; }
    setSaving(true);
    const payload: any = { ...form };
    ["floor","area_m2","asking_rent_per_sqm"].forEach(k => {
      if (payload[k] !== "") payload[k] = Number(payload[k]);
      else delete payload[k];
    });
    if (!payload.expected_vacancy_date) delete payload.expected_vacancy_date;
    await onSubmit(payload);
    setSaving(false);
  }

  const askingMonthly = form.area_m2 && form.asking_rent_per_sqm
    ? Math.round(Number(form.area_m2) * Number(form.asking_rent_per_sqm)) : null;

  return (
    <div dir="rtl" className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
          <select value={form.property_id} onChange={e => set("property_id", e.target.value)} className={ic}>
            <option value="">בחר נכס</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">שם יחידה *</label>
          <input value={form.unit_name} onChange={e => set("unit_name", e.target.value)} placeholder="קומה 3 מערב" className={ic} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">קומה</label>
          <input type="number" value={form.floor} onChange={e => set("floor", e.target.value)} placeholder="3" className={ic} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ&quot;ר)</label>
          <input type="number" value={form.area_m2} onChange={e => set("area_m2", e.target.value)} placeholder="250" className={ic} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">סוג שימוש</label>
          <select value={form.usage_type} onChange={e => set("usage_type", e.target.value)} className={ic}>
            {UNIT_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">שכ&quot;ד מבוקש למ&quot;ר (₪, לפני מע&quot;מ)</label>
          <input type="number" value={form.asking_rent_per_sqm} onChange={e => set("asking_rent_per_sqm", e.target.value)} placeholder="85" step="0.5" className={ic} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך פינוי צפוי</label>
          <input type="date" value={form.expected_vacancy_date} onChange={e => set("expected_vacancy_date", e.target.value)} className={ic} />
          <p className="text-xs text-slate-400 mt-0.5">רלוונטי ליחידות שמסתיים בהן חוזה</p>
        </div>
      </div>

      {askingMonthly && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">שכ&quot;ד חודשי מבוקש (לפני מע&quot;מ)</span>
            <span className="font-bold text-green-700">₪{askingMonthly.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>כולל מע&quot;מ 18%</span>
            <span>₪{Math.round(askingMonthly * 1.18).toLocaleString()}</span>
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
        <textarea value={form.description} onChange={e => set("description", e.target.value)}
          rows={2} placeholder="הערות על היחידה..." className={ic + " resize-none"} />
      </div>

      <div className="flex gap-3 justify-end border-t pt-4">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {saving ? "שומר..." : unit ? "💾 עדכן יחידה" : "➕ צור יחידה"}
        </button>
      </div>
    </div>
  );
}
