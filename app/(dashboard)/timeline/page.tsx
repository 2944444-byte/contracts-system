"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';

const MONTHS_HE = ["","ינו","פבר","מרץ","אפר","מאי","יונ","יול","אוג","ספט","אוק","נוב","דצמ"];

const STATUS_COLORS: Record<string,string> = {
  active:   "bg-green-400",
  expiring: "bg-yellow-400",
  extended: "bg-teal-400",     // distinct from the blue "option" bar
  upcoming: "bg-purple-400",
  ended:    "bg-slate-300",
};
// "הוארך" (was extended) = an option was already EXERCISED and the term pushed
// out — NOT to be confused with the blue "אופציה" bar, which is a future,
// not-yet-exercised option period.
const STATUS_LABELS: Record<string,string> = {
  active:"פעיל", expiring:"פוגה", extended:"הוארך", upcoming:"עתידי", ended:"הסתיים",
};

function fmtDate(s?: string) { return s ? new Date(s).toLocaleDateString("he-IL") : "—"; }

export default function TimelinePage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [yearFrom,  setYearFrom]  = useState(new Date().getFullYear());
  const [years,     setYears]     = useState(3);          // visible span (zoom)
  const [filterSt,  setFilterSt]  = useState("active");
  const [propFilter, setPropFilter] = useState("");        // "" = all (within scope)
  const [search,    setSearch]    = useState("");

  const YEARS  = years;
  const yearTo = yearFrom + YEARS - 1;
  const today  = new Date();

  useEffect(function() { loadContracts(); }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts")
      .select("id, property_id, status, start_date, end_date, tenants(name), properties(name), contract_options(*)")
      .order("start_date");
    var scope = await getScopeIds();
    setContracts(scopeRows(data ?? [], scope, function(c: any){ return c.property_id; }));
    setLoading(false);
  }

  // Position+width on the timeline (percent of the visible span).
  function getBar(startStr: string, endStr: string) {
    const totalMonths = YEARS * 12;
    const start  = new Date(startStr || yearFrom+"-01-01");
    const end    = new Date(endStr   || (yearTo+1)+"-01-01");
    const startM = Math.max(0, (start.getFullYear()-yearFrom)*12 + start.getMonth());
    const endM   = Math.min(totalMonths, (end.getFullYear()-yearFrom)*12 + end.getMonth()+1);
    if (endM <= 0 || startM >= totalMonths) return null;
    return { left: Math.round((startM/totalMonths)*100), width: Math.round(((endM-startM)/totalMonths)*100) };
  }

  function getTodayPos() {
    const totalMonths = YEARS * 12;
    const m = (today.getFullYear()-yearFrom)*12 + today.getMonth() + today.getDate()/31;
    if (m < 0 || m > totalMonths) return null;
    return Math.round((m/totalMonths)*100);
  }

  // Property list for the filter — derived from the ALREADY-SCOPED contracts, so
  // it can only ever contain properties the user is allowed to see.
  const propMap: Record<string,string> = {};
  contracts.forEach(function(c){ if (c.property_id) propMap[c.property_id] = c.properties?.name || ""; });
  const propList = Object.keys(propMap).map(function(id){ return { id: id, name: propMap[id] }; })
    .sort(function(a,b){ return a.name.localeCompare(b.name); });

  const filtered = contracts.filter(function(c) {
    if (!(filterSt==="all" || c.status===filterSt)) return false;
    if (propFilter && c.property_id !== propFilter) return false;
    if (search) {
      var q = search.toLowerCase();
      var hay = ((c.tenants?.name || "") + " " + (c.properties?.name || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  const todayPct = getTodayPos();

  const headerMonths: {year:number;month:number}[] = [];
  for (let y = yearFrom; y <= yearTo; y++) for (let m = 1; m <= 12; m++) headerMonths.push({year:y, month:m});

  function openContract(id: string) { router.push("/contracts?select=" + id); }

  return (
    <div dir="rtl">
      <PageHero title="Timeline" icon="📊" tone="violet" subtitle={filtered.length + " חוזים | " + yearFrom + "–" + yearTo}
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            <div className="flex rounded-xl bg-white/15 backdrop-blur border border-white/25 overflow-hidden">
              {[2,3,5].map(function(n){ return (
                <button key={n} onClick={function(){setYears(n);}} className={"px-2.5 py-2 text-xs font-bold " + (years===n ? "bg-white text-violet-700" : "text-white hover:bg-white/15")}>{n}ש'</button>
              ); })}
            </div>
            <button onClick={function(){setYearFrom(yearFrom-1);}} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">←</button>
            <span className="text-sm font-bold">{yearFrom}–{yearTo}</span>
            <button onClick={function(){setYearFrom(yearFrom+1);}} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">→</button>
            <button onClick={function(){setYearFrom(new Date().getFullYear());}} className="rounded-xl bg-white text-violet-700 px-3 py-2 text-sm font-bold hover:bg-violet-50 shadow-sm">היום</button>
          </div>
        } />

      {/* Property filter + search — properties list is already scoped. */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-600 shrink-0">🏢 נכס:</span>
        <select value={propFilter} onChange={function(e){setPropFilter(e.target.value);}}
          className="w-full sm:w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-right text-slate-800">
          <option value="">כל הנכסים ({propList.length})</option>
          {propList.map(function(p){ return <option key={p.id} value={p.id}>{p.name}</option>; })}
        </select>
        <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
          placeholder="🔍 חיפוש שוכר / נכס"
          className="w-full sm:w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-right" />
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{v:"all",l:"הכל"},{v:"active",l:"פעילים"},{v:"expiring",l:"פוגים"},{v:"extended",l:"הוארכו"},{v:"upcoming",l:"עתידיים"}].map(function(s) {
          var cnt = s.v==="all" ? contracts.length : contracts.filter(function(c){return c.status===s.v;}).length;
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all " +
                (filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {s.v!=="all" && <span className={"inline-block w-2 h-2 rounded-full mr-1 " + STATUS_COLORS[s.v]} />}
              {s.l} ({cnt})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📊</div><div>אין חוזים להצגה</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          {/* Header */}
          <div className="border-b border-slate-200 bg-slate-50 min-w-[760px]">
            <div className="flex">
              <div className="w-52 shrink-0 px-4 py-2 text-xs font-semibold text-slate-500 border-l border-slate-200">שוכר / נכס</div>
              <div className="flex-1 relative">
                <div className="flex">
                  {Array.from({length:YEARS},function(_,i){return yearFrom+i;}).map(function(y) {
                    return <div key={y} className="flex-1 text-center text-xs font-bold text-slate-600 py-1 border-l border-slate-200 first:border-l-0">{y}</div>;
                  })}
                </div>
                <div className="flex border-t border-slate-100">
                  {headerMonths.map(function(hm, i) {
                    return (
                      <div key={i} className={"flex-1 text-center text-slate-400 py-0.5 border-l border-slate-100 first:border-l-0 " +
                        (hm.year===today.getFullYear()&&hm.month===today.getMonth()+1?"bg-blue-50 text-blue-500 font-bold":"")}>
                        <span className="text-[9px]">{MONTHS_HE[hm.month]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100 min-w-[760px]">
            {filtered.map(function(c) {
              const bar = c.start_date && c.end_date ? getBar(c.start_date, c.end_date) : null;
              const color = STATUS_COLORS[c.status] ?? "bg-slate-300";
              const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : null;
              const options = (c.contract_options??[]).filter(function(o:any){return o.status!=="expired";});
              const tip = (c.tenants?.name || "") + " · " + fmtDate(c.start_date) + " – " + fmtDate(c.end_date) +
                (days!==null ? (days>=0 ? " · עוד " + days + " ימים" : " · הסתיים") : "");
              return (
                <div key={c.id} className="flex items-center hover:bg-slate-50 group min-h-[44px]">
                  <div className="w-52 shrink-0 px-4 py-2 border-l border-slate-200 cursor-pointer" onClick={function(){openContract(c.id);}}>
                    <div className="font-semibold text-slate-800 text-sm truncate group-hover:text-blue-600">{c.tenants?.name}</div>
                    <div className="flex items-center gap-1">
                      <span className={"w-2 h-2 rounded-full shrink-0 " + color} />
                      <span className="text-xs text-slate-400 truncate">{c.properties?.name}</span>
                      {days!==null && days>=0 && days<=180 && <span className={"text-[10px] font-bold shrink-0 " + (days<=90?"text-red-600":"text-amber-600")}>{days}י'</span>}
                    </div>
                  </div>
                  <div className="flex-1 relative h-10 flex items-center">
                    {todayPct !== null && (
                      <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10 opacity-70" style={{left: todayPct+"%"}} />
                    )}
                    {bar && (
                      <div title={tip} className={"absolute h-6 rounded-full flex items-center px-2 z-10 cursor-pointer hover:opacity-80 transition-opacity shadow-sm " + color}
                        style={{left:bar.left+"%", width:Math.max(bar.width,1)+"%"}}
                        onClick={function(){openContract(c.id);}}>
                        {bar.width > 8 && (
                          <span className="text-white text-xs font-semibold truncate">
                            {days!==null&&days>=0&&days<=90 ? days+"י" : ""}
                          </span>
                        )}
                      </div>
                    )}
                    {options.map(function(opt:any) {
                      if (!opt.start_date || !opt.end_date) return null;
                      const ob = getBar(opt.start_date, opt.end_date);
                      if (!ob) return null;
                      return (
                        <div key={opt.id} title={"אופציה (לא מומשה): " + fmtDate(opt.start_date) + " – " + fmtDate(opt.end_date)}
                          className="absolute h-3 rounded-full bg-blue-300 opacity-60 z-5"
                          style={{left:ob.left+"%", width:Math.max(ob.width,0.5)+"%", top:"70%"}} />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="border-t border-slate-100 px-4 py-2 bg-slate-50 flex items-center gap-4 text-xs text-slate-500 flex-wrap">
            {Object.keys(STATUS_COLORS).map(function(k) {
              return <span key={k} className="flex items-center gap-1"><span className={"w-3 h-3 rounded " + STATUS_COLORS[k]} />{STATUS_LABELS[k]}</span>;
            })}
            <span className="flex items-center gap-1"><span className="w-px h-4 bg-red-400 inline-block" />היום</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-blue-300 inline-block opacity-60" />אופציה (עתידית, לא מומשה)</span>
          </div>
        </div>
      )}

      {/* Terminology helper */}
      <div className="mt-3 text-[11px] text-slate-400 leading-relaxed bg-slate-50 rounded-lg p-3 max-w-3xl">
        💡 <span className="font-semibold text-slate-500">"הוארך"</span> = חוזה שכבר הוארך כי אופציה <span className="font-semibold">מומשה</span> (תאריך הסיום נדחף קדימה).
        זה שונה מ-<span className="font-semibold text-slate-500">"אופציה"</span> (הפס הכחול הדק) שמסמן תקופת אופציה <span className="font-semibold">עתידית שעוד לא מומשה</span>.
      </div>
    </div>
  );
}
