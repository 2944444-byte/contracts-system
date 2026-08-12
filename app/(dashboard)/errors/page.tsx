"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
import { useAccess } from '@/components/AccessProvider';

// מסך שגיאות ודיווחים — לבעלי המערכת בלבד (masterOnly + RLS). מרכז את כל
// קריסות המסך, השגיאות הגלובליות ודיווחי המשתמשים, ואת דופק האוטומציות.

const KIND_HE: Record<string, { l: string; icon: string; cls: string }> = {
  client_error:      { l: "קריסת מסך",   icon: "💥", cls: "bg-rose-100 text-rose-700" },
  unhandled_promise: { l: "שגיאת רקע",   icon: "⚠️", cls: "bg-amber-100 text-amber-700" },
  user_report:       { l: "דיווח משתמש", icon: "📣", cls: "bg-blue-100 text-blue-700" },
};
const JOB_HE: Record<string, string> = {
  sync_contracts: "סנכרון לילי (סטטוסים, אופציות, התראות)",
  transfer_billing: "חיובי העברה/ה\"ק (16–20 בחודש)",
};

export default function ErrorsPage() {
  const { access } = useAccess();
  const [rows, setRows] = useState<any[]>([]);
  const [beats, setBeats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  useEffect(function() { load(); }, []);
  async function load() {
    setLoading(true);
    const [{ data: e }, { data: h }] = await Promise.all([
      supabase.from("app_errors").select("*").order("occurred_at", { ascending: false }).limit(400),
      supabase.from("system_heartbeats").select("*"),
    ]);
    setRows(e ?? []); setBeats(h ?? []);
    setLoading(false);
  }

  async function setResolved(r: any, v: boolean) {
    await supabase.from("app_errors").update({ resolved: v }).eq("id", r.id);
    await load();
  }
  async function resolveAll() {
    if (!confirm("לסמן את כל השגיאות הפתוחות כטופלו?")) return;
    await supabase.from("app_errors").update({ resolved: true }).eq("resolved", false);
    await load();
  }

  const visible = rows.filter(function(r){ return showResolved || !r.resolved; });
  const openCount = rows.filter(function(r){ return !r.resolved; }).length;

  function beatFor(job: string) { return beats.find(function(b){ return b.job === job; }); }
  function beatStale(job: string, maxHours: number): boolean {
    var b = beatFor(job);
    if (!b) return true;
    return (Date.now() - new Date(b.last_run).getTime()) > maxHours * 3600 * 1000;
  }

  if (access && !access.profile?.is_master) {
    return <div dir="rtl" className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400 mt-8">
      <div className="text-5xl mb-3">🔒</div>
      <div className="font-semibold text-slate-600">המסך זמין לבעלי המערכת בלבד</div>
    </div>;
  }

  return (
    <div dir="rtl">
      <PageHero title="שגיאות ודיווחים" icon="🐞" tone="slate"
        subtitle={openCount + " פתוחים"}
        actions={openCount > 0 ? <button onClick={resolveAll} className="rounded-xl bg-white text-slate-700 px-4 py-2 text-sm font-bold hover:bg-slate-100 shadow-sm">✓ סמן הכל כטופל</button> : undefined} />

      {/* Automation heartbeats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {["sync_contracts", "transfer_billing"].map(function(job) {
          var b = beatFor(job);
          // The nightly sync must beat daily; transfer billing only runs on
          // the 16th-20th, so "stale" there is informational, not alarming.
          var alarm = job === "sync_contracts" && beatStale(job, 26);
          return (
            <div key={job} className={"rounded-xl border p-3 " + (alarm ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white")}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-slate-700">{alarm ? "🔴" : "🟢"} {JOB_HE[job] || job}</div>
                {b?.last_status && <span className={"text-[10px] rounded-full px-2 py-0.5 font-bold " + (b.last_status === "ok" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>{b.last_status}</span>}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {b ? ("ריצה אחרונה: " + new Date(b.last_run).toLocaleString("he-IL")) : "עדיין לא רץ מאז הוספת המעקב"}
                {b?.details ? " · " + b.details : ""}
              </div>
              {alarm && <div className="text-xs font-semibold text-rose-700 mt-1">הסנכרון הלילי לא רץ ביממה האחרונה — בדוק את ה-Cron ב-Vercel.</div>}
            </div>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-500 mb-3 cursor-pointer">
        <input type="checkbox" checked={showResolved} onChange={function(e){ setShowResolved(e.target.checked); }} className="w-3.5 h-3.5" />
        הצג גם שגיאות שטופלו
      </label>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin"></span>טוען...</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">✨</div><div>אין שגיאות פתוחות — המערכת נקייה</div>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(function(r) {
            var k = KIND_HE[r.kind] || KIND_HE.client_error;
            var open = openRow === r.id;
            return (
              <div key={r.id} className={"rounded-xl border bg-white shadow-sm " + (r.resolved ? "opacity-60 border-slate-100" : "border-slate-200")}>
                <button onClick={function(){ setOpenRow(open ? null : r.id); }} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-right">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={"text-[10px] rounded-full px-2 py-0.5 font-bold shrink-0 " + k.cls}>{k.icon} {k.l}</span>
                    <span className="text-sm text-slate-700 font-semibold truncate">{r.message}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
                    <span>{r.email || "לא מזוהה"}</span>
                    <span dir="ltr">{r.route || ""}</span>
                    <span dir="ltr">{new Date(r.occurred_at).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-3 border-t border-slate-100 pt-2">
                    <div className="text-xs text-slate-600 whitespace-pre-wrap break-all mb-2" dir="ltr">{r.message}</div>
                    {r.stack && <pre className="text-[10px] text-slate-400 bg-slate-50 rounded-lg p-2 overflow-x-auto max-h-48 mb-2" dir="ltr">{r.stack}</pre>}
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span dir="ltr">{r.user_agent || ""}</span>
                      <button onClick={function(){ setResolved(r, !r.resolved); }}
                        className={"rounded-lg px-3 py-1 text-xs font-bold " + (r.resolved ? "border border-slate-200 text-slate-500 hover:bg-slate-50" : "bg-green-600 text-white hover:bg-green-700")}>
                        {r.resolved ? "החזר לפתוח" : "✓ טופל"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
