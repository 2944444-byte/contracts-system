"use client";
import { useState } from "react";

const PROPERTY_TYPES = ["משרדים", "מסחרי", "תעשייתי", "לוגיסטי", "מעורב", "אחר"];
const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

interface Props { property?: any; onSubmit: (data: any) => void; onCancel: () => void; }

export default function PropertyForm({ property, onSubmit, onCancel }: Props) {
  const [tab, setTab] = useState<"basic"|"insurance"|"budget">("basic");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: property?.name ?? "",
    address: property?.address ?? "",
    property_type: property?.property_type ?? "משרדים",
    total_rentable_area: property?.total_rentable_area ?? "",
    yard_terrace_area: property?.yard_terrace_area ?? "",
    parking_spaces: property?.parking_spaces ?? "",
    floors: property?.floors ?? "",
    annual_insurance_cost: property?.annual_insurance_cost ?? "",
    insurance_renewal_date: property?.insurance_renewal_date ?? "",
    insurance_policy_number: property?.insurance_policy_number ?? "",
    annual_management_budget: property?.annual_management_budget ?? "",
    annual_waste_cost: property?.annual_waste_cost ?? "",
    description: property?.description ?? "",
  });

  function set(f: string, v: any) { setForm(p => ({ ...p, [f]: v })); }

  async function handleSubmit() {
    if (!form.name.trim()) { alert("שם הנכס חובה"); return; }
    setSaving(true);
    const payload: any = { ...form };
    ["total_rentable_area","yard_terrace_area","parking_spaces","floors",
     "annual_insurance_cost","annual_management_budget","annual_waste_cost"].forEach(k => {
      if (payload[k] !== "") payload[k] = Number(payload[k]);
      else delete payload[k];
    });
    await onSubmit(payload);
    setSaving(false);
  }

  const totalBudget = Number(form.annual_management_budget||0) + Number(form.annual_waste_cost||0) + Number(form.annual_insurance_cost||0);

  return (
    <div dir="rtl" className="space-y-5">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {([["basic","פרטי נכס 🏢"],["insurance","ביטוח 🛡️"],["budget","תקציב 💰"]] as const).map(([t,l]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-2 text-sm font-bold transition-colors ${tab === t ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "basic" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">שם הנכס *</label>
            <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="בניין ABC" className={ic} />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
            <input value={form.address} onChange={e => set("address", e.target.value)} placeholder="רחוב ראשי 1, תל אביב" className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">סוג נכס</label>
            <select value={form.property_type} onChange={e => set("property_type", e.target.value)} className={ic}>
              {PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">קומות</label>
            <input type="number" value={form.floors} onChange={e => set("floors", e.target.value)} placeholder="5" min="1" className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שטח להשכרה (מ&quot;ר)</label>
            <input type="number" value={form.total_rentable_area} onChange={e => set("total_rentable_area", e.target.value)} placeholder="2500" className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שטח חצר/מרפסות (מ&quot;ר)</label>
            <input type="number" value={form.yard_terrace_area} onChange={e => set("yard_terrace_area", e.target.value)} placeholder="0" className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">מקומות חניה</label>
            <input type="number" value={form.parking_spaces} onChange={e => set("parking_spaces", e.target.value)} placeholder="20" min="0" className={ic} />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)}
              rows={2} placeholder="הערות על הנכס..." className={ic + " resize-none"} />
          </div>
        </div>
      )}

      {tab === "insurance" && (
        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-700">
            פרטי ביטוח המבנה — ישמשו לחישוב חיוב שוכרים וליצירת התראות חידוש אוטומטיות
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">עלות ביטוח שנתית (₪, לפני מע&quot;מ)</label>
              <input type="number" value={form.annual_insurance_cost} onChange={e => set("annual_insurance_cost", e.target.value)} placeholder="0" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך חידוש פוליסה</label>
              <input type="date" value={form.insurance_renewal_date} onChange={e => set("insurance_renewal_date", e.target.value)} className={ic} />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">מספר פוליסה</label>
              <input value={form.insurance_policy_number} onChange={e => set("insurance_policy_number", e.target.value)} placeholder="123456" className={ic} />
            </div>
          </div>
          {form.annual_insurance_cost && (
            <div className="rounded-lg bg-slate-50 border px-4 py-3 text-sm flex justify-between">
              <span className="text-slate-500">עלות חודשית</span>
              <span className="font-bold">₪{Math.round(Number(form.annual_insurance_cost)/12).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {tab === "budget" && (
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-700">
            ערכי ברירת מחדל לתקציב — ניתן לעקוף בניהול תקציבים שנתיים לכל נכס
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תקציב ניהול שנתי (₪)</label>
              <input type="number" value={form.annual_management_budget} onChange={e => set("annual_management_budget", e.target.value)} placeholder="0" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">עלות פינוי אשפה שנתית (₪)</label>
              <input type="number" value={form.annual_waste_cost} onChange={e => set("annual_waste_cost", e.target.value)} placeholder="0" className={ic} />
            </div>
          </div>
          {totalBudget > 0 && (
            <div className="rounded-lg bg-slate-50 border px-4 py-3 space-y-2 text-sm">
              <div className="font-semibold text-slate-700 mb-1">סיכום עלויות שנתיות</div>
              {[["ניהול", form.annual_management_budget], ["אשפה", form.annual_waste_cost], ["ביטוח", form.annual_insurance_cost]].map(([l,v]) =>
                v ? <div key={l as string} className="flex justify-between"><span className="text-slate-500">{l}</span><span>₪{Number(v).toLocaleString()}</span></div> : null
              )}
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>סה&quot;כ</span><span>₪{totalBudget.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 justify-end border-t pt-4">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {saving ? "שומר..." : property ? "💾 עדכן נכס" : "➕ צור נכס"}
        </button>
      </div>
    </div>
  );
}
