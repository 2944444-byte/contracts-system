"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { resolveAlert, deleteAlert, generateSystemAlerts } from "../../../lib/db-helpers";

const PRIORITY: Record<string, { label: string; color: string; dot: string }> = {
  critical: { label: "קריטי",  color: "bg-red-50 border-red-200",       dot: "bg-red-500" },
  high:     { label: "גבוה",   color: "bg-orange-50 border-orange-200", dot: "bg-orange-500" },
  medium:   { label: "בינוני", color: "bg-yellow-50 border-yellow-200", dot: "bg-yellow-400" },
  low:      { label: "נמוך",   color: "bg-blue-50 border-blue-200",     dot: "bg-blue-400" },
};
const TYPE_LABELS: Record<string, string> = {
  lease_ending: "סיום חוזה", option_expiry: "פקיעת אופציה",
  deposit_renewal: "חידוש ערבות", insurance_renewal: "חידוש ביטוח", vacancy_alert: "פינוי צפוי",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<"unresolved"|"resolved"|"all">("unresolved");
  const [typeFilter, setTypeFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("alerts").select("*")
      .order("due_date", { ascending: true }).order("created_at", { ascending: false });
    setAlerts(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    await generateSystemAlerts();
    await load();
    setGenerating(false);
  }

  const filtered = alerts.filter(a => {
    const s = filter === "all" ? true : filter === "resolved" ? a.is_resolved : !a.is_resolved;
    const t = typeFilter === "all" || a.alert_type === typeFilter;
    return s && t;
  });

  const unresolved = alerts.filter(a => !a.is_resolved).length;
  const critical = alerts.filter(a => !a.is_resolved && a.priority === "critical").length;

  return (
    <div dir="rtl" className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
            🔔 מרכז התראות
            {unresolved > 0 && <span className="text-sm font-bold bg-red-500 text-white px-2.5 py-1 rounded-full">{unresolved}</span>}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {critical > 0 && <span className="text-red-600 font-semibold">{critical} קריטיות · </span>}
            {unresolved} פתוחות מתוך {alerts.length} סה&quot;כ
          </p>
        </div>
        <button onClick={handleGenerate} disabled={generating}
          className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {generating ? "🔄 מייצר..." : "⚡ ייצר התראות אוטומטיות"}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "קריטיות", count: alerts.filter(a => !a.is_resolved && a.priority === "critical").length, color: "text-red-600", bg: "bg-red-50 border-red-100" },
          { label: "גבוהות",  count: alerts.filter(a => !a.is_resolved && a.priority === "high").length,     color: "text-orange-600", bg: "bg-orange-50 border-orange-100" },
          { label: "סיום חוזה", count: alerts.filter(a => !a.is_resolved && a.alert_type === "lease_ending").length, color: "text-purple-600", bg: "bg-purple-50 border-purple-100" },
          { label: "ערבויות", count: alerts.filter(a => !a.is_resolved && a.alert_type === "deposit_renewal").length, color: "text-blue-600", bg: "bg-blue-50 border-blue-100" },
        ].map((s, i) => (
          <div key={i} className={`rounded-xl border p-4 ${s.bg}`}>
            <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(["unresolved","all","resolved"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${filter === f ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>
              {f === "unresolved" ? "פתוחות" : f === "resolved" ? "טופלו" : "הכל"}
            </button>
          ))}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none">
          <option value="all">כל הסוגים</option>
          {Object.entries(TYPE_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="space-y-3">
        {loading ? Array(4).fill(0).map((_,i) => <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />)
        : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="font-semibold text-slate-700">אין התראות</p>
          </div>
        ) : filtered.map(alert => {
          const pc = PRIORITY[alert.priority] ?? PRIORITY.medium;
          return (
            <div key={alert.id} className={`rounded-xl border p-4 ${alert.is_resolved ? "bg-slate-50 border-slate-200 opacity-60" : pc.color}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${pc.dot}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800">{alert.title}</span>
                      <span className="rounded-full bg-white/70 border px-2 py-0.5 text-xs text-slate-500">{TYPE_LABELS[alert.alert_type] ?? alert.alert_type}</span>
                      <span className="text-xs font-semibold text-slate-500">{pc.label}</span>
                      {alert.is_resolved && <span className="text-xs text-green-600 font-semibold">✓ טופל</span>}
                    </div>
                    <p className="text-sm text-slate-600 mt-1">{alert.message}</p>
                    {alert.due_date && <p className="text-xs text-slate-400 mt-1.5">📅 {new Date(alert.due_date).toLocaleDateString("he-IL")}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!alert.is_resolved && (
                    <button onClick={async () => { await resolveAlert(alert.id); setAlerts(p => p.map(a => a.id === alert.id ? {...a, is_resolved: true} : a)); }}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700">✓ טפלתי</button>
                  )}
                  <button onClick={async () => { if(!confirm("למחוק?")) return; await deleteAlert(alert.id); setAlerts(p => p.filter(a => a.id !== alert.id)); }}
                    className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-50">🗑</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
