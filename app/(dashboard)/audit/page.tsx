"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("he-IL", { dateStyle:"short", timeStyle:"short" });
}

const ACTION_COLORS: Record<string,string> = {
  create:  "bg-green-100 text-green-700",
  update:  "bg-blue-100 text-blue-700",
  delete:  "bg-red-100 text-red-700",
  approve: "bg-purple-100 text-purple-700",
  paid:    "bg-emerald-100 text-emerald-700",
  returned:"bg-teal-100 text-teal-700",
  forfeited:"bg-orange-100 text-orange-700",
  upload:  "bg-slate-100 text-slate-600",
  generate:"bg-yellow-100 text-yellow-700",
};

const ENTITY_ICONS: Record<string,string> = {
  contract:"📄", tenant:"👤", property:"🏢", space:"🚪",
  charge:"💳", guarantee:"🏦", safety:"🔒", document:"📁",
  letter:"✉️", management_fee:"🔧", company:"🏛️", group:"📁",
  alert:"🔔", default:"📝",
};

export default function AuditPage() {
  const [logs,      setLogs]      = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [filterEntity, setFilterEntity] = useState("all");
  const [page,      setPage]      = useState(0);
  const PAGE_SIZE = 50;

  useEffect(function() { loadLogs(); }, [page, filterEntity]);

  async function loadLogs() {
    setLoading(true);
    let q = supabase.from("audit_log")
      .select("*", { count:"exact" })
      .order("performed_at", { ascending: false })
      .range(page*PAGE_SIZE, (page+1)*PAGE_SIZE - 1);
    if (filterEntity !== "all") q = q.eq("entity_type", filterEntity);
    const { data } = await q;
    setLogs(data ?? []);
    setLoading(false);
  }

  const entities = ["contract","charge","guarantee","safety","document","letter","management_fee","company","tenant","property"];

  return (
    <div dir="rtl">
      <PageHero title="יומן פעולות" icon="📜" tone="slate" subtitle="מעקב אחרי כל הפעולות במערכת"
        actions={<button onClick={function(){setPage(0);loadLogs();}} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-sm text-white hover:bg-white/25">🔄 רענן</button>} />

      {/* פילטר */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={function(){setFilterEntity("all");setPage(0);}}
          className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
            (filterEntity==="all"?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
          הכל
        </button>
        {entities.map(function(e) {
          return (
            <button key={e} onClick={function(){setFilterEntity(e);setPage(0);}}
              className={"rounded-xl border px-2.5 py-1.5 text-xs font-semibold " +
                (filterEntity===e?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {ENTITY_ICONS[e]??ENTITY_ICONS.default} {e}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📝</div><div>אין פעולות ביומן</div>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-700">תאריך ושעה</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">ישות</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">פעולה</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">מזהה</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">הערות</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(function(log) {
                  const actionColor = ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-600";
                  const icon = ENTITY_ICONS[log.entity_type] ?? ENTITY_ICONS.default;
                  return (
                    <tr key={log.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                        {fmtDate(log.performed_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-sm">{icon}</span>
                        <span className="text-xs text-slate-600 mr-1">{log.entity_type}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + actionColor}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono text-slate-400">
                          {log.entity_id ? log.entity_id.substring(0,8)+"..." : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 max-w-xs truncate">
                        {log.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* ניווט עמודים */}
          <div className="flex items-center justify-between mt-3">
            <button onClick={function(){if(page>0)setPage(page-1);}} disabled={page===0}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 disabled:opacity-30 hover:bg-slate-50">
              ← קודם
            </button>
            <span className="text-xs text-slate-500">עמוד {page+1}</span>
            <button onClick={function(){if(logs.length===PAGE_SIZE)setPage(page+1);}} disabled={logs.length<PAGE_SIZE}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 disabled:opacity-30 hover:bg-slate-50">
              הבא →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
