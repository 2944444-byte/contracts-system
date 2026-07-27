"use client";

import { type PenaltyTerms, emptyPenaltyTerms } from "@/lib/option-penalty";

// Editor for the "compensation if the option is not exercised" clause.
// Shared by the new-contract and edit-contract screens so both stay in sync.
export default function OptionPenaltyFields(props: {
  value: PenaltyTerms | undefined | null;
  onChange: (next: PenaltyTerms) => void;
  // Context for the live preview — all optional, the editor works without them.
  area?: number;
  baseTermMonths?: number;
  optionMonths?: number;
}) {
  const t = props.value ?? emptyPenaltyTerms();
  function set(patch: Partial<PenaltyTerms>) { props.onChange({ ...t, ...patch }); }

  const inp = "rounded border border-slate-200 px-2 py-1 text-xs";
  const months = t.basis === "custom_months" ? (Number(t.months) || 0)
    : t.basis === "option_term" ? (props.optionMonths || 0)
    : (props.baseTermMonths || 0);
  const area = props.area || 0;
  const preview = t.type === "per_sqm_month" && Number(t.value) > 0 && area > 0 && months > 0
    ? Number(t.value) * area * months
    : t.type === "fixed" ? Number(t.value) || 0 : 0;

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-rose-800">⚖️ פיצוי על אי מימוש האופציה</label>
        <select value={t.type} onChange={(e) => set({ type: e.target.value as PenaltyTerms["type"] })} className={inp}>
          <option value="none">ללא פיצוי</option>
          <option value="per_sqm_month">₪ למ&quot;ר לחודש</option>
          <option value="fixed">סכום קבוע</option>
        </select>
      </div>

      {t.type !== "none" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-rose-700">{t.type === "per_sqm_month" ? "₪ למ\"ר לחודש" : "סכום (₪)"}</span>
            <input type="number" step="0.01" min="0" value={t.value ?? ""}
              onChange={(e) => set({ value: e.target.value === "" ? null : Number(e.target.value) })}
              className={inp + " w-28 text-center"} />

            {t.type === "per_sqm_month" && (
              <>
                <span className="text-rose-700">לתקופת</span>
                <select value={t.basis} onChange={(e) => set({ basis: e.target.value as PenaltyTerms["basis"] })} className={inp}>
                  <option value="first_term">תקופת השכירות הראשונה</option>
                  <option value="option_term">תקופת האופציה</option>
                  <option value="custom_months">מספר חודשים ידני</option>
                </select>
                {t.basis === "custom_months" && (
                  <input type="number" min="0" value={t.months ?? ""}
                    onChange={(e) => set({ months: e.target.value === "" ? null : Number(e.target.value) })}
                    className={inp + " w-20 text-center"} placeholder="חודשים" />
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1 text-rose-700">
              <input type="checkbox" checked={t.indexed !== false} onChange={(e) => set({ indexed: e.target.checked })} />
              הפרשי הצמדה למדד
            </label>
            <label className="flex items-center gap-1 text-rose-700">
              <input type="checkbox" checked={t.vat !== false} onChange={(e) => set({ vat: e.target.checked })} />
              בתוספת מע&quot;מ
            </label>
            <span className="text-rose-700">תשלום תוך</span>
            <input type="number" min="0" value={t.days ?? 30}
              onChange={(e) => set({ days: Number(e.target.value) || 0 })} className={inp + " w-16 text-center"} />
            <span className="text-rose-700">יום ממתן ההודעה</span>
          </div>

          <input type="text" value={t.notes ?? ""} onChange={(e) => set({ notes: e.target.value })}
            placeholder="לשון הסעיף / הערות (לא חובה)" className={inp + " w-full"} />

          {preview > 0 && (
            <div className="text-[11px] text-rose-700 font-semibold">
              אומדן לפני הצמדה ומע&quot;מ: {Math.round(preview).toLocaleString("he-IL")} ₪
              {t.type === "per_sqm_month" && area > 0 && months > 0 && (
                <span className="font-normal"> ({t.value} × {area.toLocaleString("he-IL")} מ&quot;ר × {months} חודשים)</span>
              )}
            </div>
          )}
          {t.type === "per_sqm_month" && preview === 0 && (
            <div className="text-[11px] text-rose-500">
              האומדן יחושב לפי שטח החוזה ותקופת השכירות בעת סימון אי-המימוש.
            </div>
          )}
        </>
      )}
    </div>
  );
}
