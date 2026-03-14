"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

interface Tier {
  id?:           string;
  tier_number:   number;
  start_date:    string;
  end_date:      string;
  price_per_sqm: string;
  fixed_amount:  string;
  notes:         string;
}

interface Props {
  contractId:    string;
  chargedArea:   number;
  startDate:     string;
  endDate:       string;
}

export function PriceTiersManager({ contractId, chargedArea, startDate, endDate }: Props) {
  const [tiers,   setTiers]   = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [form,    setForm]    = useState<Tier>({
    tier_number: 1, start_date: startDate, end_date: "",
    price_per_sqm: "", fixed_amount: "", notes: "",
  });

  useEffect(function() { load(); }, [contractId]);

  async function load() {
    const { data } = await supabase.from("contract_price_tiers")
      .select("*").eq("contract_id", contractId).order("tier_number");
    setTiers(data ?? []);
  }

  function openNew() {
    const nextNum = tiers.length + 1;
    const prevEnd = tiers.length > 0 ? tiers[tiers.length-1].end_date : null;
    const nextStart = prevEnd
      ? new Date(new Date(prevEnd).getTime() + 86400000).toISOString().split("T")[0]
      : startDate;
    setForm({
      tier_number: nextNum, start_date: nextStart, end_date: endDate,
      price_per_sqm: "", fixed_amount: "", notes: "",
    });
    setEditing(true);
  }

  async function handleSave() {
    if (!form.start_date || (!form.price_per_sqm && !form.fixed_amount)) {
      alert("חובה: תאריך התחלה + מחיר"); return;
    }
    setSaving(true);
    try {
      await supabase.from("contract_price_tiers").insert({
        contract_id:   contractId,
        tier_number:   form.tier_number,
        start_date:    form.start_date,
        end_date:      form.end_date || null,
        price_per_sqm: form.price_per_sqm ? Number(form.price_per_sqm) : null,
        fixed_amount:  form.fixed_amount  ? Number(form.fixed_amount)  : null,
        notes:         form.notes || null,
      });
      setEditing(false);
      await load();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק מדרגה זו?")) return;
    await supabase.from("contract_price_tiers").delete().eq("id", id);
    await load();
  }

  function fmtDate(d: string) {
    if (!d) return "—";
    const [y,m,day] = d.split("-");
    return `${day}/${m}/${y}`;
  }

  const totalMonthly = tiers.reduce(function(s, t) {
    if (t.price_per_sqm && chargedArea) return s + t.price_per_sqm * chargedArea;
    if (t.fixed_amount) return s + t.fixed_amount;
    return s;
  }, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-slate-500 uppercase">מדרגות שכ"ד (Step Rent)</div>
          <div className="text-xs text-slate-400 mt-0.5">{tiers.length} מדרגות מוגדרות</div>
        </div>
        <button onClick={openNew}
          className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 font-semibold">
          + הוסף מדרגה
        </button>
      </div>

      {tiers.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded-xl">
          אין מדרגות מחיר — שכ"ד קבוע לאורך כל החוזה
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b">
              <tr>
                <th className="px-3 py-2 font-semibold text-xs">#</th>
                <th className="px-3 py-2 font-semibold text-xs">התחלה</th>
                <th className="px-3 py-2 font-semibold text-xs">סיום</th>
                <th className="px-3 py-2 font-semibold text-xs">מחיר למ"ר</th>
                <th className="px-3 py-2 font-semibold text-xs">סה"כ/חודש</th>
                <th className="px-3 py-2 font-semibold text-xs">הערות</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tiers.map(function(t, i) {
                const monthly = t.price_per_sqm && chargedArea
                  ? Math.round(t.price_per_sqm * chargedArea)
                  : t.fixed_amount ?? 0;
                const isActive = new Date(t.start_date) <= new Date() &&
                  (!t.end_date || new Date(t.end_date) >= new Date());
                return (
                  <tr key={t.id} className={"border-t " + (isActive ? "bg-blue-50" : "bg-white hover:bg-slate-50")}>
                    <td className="px-3 py-2.5">
                      <span className={"text-xs font-bold px-1.5 py-0.5 rounded " +
                        (isActive ? "bg-blue-200 text-blue-800" : "bg-slate-100 text-slate-600")}>
                        {t.tier_number}
                        {isActive && " ●"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{fmtDate(t.start_date)}</td>
                    <td className="px-3 py-2.5 text-slate-500">{fmtDate(t.end_date)}</td>
                    <td className="px-3 py-2.5 font-semibold text-slate-800">
                      {t.price_per_sqm ? "₪" + t.price_per_sqm + "/מ\"ר" : t.fixed_amount ? "קבוע" : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-green-700">
                      ₪{monthly.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs">{t.notes}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={function() { handleDelete(t.id); }}
                        className="text-xs text-red-400 hover:text-red-600">מחק</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditing(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">מדרגה {form.tier_number}</h2>
              <button onClick={function() { setEditing(false); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך התחלה *</label>
                  <input type="date" value={form.start_date}
                    onChange={function(e) { setForm(function(p) { return {...p, start_date: e.target.value}; }); }}
                    className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך סיום</label>
                  <input type="date" value={form.end_date}
                    onChange={function(e) { setForm(function(p) { return {...p, end_date: e.target.value}; }); }}
                    className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מחיר למ"ר (₪)</label>
                  <input type="number" value={form.price_per_sqm}
                    onChange={function(e) { setForm(function(p) { return {...p, price_per_sqm: e.target.value, fixed_amount: ""}; }); }}
                    className={ic} placeholder="43" />
                  {form.price_per_sqm && chargedArea > 0 && (
                    <div className="text-xs text-green-700 mt-1 font-medium">
                      ₪{Math.round(Number(form.price_per_sqm) * chargedArea).toLocaleString()}/חודש
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">או: סכום קבוע (₪)</label>
                  <input type="number" value={form.fixed_amount}
                    onChange={function(e) { setForm(function(p) { return {...p, fixed_amount: e.target.value, price_per_sqm: ""}; }); }}
                    className={ic} placeholder="0" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={form.notes}
                  onChange={function(e) { setForm(function(p) { return {...p, notes: e.target.value}; }); }}
                  className={ic} placeholder="שנים 1-2, לאחר גרייס..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditing(false); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">
                  ביטול
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "הוסף מדרגה"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
