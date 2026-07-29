"use client";

import { type RevenueCategory, categoryKey } from "@/lib/revenue-categories";

// Editor for turnover categories priced at different percentages (delivery
// platforms, events, …). Leaving the list empty keeps the single-percentage
// behaviour, so existing contracts are untouched.
export default function RevenueCategoriesEditor(props: {
  value: RevenueCategory[];
  onChange: (next: RevenueCategory[]) => void;
  basePct?: string | number;    // the contract's headline % — used for a new row
  inputClass?: string;
}) {
  const list = props.value ?? [];
  const ic = "rounded border border-slate-200 px-2 py-1 text-xs";

  function add(name: string, pct: number) {
    props.onChange(list.concat([{ key: categoryKey(name, list), name: name, pct: pct }]));
  }
  function patch(idx: number, p: Partial<RevenueCategory>) {
    props.onChange(list.map(function(c, i) { return i === idx ? { ...c, ...p } : c; }));
  }
  function remove(idx: number) {
    props.onChange(list.filter(function(_, i) { return i !== idx; }));
  }

  return (
    <div className="col-span-2 rounded-lg border border-purple-200 bg-white/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-purple-800">🧾 פיצול אחוזים לפי סוג פדיון (אופציונלי)</label>
        <div className="flex gap-1">
          <button type="button" onClick={function() { add("משלוחים", Number(props.basePct) || 0); }}
            className="rounded bg-purple-600 text-white px-2 py-0.5 text-[11px] font-bold hover:bg-purple-700">+ משלוחים</button>
          <button type="button" onClick={function() { add("", Number(props.basePct) || 0); }}
            className="rounded border border-purple-300 text-purple-700 px-2 py-0.5 text-[11px] font-bold hover:bg-purple-50">+ סוג נוסף</button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="text-[11px] text-purple-500">
          ללא פיצול — האחוז שהוגדר למעלה חל על כל הפדיון. הוסף סוג כדי לתמחר משלוחים או סוג פדיון אחר באחוז שונה.
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {list.map(function(c, idx) {
              return (
                <div key={c.key} className="flex items-center gap-2">
                  <input type="text" value={c.name} placeholder="שם הסוג (משלוחים / אירועים / ...)"
                    onChange={function(e) { patch(idx, { name: e.target.value }); }}
                    className={ic + " flex-1"} />
                  <input type="number" step="0.1" min="0" value={c.pct}
                    onChange={function(e) { patch(idx, { pct: Number(e.target.value) || 0 }); }}
                    className={ic + " w-20 text-center"} />
                  <span className="text-xs text-purple-700">%</span>
                  <button type="button" onClick={function() { remove(idx); }}
                    className="text-red-400 hover:text-red-600 text-xs">✕</button>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-purple-600">
            בכל דיווח יוזן פדיון נפרד לכל סוג. התמורה היא סכום כל סוג לפי האחוז שלו, והיא זו שנבדקת מול המינימום.
            {list.some(function(c) { return !c.name.trim(); }) && (
              <span className="text-red-500"> · יש סוג ללא שם — יש למלא כדי שיוצג בדיווח.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
