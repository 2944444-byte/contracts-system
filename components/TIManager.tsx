"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

interface TIRecord {
  id?:           string;
  ti_type:       string;
  description:   string;
  ti_amount:     string;
  recovery_method: string;
  recovery_amount_monthly: string;
  recovery_start: string;
  recovery_end:   string;
  notes:         string;
}

const RECOVERY_LABELS: Record<string,string> = {
  monthly_addition: "תוספת לשכ\"ד חודשי",
  separate:         "פריסה נפרדת",
  increased_rent:   "שכירות מוגדלת לתקופה",
};

interface Props { contractId: string; contractEndDate: string; }

export function TIManager({ contractId, contractEndDate }: Props) {
  const [records,  setRecords]  = useState<any[]>([]);
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [form, setForm] = useState<TIRecord>({
    ti_type: "one_time", description: "", ti_amount: "",
    recovery_method: "monthly_addition", recovery_amount_monthly: "",
    recovery_start: "", recovery_end: contractEndDate ?? "", notes: "",
  });

  useEffect(function() { load(); }, [contractId]);

  async function load() {
    const { data } = await supabase.from("contract_ti")
      .select("*").eq("contract_id", contractId).order("created_at");
    setRecords(data ?? []);
  }

  function openNew() {
    setForm({
      ti_type: "one_time", description: "", ti_amount: "",
      recovery_method: "monthly_addition", recovery_amount_monthly: "",
      recovery_start: "", recovery_end: contractEndDate ?? "", notes: "",
    });
    setEditing(true);
  }

  async function handleSave() {
    if (!form.ti_amount) { alert("חובה: סכום השקעה"); return; }
    setSaving(true);
    try {
      const payload = {
        contract_id:    contractId,
        ti_type:        form.ti_type,
        description:    form.description || null,
        ti_amount:      Number(form.ti_amount),
        recovery_method: form.recovery_method,
        recovery_amount_monthly: form.recovery_amount_monthly ? Number(form.recovery_amount_monthly) : null,
        recovery_start: form.recovery_start || null,
        recovery_end:   form.recovery_end || null,
        notes:          form.notes || null,
      };
      await supabase.from("contract_ti").insert(payload);
      setEditing(false);
      await load();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק?")) return;
    await supabase.from("contract_ti").delete().eq("id", id);
    await load();
  }

  const totalTI = records.reduce(function(s, r) { return s + (r.ti_amount ?? 0); }, 0);
  const monthlyRecovery = records.reduce(function(s, r) {
    return s + (r.recovery_amount_monthly ?? 0);
  }, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-slate-500 uppercase">השקעות משכיר (TI)</div>
          {records.length > 0 && (
            <div className="text-xs text-slate-400 mt-0.5">
              סה&quot;כ השקעה: ₪{totalTI.toLocaleString()} | החזר חודשי: ₪{monthlyRecovery.toLocaleString()}
            </div>
          )}
        </div>
        <button onClick={openNew}
          className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 font-semibold">
          + הוסף TI
        </button>
      </div>

      {records.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded-xl">
          אין השקעות משכיר מוגדרות
        </div>
      ) : (
        <div className="space-y-2">
          {records.map(function(r) {
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-slate-800 text-sm">
                        {r.description || (r.ti_type === "one_time" ? "השקעה חד-פעמית" : "השקעה למ\"ר")}
                      </span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                        ₪{(r.ti_amount ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 space-y-0.5">
                      <div>{RECOVERY_LABELS[r.recovery_method] ?? r.recovery_method}</div>
                      {r.recovery_amount_monthly && (
                        <div>החזר חודשי: <strong>₪{r.recovery_amount_monthly.toLocaleString()}</strong></div>
                      )}
                      {r.recovery_start && r.recovery_end && (
                        <div>{r.recovery_start} — {r.recovery_end}</div>
                      )}
                    </div>
                  </div>
                  <button onClick={function() { handleDelete(r.id); }}
                    className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded px-2 py-1">
                    מחק
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditing(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">השקעת משכיר חדשה</h2>
              <button onClick={function() { setEditing(false); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג השקעה</label>
                <div className="flex gap-2">
                  {[
                    { v: "one_time", l: "חד-פעמית" },
                    { v: "per_sqm",  l: "למ\"ר" },
                  ].map(function(t) {
                    return (
                      <button key={t.v} type="button"
                        onClick={function() { setForm(function(p) { return {...p, ti_type: t.v}; }); }}
                        className={"flex-1 rounded-lg border py-2 text-sm font-semibold " +
                          (form.ti_type === t.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
                        {t.l}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תיאור</label>
                <input type="text" value={form.description}
                  onChange={function(e) { setForm(function(p) { return {...p, description: e.target.value}; }); }}
                  className={ic} placeholder="שיפוץ, התאמות, ריצוף..." />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  סכום השקעה (₪) *
                </label>
                <input type="number" value={form.ti_amount}
                  onChange={function(e) { setForm(function(p) { return {...p, ti_amount: e.target.value}; }); }}
                  className={ic} placeholder="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שיטת החזר</label>
                <select value={form.recovery_method}
                  onChange={function(e) { setForm(function(p) { return {...p, recovery_method: e.target.value}; }); }}
                  className={ic}>
                  {Object.entries(RECOVERY_LABELS).map(function([k,v]) {
                    return <option key={k} value={k}>{v}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">החזר חודשי (₪)</label>
                <input type="number" value={form.recovery_amount_monthly}
                  onChange={function(e) { setForm(function(p) { return {...p, recovery_amount_monthly: e.target.value}; }); }}
                  className={ic} placeholder="0" />
                {form.ti_amount && form.recovery_amount_monthly && Number(form.recovery_amount_monthly) > 0 && (
                  <div className="text-xs text-slate-400 mt-1">
                    תקופת החזר: {Math.ceil(Number(form.ti_amount) / Number(form.recovery_amount_monthly))} חודשים
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תחילת החזר</label>
                  <input type="date" value={form.recovery_start}
                    onChange={function(e) { setForm(function(p) { return {...p, recovery_start: e.target.value}; }); }}
                    className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סיום החזר</label>
                  <input type="date" value={form.recovery_end}
                    onChange={function(e) { setForm(function(p) { return {...p, recovery_end: e.target.value}; }); }}
                    className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={form.notes}
                  onChange={function(e) { setForm(function(p) { return {...p, notes: e.target.value}; }); }}
                  className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditing(false); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">
                  ביטול
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
