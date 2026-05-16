"use client";
import React, { useEffect, useState } from "react";

export interface CalcProgressState {
  current: number;        // 0..total
  total: number;          // total items to process (0 = indeterminate)
  label: string;          // what's being processed right now
  startedAt: number;      // Date.now() at start, for elapsed timer
}

/**
 * Generic progress indicator for long-running CPI/rent calculations.
 *
 * Shows: animated bar + current/total + label + elapsed seconds.
 * When total=0 the bar pulses indeterminately (use during data-load phase
 * before the loop length is known).
 *
 * Usage:
 *   const [progress, setProgress] = useState<CalcProgressState | null>(null);
 *   ...
 *   setProgress({ current: 0, total: contracts.length, label: "טוען...", startedAt: Date.now() });
 *   for (var i = 0; i < contracts.length; i++) {
 *     setProgress(p => p ? { ...p, current: i + 1, label: contracts[i].name } : null);
 *     await heavyWork(contracts[i]);
 *   }
 *   setProgress(null);
 *   ...
 *   {progress && <CalcProgress {...progress} />}
 */
export default function CalcProgress({ current, total, label, startedAt }: CalcProgressState) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(function() {
    var id = setInterval(function() {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return function() { clearInterval(id); };
  }, [startedAt]);

  var pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  var mins = Math.floor(elapsed / 60);
  var secs = elapsed % 60;
  var timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs} שניות`;

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between mb-1.5 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block h-3 w-3 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-sm font-bold text-blue-900 truncate">{label || "מחשב…"}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-blue-700 whitespace-nowrap">
          {total > 0 && <span className="font-bold">{current} / {total}</span>}
          <span className="text-blue-600">⏱ {timeStr}</span>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
        {total > 0 ? (
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
            style={{ width: pct + "%" }}
          />
        ) : (
          // Indeterminate: a moving stripe
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-blue-400 to-indigo-500 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
        )}
      </div>
      {total > 0 && (
        <div className="mt-1 text-[10px] text-blue-600 text-left tabular-nums">{pct}%</div>
      )}
      <style jsx>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
