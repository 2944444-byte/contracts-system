"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const PRIORITY_CONFIG: Record<string,{label:string;bg:string;color:string;border:string}> = {
  low:      { label: "נמוכה",   bg: "bg-blue-50",   color: "text-blue-700",   border: "border-blue-100"   },
  medium:   { label: "בינונית", bg: "bg-yellow-50",  color: "text-yellow-700", border: "border-yellow-100" },
  high:     { label: "גבוהה",   bg: "bg-orange-50",  color: "text-orange-700", border: "border-orange-100" },
  critical: { label: "קריטי",   bg: "bg-red-50",     color: "text-red-700",    border: "border-red-200"    },
};

const TYPE_ICONS: Record<string,string> = {
  contract_expiry:    "📄",
  option_deadline:    "⏰",
  guarantee_expiry:   "🏦",
  insurance_expiry:   "🛡️",
  safety_inspection:  "🔒",
  payment_pending:    "💰",
  system:             "⚙️",
  other:              "🔔",
};

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function AlertsPage() {
  const router = useRouter();
  const [alerts,      setAlerts]      = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [filterP,     setFilterP]     = useState("all");
  const [filterType,  setFilterType]  = useState("all");
  const [filterHandled, setFilterHandled] = useState(false);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(function() { load(); }, [filterHandled]);

  async function load() {
    setLoading(true);
    let q = supabase.from("alerts").select("*").order("created_at", { ascending: false });
    if (!filterHandled) q = q.eq("is_handled", false);
    const { data } = await q;
    setAlerts(data ?? []);
    setLoading(false);
  }

  async function markHandled(id: string, handled: boolean) {
    await supabase.from("alerts").update({
      is_handled: handled,
      handled_at: handled ? new Date().toISOString() : null,
    }).eq("id", id);
    await load();
  }

  async function bulkHandle() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    await supabase.from("alerts").update({
      is_handled: true, handled_at: new Date().toISOString(),
    }).in("id", Array.from(selected));
    setSelected(new Set());
    setBulkLoading(false);
    await load();
  }

  async function deleteAlert(id: string) {
    if (!confirm("למחוק התראה?")) return;
    await supabase.from("alerts").delete().eq("id", id);
    await load();
  }

  function toggleSelect(id: string) {
    setSelected(function(prev) {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function navigateToEntity(alert: any) {
    const routes: Record<string,string> = {
      contract:   "/contracts",
      guarantee:  "/guarantees",
      insurance:  "/insurances",
      safety:     "/safety",
      charge:     "/payments",
    };
    const route = routes[alert.related_entity_type ?? ""] ?? "/dashboard";
    router.push(route);
  }

  const filtered = alerts.filter(function(a) {
    const mp = filterP    === "all" || a.priority     === filterP;
    const mt = filterType === "all" || a.alert_type   === filterType;
    return mp && mt;
  });

  const counts = {
    critical: alerts.filter(function(a) { return a.priority === "critical" && !a.is_handled; }).length,
    high:     alerts.filter(function(a) { return a.priority === "high"     && !a.is_handled; }).length,
    open:     alerts.filter(function(a) { return !a.is_handled; }).length,
  };

  const allTypes = [...new Set(alerts.map(function(a) { return a.alert_type; }).filter(Boolean))];

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">התראות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {counts.critical > 0 && <span className="text-red-600 font-semibold">{counts.critical} קריטי | </span>}
            {counts.high > 0     && <span className="text-orange-600 font-semibold">{counts.high} גבוה | </span>}
            {counts.open} פתוחות
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <button onClick={bulkHandle} disabled={bulkLoading}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
              {bulkLoading ? "..." : "✓ טפל ב-" + selected.size + " נבחרות"}
            </button>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {Object.entries(PRIORITY_CONFIG).map(function([k, v]) {
          const cnt = alerts.filter(function(a) { return a.priority === k && !a.is_handled; }).length;
          return (
            <button key={k}
              onClick={function() { setFilterP(filterP === k ? "all" : k); }}
              className={"rounded-xl border p-3 text-center shadow-sm transition-all " + v.bg + " " + v.border +
                (filterP === k ? " ring-2 ring-blue-400" : "")}>
              <div className={"text-xl font-black " + v.color}>{cnt}</div>
              <div className={"text-xs font-semibold " + v.color}>{v.label}</div>
            </button>
          );
        })}
      </div>

      {/* פילטרים */}
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <select value={filterType} onChange={function(e) { setFilterType(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
          <option value="all">כל הסוגים</option>
          {allTypes.map(function(t) {
            return <option key={t} value={t}>{TYPE_ICONS[t] ?? "🔔"} {t}</option>;
          })}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={filterHandled}
            onChange={function(e) { setFilterHandled(e.target.checked); }}
            className="w-4 h-4" />
          הצג מטופלות
        </label>
        {filtered.length > 0 && !filterHandled && (
          <button onClick={function() { setSelected(new Set(filtered.map(function(a) { return a.id; }))); }}
            className="text-xs text-blue-600 hover:underline">
            בחר הכל ({filtered.length})
          </button>
        )}
      </div>

      {/* רשימה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
          <div className="text-5xl mb-3">🔔</div>
          <div>{filterHandled ? "אין התראות" : "אין התראות פתוחות"}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(function(a) {
            const pc = PRIORITY_CONFIG[a.priority] ?? PRIORITY_CONFIG.medium;
            const icon = TYPE_ICONS[a.alert_type ?? ""] ?? "🔔";
            const isSel = selected.has(a.id);
            return (
              <div key={a.id}
                className={"rounded-xl border p-4 shadow-sm transition-all " + pc.bg + " " + pc.border +
                  (a.is_handled ? " opacity-50" : "") +
                  (isSel ? " ring-2 ring-blue-400" : "")}>
                <div className="flex items-start gap-3">
                  {!a.is_handled && (
                    <input type="checkbox" checked={isSel}
                      onChange={function() { toggleSelect(a.id); }}
                      className="w-4 h-4 mt-1 shrink-0" />
                  )}
                  <div className="text-xl shrink-0">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={"text-sm font-bold " + pc.color}>{a.title}</span>
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + pc.bg + " " + pc.color + " border " + pc.border}>
                        {pc.label}
                      </span>
                      {a.is_handled && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ טופל</span>
                      )}
                    </div>
                    {a.message && (
                      <div className="text-xs text-slate-600 mb-1">{a.message}</div>
                    )}
                    <div className="text-xs text-slate-400">
                      {fmtDate(a.created_at)}
                      {a.handled_at && " | טופל: " + fmtDate(a.handled_at)}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {a.related_entity_type && a.related_entity_type !== "system" && (
                      <button onClick={function() { navigateToEntity(a); }}
                        className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50 font-semibold">
                        עבור ←
                      </button>
                    )}
                    {!a.is_handled ? (
                      <button onClick={function() { markHandled(a.id, true); }}
                        className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 font-semibold">
                        ✓ טפל
                      </button>
                    ) : (
                      <button onClick={function() { markHandled(a.id, false); }}
                        className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-500 hover:bg-slate-50">
                        פתח מחדש
                      </button>
                    )}
                    <button onClick={function() { deleteAlert(a.id); }}
                      className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">
                      🗑
                    </button>
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
