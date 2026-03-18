"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';

const SEVERITY_MAP: Record<string,{label:string;color:string;bg:string;dot:string}> = {
  urgent:  { label:"דחוף",    color:"text-red-700",    bg:"bg-red-50 border-red-200",    dot:"bg-red-500"    },
  warning: { label:"אזהרה",   color:"text-yellow-700", bg:"bg-yellow-50 border-yellow-200", dot:"bg-yellow-500" },
  info:    { label:"מידע",    color:"text-blue-700",   bg:"bg-blue-50 border-blue-200",   dot:"bg-blue-400"   },
};

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}
function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

export default function AlertsPage() {
  const [alerts,    setAlerts]    = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);
  const [filterSev, setFilterSev] = useState("all");
  const [filterSt,  setFilterSt]  = useState("open");

  useEffect(function() { loadAlerts(); }, []);

  async function loadAlerts() {
    const { data } = await supabase.from("alerts")
      .select("*")
      .order("severity", { ascending: true })
      .order("due_date", { ascending: true });
    setAlerts(data ?? []);
    setLoading(false);
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/alerts/sync", { method: "POST" });
      const d   = await res.json();
      await loadAlerts();
      alert("✅ נוצרו " + (d.created ?? 0) + " התראות חדשות");
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSyncing(false); }
  }

  async function handleClose(id: string) {
    await supabase.from("alerts").update({ status:"closed", closed_at: new Date().toISOString() }).eq("id", id);
    await loadAlerts();
  }

  async function handleCloseAll() {
    if (!confirm("לסגור את כל ההתראות הפתוחות?")) return;
    const open = filtered.filter(function(a) { return a.status === "open"; });
    for (const a of open) {
      await supabase.from("alerts").update({ status:"closed", closed_at: new Date().toISOString() }).eq("id", a.id);
    }
    await loadAlerts();
  }

  const filtered = alerts.filter(function(a) {
    const ms = filterSt === "all" || a.status === filterSt;
    const mv = filterSev === "all" || a.severity === filterSev;
    return ms && mv;
  });

  const urgent  = alerts.filter(function(a) { return a.severity==="urgent"  && a.status==="open"; }).length;
  const warning = alerts.filter(function(a) { return a.severity==="warning" && a.status==="open"; }).length;
  const info    = alerts.filter(function(a) { return a.severity==="info"    && a.status==="open"; }).length;
  const closed  = alerts.filter(function(a) { return a.status==="closed"; }).length;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">התראות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {urgent > 0 && <span className="text-red-600 font-semibold">{urgent} דחופות | </span>}
            {warning > 0 && <span className="text-yellow-600 font-semibold">{warning} אזהרות | </span>}
            {info} מידע
          </p>
        </div>
        <div className="flex gap-2">
          {filtered.filter(function(a){return a.status==="open";}).length > 0 && (
            <button onClick={handleCloseAll}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              ✓ סגור הכל
            </button>
          )}
          <button onClick={handleSync} disabled={syncing}
            className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {syncing ? "⏳ סורק..." : "🔄 סנכרן"}
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label:"דחופות",  value:urgent,  color:"text-red-700",    bg:"bg-red-50",    filter:"urgent",  sev:"urgent"  },
          { label:"אזהרות",  value:warning, color:"text-yellow-700", bg:"bg-yellow-50", filter:"warning", sev:"warning" },
          { label:"מידע",    value:info,    color:"text-blue-700",   bg:"bg-blue-50",   filter:"info",    sev:"info"    },
          { label:"סגורות",  value:closed,  color:"text-slate-500",  bg:"bg-white",     filter:"closed",  sev:"all"     },
        ].map(function(k) {
          return (
            <button key={k.label}
              onClick={function(){setFilterSev(filterSev===k.sev&&filterSt===k.filter?"all":k.sev);setFilterSt(k.filter==="closed"?"closed":"open");}}
              className={"rounded-xl border p-3 text-center transition-all " + k.bg +
                (filterSev===k.sev?" border-blue-500 ring-2 ring-blue-300":" border-slate-200")}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
            </button>
          );
        })}
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{v:"open",l:"פתוחות"},{v:"closed",l:"סגורות"},{v:"all",l:"הכל"}].map(function(s) {
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {s.l}
            </button>
          );
        })}
        <div className="w-px bg-slate-200 mx-1" />
        {[{v:"all",l:"כל החומרות"},{v:"urgent",l:"🔴 דחוף"},{v:"warning",l:"🟡 אזהרה"},{v:"info",l:"🔵 מידע"}].map(function(s) {
          return (
            <button key={s.v} onClick={function(){setFilterSev(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSev===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {s.l}
            </button>
          );
        })}
      </div>

      {/* רשימה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🎉</div>
          <div className="font-semibold">אין התראות פתוחות!</div>
          <button onClick={handleSync} disabled={syncing}
            className="mt-3 text-blue-600 hover:underline text-sm">
            {syncing ? "סורק..." : "לחץ לסנכרן ולבדוק"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(function(a) {
            const si = SEVERITY_MAP[a.severity] ?? SEVERITY_MAP.info;
            const days = a.due_date ? daysLeft(a.due_date) : null;
            return (
              <div key={a.id}
                className={"rounded-xl border p-4 flex items-start gap-3 " + si.bg +
                  (a.status==="closed" ? " opacity-50" : "")}>
                <div className={"w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 " + si.dot} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={"text-xs font-bold px-1.5 py-0.5 rounded " + si.color.replace("text-","bg-").replace("700","100") + " " + si.color}>
                      {si.label}
                    </span>
                    {a.entity_type && (
                      <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{a.entity_type}</span>
                    )}
                  </div>
                  <div className="font-semibold text-slate-800 text-sm">{a.title}</div>
                  {a.due_date && (
                    <div className={"text-xs mt-0.5 font-medium " +
                      (days!==null&&days<0?"text-red-500":days!==null&&days<=7?"text-orange-500":"text-slate-400")}>
                      {days !== null && days < 0
                        ? "⏰ איחור " + Math.abs(days) + " ימים"
                        : days !== null && days === 0
                        ? "⚠️ היום!"
                        : "📅 " + fmtDate(a.due_date) + (days!==null?" ("+days+" ימים)":"")}
                    </div>
                  )}
                </div>
                {a.status === "open" && (
                  <button onClick={function(){handleClose(a.id);}}
                    className={"shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:opacity-80 " + si.color + " border-current"}>
                    ✓ סגור
                  </button>
                )}
                {a.status === "closed" && (
                  <span className="shrink-0 text-xs text-slate-400">סגור {fmtDate(a.closed_at)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
