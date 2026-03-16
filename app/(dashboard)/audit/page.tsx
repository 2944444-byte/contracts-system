"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("he-IL");
}

const ACTION_COLORS: Record<string, string> = {
  create:  "bg-green-100 text-green-700",
  update:  "bg-blue-100 text-blue-700",
  delete:  "bg-red-100 text-red-700",
  close:   "bg-slate-100 text-slate-600",
  send:    "bg-purple-100 text-purple-700",
  generate:"bg-yellow-100 text-yellow-700",
};

export default function AuditPage() {
  const [logs,     setLogs]     = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [filterEntity, setFilterEntity] = useState("all");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const { data } = await supabase.from("audit_log")
      .select("*")
      .order("performed_at", { ascending: false })
      .limit(200);
    setLogs(data ?? []);
    setLoading(false);
  }

  const entities = Array.from(new Set(logs.map(function(l) { return l.entity_type; }))).filter(Boolean);

  const filtered = logs.filter(function(l) {
    const ms = filterEntity === "all" || l.entity_type === filterEntity;
    const mq = !search || 
      l.entity_type?.includes(search) || 
      l.action?.includes(search) ||
      l.notes?.includes(search);
    return ms && mq;
  });

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">יומן פעולות</h1>
        <p className="text-sm text-slate-500 mt-1">{logs.length} רשומות</p>
      </div>

      {/* פילטרים */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
          placeholder="חיפוש..." className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm" />
        <select value={filterEntity} onChange={function(e){setFilterEntity(e.target.value);}}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="all">כל הישויות</option>
          {entities.map(function(e) { return <option key={e} value={e}>{e}</option>; })}
        </select>
        <button onClick={loadAll} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50">
          🔄 רענן
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📋</div>
          <div>אין רשומות</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b text-xs">
              <tr>
                <th className="px-4 py-2.5 font-semibold">תאריך ושעה</th>
                <th className="px-4 py-2.5 font-semibold">ישות</th>
                <th className="px-4 py-2.5 font-semibold">פעולה</th>
                <th className="px-4 py-2.5 font-semibold">הערות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(l) {
                const actionColor = ACTION_COLORS[l.action] ?? "bg-slate-100 text-slate-600";
                return (
                  <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(l.performed_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono">
                        {l.entity_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + actionColor}>
                        {l.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{l.notes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
