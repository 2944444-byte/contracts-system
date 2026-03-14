"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function formatDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function daysLeft(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - new Date().getTime()) / (1000*60*60*24));
}

const severityConfig: Record<string, { label: string; icon: string; bg: string; color: string; border: string }> = {
  info:     { label: "מידע",       icon: "🔵", bg: "bg-blue-50",   color: "text-blue-700",   border: "border-blue-200"  },
  warning:  { label: "תשומת לב",  icon: "🟡", bg: "bg-yellow-50", color: "text-yellow-700", border: "border-yellow-200"},
  high:     { label: "גבוה",       icon: "🟠", bg: "bg-orange-50", color: "text-orange-700", border: "border-orange-200"},
  critical: { label: "קריטי",      icon: "🔴", bg: "bg-red-50",    color: "text-red-700",    border: "border-red-200"   },
};

const typeLabels: Record<string, string> = {
  contract_end:      "סיום חוזה",
  option_notice:     "מועד הודעת אופציה",
  insurance_expiry:  "פקיעת ביטוח",
  guarantee_expiry:  "פקיעת ערבות",
  safety_due:        "בדיקת בטיחות",
  charge_pending:    "חיוב ממתין",
};

export default function AlertsPage() {
  const router = useRouter();
  const [alerts, setAlerts]         = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState<"all"|"open"|"handled">("open");
  const [typeFilter, setTypeFilter] = useState("all");
  const [handling, setHandling]     = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("alerts")
      .select("*")
      .order("due_date", { ascending: true })
      .order("severity", { ascending: false });
    setAlerts(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleMark(id: string, handled: boolean) {
    setHandling(id);
    await supabase.from("alerts").update({
      is_handled: handled,
      handled_at: handled ? new Date().toISOString() : null,
    }).eq("id", id);
    await load();
    setHandling(null);
  }

  async function handleMarkAllRead() {
    if (!confirm("לסמן את כל ההתראות הפתוחות כטופלו?")) return;
    await supabase.from("alerts")
      .update({ is_handled: true, handled_at: new Date().toISOString() })
      .eq("is_handled", false);
    await load();
  }

  const filtered = alerts.filter(a => {
    const matchStatus = filter === "all" || (filter === "open" ? !a.is_handled : a.is_handled);
    const matchType   = typeFilter === "all" || a.alert_type === typeFilter;
    return matchStatus && matchType;
  });

  const openCount     = alerts.filter(a => !a.is_handled).length;
  const criticalCount = alerts.filter(a => !a.is_handled && a.severity === "critical").length;
  const types         = [...new Set(alerts.map(a => a.alert_type))];

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">התראות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {openCount > 0
              ? <span>{openCount} התראות פתוחות{criticalCount > 0 ? ` — ${criticalCount} קריטיות` : ""}</span>
              : "אין התראות פתוחות ✓"}
          </p>
        </div>
        {openCount > 0 && (
          <button onClick={handleMarkAllRead}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            ✓ סמן הכל כטופל
          </button>
        )}
      </div>

      {/* סיכום */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {Object.entries(severityConfig).map(([key, cfg]) => {
          const count = alerts.filter(a => !a.is_handled && a.severity === key).length;
          return (
            <button key={key} onClick={() => setFilter("open")}
              className={`rounded-xl border p-4 text-center ${cfg.bg} ${cfg.border} shadow-sm`}>
              <div className={`text-2xl font-bold ${cfg.color}`}>{count}</div>
              <div className={`text-xs mt-1 font-medium ${cfg.color}`}>{cfg.icon} {cfg.label}</div>
            </button>
          );
        })}
      </div>

      {/* פילטרים */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          {(["open","all","handled"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${filter === f ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {f === "open" ? "פתוחות" : f === "all" ? "הכל" : "טופלו"}
            </button>
          ))}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
          <option value="all">כל הסוגים</option>
          {types.map(t => <option key={t} value={t}>{typeLabels[t] ?? t}</option>)}
        </select>
      </div>

      {/* רשימת התראות */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
          <div className="text-5xl mb-3">🔔</div>
          <div className="font-medium">אין התראות להצגה</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(a => {
            const cfg = severityConfig[a.severity ?? "info"] ?? severityConfig.info;
            const days = a.due_date ? daysLeft(a.due_date) : null;
            return (
              <div key={a.id}
                className={`rounded-xl border p-4 shadow-sm transition-opacity ${a.is_handled ? "opacity-50" : ""} ${cfg.bg} ${cfg.border}`}>
                <div className="flex items-start gap-3">
                  <div className="text-xl mt-0.5 shrink-0">{cfg.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`font-bold text-sm ${cfg.color}`}>{a.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium bg-white/60 ${cfg.color}`}>
                        {typeLabels[a.alert_type] ?? a.alert_type}
                      </span>
                      {a.is_handled && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ טופל</span>
                      )}
                    </div>
                    {a.message && (
                      <div className="text-sm text-slate-700 mb-1">{a.message}</div>
                    )}
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      {a.due_date && (
                        <span className={days !== null && days <= 0 ? "text-red-600 font-semibold" : ""}>
                          📅 {formatDate(a.due_date)}
                          {days !== null && (
                            <span className="mr-1">
                              ({days < 0 ? `עבר לפני ${Math.abs(days)} ימים` : days === 0 ? "היום" : `עוד ${days} ימים`})
                            </span>
                          )}
                        </span>
                      )}
                      {a.handled_at && (
                        <span>טופל: {formatDate(a.handled_at.split("T")[0])}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {!a.is_handled ? (
                      <button onClick={() => handleMark(a.id, true)} disabled={handling === a.id}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/80 border ${cfg.border} ${cfg.color} hover:bg-white disabled:opacity-50`}>
                        {handling === a.id ? "..." : "✓ טפלתי"}
                      </button>
                    ) : (
                      <button onClick={() => handleMark(a.id, false)} disabled={handling === a.id}
                        className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200 bg-white/80 disabled:opacity-50">
                        {handling === a.id ? "..." : "↩ פתח מחדש"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
