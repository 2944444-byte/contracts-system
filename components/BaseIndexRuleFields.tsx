"use client";

import {
  type BaseIndexRule, type BaseIndexAnchor, ANCHOR_LABELS,
  resolveBaseIndexMonth,
} from "@/lib/base-index-rule";

// Editor for how a contract's base index is determined. Most leases fix it at
// signing; some tie it to a milestone that only happens later ("the index known
// 18 months before the premises open"), which can't be filled in until the
// handover date exists.
export default function BaseIndexRuleFields(props: {
  value: BaseIndexRule;
  onChange: (next: BaseIndexRule) => void;
  contract: any;            // anything carrying the anchor dates (form state is fine)
  inputClass?: string;
  onResolve?: (baseDate: string, label: string) => void;  // "fill the base index from the rule"
}) {
  const r = props.value;
  const ic = props.inputClass ?? "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";
  const resolved = r.mode === "derived" ? resolveBaseIndexMonth({ rule: r, contract: props.contract }) : null;

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-3 space-y-2 col-span-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-indigo-800">📌 קביעת מדד הבסיס</label>
        <select value={r.mode} className={"rounded border border-slate-200 px-2 py-1 text-xs"}
          onChange={function(e) { props.onChange({ ...r, mode: e.target.value as BaseIndexRule["mode"] }); }}>
          <option value="fixed">קבוע — נקבע במועד החתימה</option>
          <option value="derived">נגזר ממועד עתידי</option>
        </select>
      </div>

      {r.mode === "derived" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-indigo-700">המדד הידוע</span>
            <input type="number" min="0" value={r.offsetMonths ?? ""}
              onChange={function(e) { props.onChange({ ...r, offsetMonths: e.target.value === "" ? null : Number(e.target.value) }); }}
              className="w-20 rounded border border-slate-200 px-2 py-1 text-center text-xs" placeholder="18" />
            <span className="text-indigo-700">חודשים לפני</span>
            <select value={r.anchor} className="rounded border border-slate-200 px-2 py-1 text-xs"
              onChange={function(e) { props.onChange({ ...r, anchor: e.target.value as BaseIndexAnchor }); }}>
              {(Object.keys(ANCHOR_LABELS) as BaseIndexAnchor[]).map(function(k) {
                return <option key={k} value={k}>{ANCHOR_LABELS[k]}</option>;
              })}
            </select>
          </div>

          {resolved?.ok ? (
            <div className="rounded bg-white border border-indigo-200 px-2 py-1.5 text-[11px] text-indigo-800">
              <div className="font-semibold">
                נגזר: מדד <b>{resolved.baseLabel}</b> — המדד הידוע ליום {resolved.cutoffDate}
              </div>
              {props.onResolve && (
                <button type="button"
                  onClick={function() { props.onResolve!(resolved.baseDateForDb!, resolved.baseLabel!); }}
                  className="mt-1 rounded bg-indigo-600 text-white px-2 py-0.5 text-[11px] font-bold hover:bg-indigo-700">
                  קבע כמדד הבסיס
                </button>
              )}
            </div>
          ) : (
            <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px] text-amber-800">
              ⏳ {resolved?.reason || "מדד הבסיס ייקבע כשהמועד יוזן"} — עד אז חישובי ההצמדה לחוזה חלקיים.
            </div>
          )}
        </>
      )}
    </div>
  );
}
