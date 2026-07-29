"use client";

import { type MgmtProtection, emptyMgmtProtection, protectionEndDate } from "@/lib/mgmt-protection";

// Editor for a management-fee protection clause. Shared by the new-contract and
// edit-contract screens.
export default function MgmtProtectionFields(props: {
  value: MgmtProtection | null | undefined;
  onChange: (next: MgmtProtection) => void;
  contractStart?: string;
  area?: number;
  inputClass?: string;
}) {
  const p = props.value ?? emptyMgmtProtection();
  const ic = "rounded border border-slate-200 px-2 py-1 text-xs";
  function set(patch: Partial<MgmtProtection>) { props.onChange({ ...p, ...patch }); }

  const end = props.contractStart ? protectionEndDate({ start_date: props.contractStart }, p) : null;
  const yearly = Number(p.value) > 0 && (props.area || 0) > 0
    ? Number(p.value) * (props.area || 0) * 12 : 0;

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/30 p-3 space-y-2 col-span-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-teal-800">🛡️ הגנה על דמי ניהול</label>
        <select value={p.type} className={ic}
          onChange={function(e) { set({ type: e.target.value as MgmtProtection["type"] }); }}>
          <option value="none">ללא הגנה</option>
          <option value="cap">תקרה — &quot;לא יעלו על&quot;</option>
          <option value="fixed">סכום קבוע</option>
        </select>
      </div>

      {p.type !== "none" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-teal-700">₪ למ&quot;ר לחודש</span>
            <input type="number" step="0.01" min="0" value={p.value ?? ""}
              onChange={function(e) { set({ value: e.target.value === "" ? null : Number(e.target.value) }); }}
              className={ic + " w-24 text-center"} placeholder="15" />
            <span className="text-teal-700">למשך</span>
            <input type="number" min="0" value={p.months ?? ""}
              onChange={function(e) { set({ months: e.target.value === "" ? null : Number(e.target.value) }); }}
              className={ic + " w-20 text-center"} placeholder="84" />
            <span className="text-teal-700">חודשי שכירות</span>
            {/* Indexation is a money decision, not a detail — an explicit
                choice rather than a checkbox that is easy to skip past. */}
            <select value={p.indexed === false ? "nominal" : "indexed"} className={ic}
              onChange={function(e) { set({ indexed: e.target.value === "indexed" }); }}>
              <option value="indexed">התקרה צמודה למדד הבסיס</option>
              <option value="nominal">התקרה לא צמודה (סכום נומינלי)</option>
            </select>
          </div>

          <input type="text" value={p.notes ?? ""} placeholder="לשון הסעיף / הערות (לא חובה)"
            onChange={function(e) { set({ notes: e.target.value }); }}
            className={(props.inputClass ?? ic) + " w-full"} />

          <div className="text-[11px] text-teal-700">
            {p.type === "cap"
              ? "השוכר לא יחויב מעבר לתקרה. עלות עודפת בפועל נספגת על ידי המשכיר, ותשלום עודף מוחזר לשוכר בהתחשבנות."
              : "השוכר משלם בדיוק את הסכום הקבוע, ללא תלות בעלות בפועל."}
            {end && <> · תום ההגנה: <b>{end.toLocaleDateString("he-IL")}</b></>}
            {yearly > 0 && <> · {p.indexed === false ? "תקרה שנתית" : "תקרה שנתית לפי התעריף הנקוב"}: <b>{Math.round(yearly).toLocaleString("he-IL")} ₪</b></>}
          </div>
          <div className="text-[11px] text-teal-600">
            {p.indexed === false
              ? "התעריף נשאר נומינלי לכל אורך התקופה — הוא לא יעלה עם המדד."
              : "התעריף עולה עם המדד, ולכן שוכר ששילם מקדמות לפי התעריף הנקוב עשוי להשלים את ההפרש עד התקרה המוצמדת."}
          </div>
        </>
      )}
    </div>
  );
}
