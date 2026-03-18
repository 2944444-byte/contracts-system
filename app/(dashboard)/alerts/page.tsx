"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function daysLeft(d: string) { return Math.ceil((new Date(d).getTime()-Date.now())/86400000); }

const SEV_MAP: Record<string,{label:string;color:string;bg:string;border:string}> = {
  urgent:  {label:"דחוף",   color:"text-red-700",   bg:"bg-red-50",    border:"border-red-200"  },
  warning: {label:"אזהרה",  color:"text-yellow-700",bg:"bg-yellow-50", border:"border-yellow-200"},
  info:    {label:"מידע",   color:"text-blue-700",  bg:"bg-blue-50",   border:"border-blue-200" },
};

const ENTITY_ICONS: Record<string,string> = {
  contract:"📄", guarantee:"🏦", insurance:"🛡️", option:"🔄", safety:"🔒", default:"🔔"
};

export default function AlertsPage() {
  const [alerts,   setAlerts]   = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [filterSev,setFilterSev]= useState("all");
  const [filterSt, setFilterSt] = useState("open");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(function() { loadAlerts(); }, []);

  async function loadAlerts() {
    const { data } = await supabase.from("alerts").select("*").order("severity").order("due_date").order("created_at",{ascending:false});
    setAlerts(data??[]); setLoading(false);
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/alerts/sync",{method:"POST"});
      const d = await res.json();
      await loadAlerts();
      alert(`✅ נוצרו ${d.created??0} התראות חדשות`);
    } catch { alert("❌ שגיאה בסנכרון"); }
    finally { setSyncing(false); }
  }

  async function closeAlert(id: string) {
    await supabase.from("alerts").update({status:"closed"}).eq("id",id);
    setAlerts(function(prev){return prev.map(function(a){return a.id===id?{...a,status:"closed"}:a;});});
  }

  async function bulkClose() {
    if (!selected.size) return;
    if (!confirm(`לסגור ${selected.size} התראות?`)) return;
    for (const id of selected) await supabase.from("alerts").update({status:"closed"}).eq("id",id);
    setSelected(new Set());
    await loadAlerts();
  }

  async function reopen(id: string) {
    await supabase.from("alerts").update({status:"open"}).eq("id",id);
    setAlerts(function(prev){return prev.map(function(a){return a.id===id?{...a,status:"open"}:a;});});
  }

  function toggleSel(id: string) {
    setSelected(function(prev){const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n;});
  }

  const filtered = alerts.filter(function(a){
    return (filterSt==="all"||a.status===filterSt) && (filterSev==="all"||a.severity===filterSev);
  });

  const urgentOpen  = alerts.filter(function(a){return a.status==="open"&&a.severity==="urgent";}).length;
  const warningOpen = alerts.filter(function(a){return a.status==="open"&&a.severity==="warning";}).length;
  const totalOpen   = alerts.filter(function(a){return a.status==="open";}).length;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">התראות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {totalOpen} פתוחות
            {urgentOpen>0&&<span className="text-red-600 font-semibold"> | {urgentOpen} דחופות!</span>}
            {warningOpen>0&&<span className="text-yellow-600 font-semibold"> | {warningOpen} אזהרות</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size>0&&(
            <button onClick={bulkClose} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              ✓ סגור {selected.size} נבחרות
            </button>
          )}
          <button onClick={handleSync} disabled={syncing}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {syncing?"⏳ מסנכרן...":"🔄 סנכרן"}
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          {l:"דחופות",  v:urgentOpen,  bg:"bg-red-50",    border:"border-red-200",   c:"text-red-700",    f:"urgent"},
          {l:"אזהרות",  v:warningOpen, bg:"bg-yellow-50", border:"border-yellow-200",c:"text-yellow-700", f:"warning"},
          {l:"כל הפתוחות",v:totalOpen, bg:"bg-white",     border:"border-slate-200", c:"text-slate-700",  f:"all"},
        ].map(function(k){return (
          <button key={k.l} onClick={function(){setFilterSev(filterSev===k.f?"all":k.f);setFilterSt("open");}}
            className={"rounded-xl border p-3 text-center transition-all "+k.bg+" "+k.border+(filterSev===k.f?" ring-2 ring-blue-300":"")}>
            <div className={"text-2xl font-black "+k.c}>{k.v}</div>
            <div className={"text-xs font-semibold "+k.c}>{k.l}</div>
          </button>
        );})}
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{v:"open",l:"פתוחות"},{v:"closed",l:"סגורות"},{v:"all",l:"הכל"}].map(function(s){return (
          <button key={s.v} onClick={function(){setFilterSt(s.v);setSelected(new Set());}}
            className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
            {s.l} ({alerts.filter(function(a){return s.v==="all"||a.status===s.v;}).length})
          </button>
        );})}
        <div className="flex-1"/>
        {filtered.some(function(a){return a.status==="open";})&&(
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
            <input type="checkbox" onChange={function(e){setSelected(e.target.checked?new Set(filtered.filter(function(a){return a.status==="open";}).map(function(a){return a.id;})):new Set());}} className="w-3.5 h-3.5"/>
            בחר הכל
          </label>
        )}
      </div>

      {loading ? <div className="text-center py-12 text-slate-400">טוען...</div> : filtered.length===0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🎉</div>
          <div className="font-semibold text-slate-600">אין התראות {filterSt==="open"?"פתוחות":""}</div>
          <div className="text-sm mt-1">המערכת תקינה</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(function(a) {
            const si     = SEV_MAP[a.severity] ?? SEV_MAP.info;
            const icon   = ENTITY_ICONS[a.entity_type] ?? ENTITY_ICONS.default;
            const d      = a.due_date ? daysLeft(a.due_date) : null;
            const isOpen = a.status==="open";
            const isSel  = selected.has(a.id);
            return (
              <div key={a.id} className={"rounded-xl border p-4 flex items-start gap-3 transition-all "+(isOpen?si.bg+" "+si.border:"bg-white border-slate-200 opacity-60")+(isSel?" ring-2 ring-blue-400":"")}>
                {isOpen&&<input type="checkbox" checked={isSel} onChange={function(){toggleSel(a.id);}} className="mt-1 w-4 h-4 shrink-0"/>}
                <span className="text-xl shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-0.5">
                    <span className={"text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 "+si.color+" "+si.bg}>{si.label}</span>
                    <span className={"font-semibold text-sm "+(isOpen?"text-slate-800":"text-slate-500")}>{a.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    {a.due_date&&<span>📅 {fmtDate(a.due_date)}</span>}
                    {d!==null&&isOpen&&<span className={"font-semibold "+(d<=0?"text-red-600":d<=30?"text-red-500":"text-yellow-600")}>{d<=0?"פג!":d+" יום"}</span>}
                  </div>
                </div>
                <div className="shrink-0">
                  {isOpen ? (
                    <button onClick={function(){closeAlert(a.id);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✓ סגור</button>
                  ) : (
                    <button onClick={function(){reopen(a.id);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50">↩ פתח</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
