"use client";
import { RevenuePctTier, emptyPctTier, describePctTiers, validatePctTiers } from "@/lib/revenue-pct-steps";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

// Steps for the TURNOVER PERCENTAGE. Deliberately separate from the rent-step
// builder next to it: on a revenue lease that one raises the MINIMUM, this one
// raises the percentage, and conflating them is what made the screen unclear.
export default function RevenuePctTiersEditor(props: {
  basePct: number;
  tiers: RevenuePctTier[];
  onChange: (t: RevenuePctTier[]) => void;
  contractYears?: number;
  title?: string;
}) {
  const tiers = props.tiers || [];
  const errors = validatePctTiers(tiers, props.contractYears || 0);

  function patch(i: number, p: Partial<RevenuePctTier>) {
    props.onChange(tiers.map(function (t, idx) { return idx === i ? { ...t, ...p } : t; }));
  }

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold text-purple-800">
          📈 {props.title || "מדרגות אחוז מהפדיון"}
        </div>
        <button type="button"
          onClick={function () {
            const last = tiers[tiers.length - 1];
            props.onChange(tiers.concat([emptyPctTier(last ? (Number(last.to_year) || Number(last.from_year)) + 1 : 2)]));
          }}
          className="rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-800">
          + הוסף מדרגה
        </button>
      </div>

      <div className="text-xs text-purple-700 mb-3 leading-relaxed">
        האחוז מהפדיון עצמו עולה לאורך השנים (למשל 3.5% בשנים 1–3, 4% משנה 4).
        זה <b>נפרד</b> מעליית שכ&quot;ד המינימום — שם נקבע הרצפה, כאן נקבע האחוז.
        ללא מדרגות — האחוז אחיד לכל התקופה ({props.basePct || 0}%).
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-2 mb-2 space-y-0.5">
          {errors.map(function (e, i) { return <div key={i} className="text-xs text-red-600">⚠️ {e}</div>; })}
        </div>
      )}

      {tiers.length === 0 ? (
        <div className="text-xs text-slate-400 text-center py-2">
          אין מדרגות — האחוז נשאר {props.basePct || 0}% לכל התקופה
        </div>
      ) : (
        <div className="space-y-2">
          {tiers.map(function (t, i) {
            return (
              <div key={i} className="rounded-lg border border-purple-100 bg-white p-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">משנה</label>
                    <input type="number" min="1" value={t.from_year || ""}
                      onChange={function (e) { patch(i, { from_year: Number(e.target.value) || 1 }); }} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">עד שנה (ריק = עד הסוף)</label>
                    <input type="number" min="0" value={t.to_year || ""}
                      onChange={function (e) { patch(i, { to_year: Number(e.target.value) || 0 }); }} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">אחוז מהפדיון (%)</label>
                    <input type="number" step="0.01" value={t.pct || ""}
                      onChange={function (e) { patch(i, { pct: Number(e.target.value) || 0 }); }} className={ic} />
                  </div>
                  <button type="button" onClick={function () { props.onChange(tiers.filter(function (_, x) { return x !== i; })); }}
                    className="rounded-lg border border-red-100 px-3 py-2 text-xs text-red-500 hover:bg-red-50">🗑 הסר</button>
                </div>
                <input type="text" value={t.notes || ""} placeholder="הערות (אופציונלי)"
                  onChange={function (e) { patch(i, { notes: e.target.value }); }} className={ic + " text-xs mt-2"} />
              </div>
            );
          })}
        </div>
      )}

      {tiers.length > 0 && (
        <div className="mt-3 rounded-lg bg-purple-100 border border-purple-200 px-3 py-2 text-xs font-semibold text-purple-800">
          {describePctTiers(props.basePct, tiers)}
        </div>
      )}
    </div>
  );
}
