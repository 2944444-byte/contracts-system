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
  extended: "bg-blue-400",
  upcoming: "bg-purple-400",
  ended:    "bg-slate-300",
};
const STATUS_LABELS: Record<string,string> = {
  active:"פעיל", expiring:"פוגה", extended:"מורחב", upcoming:"עתידי", ended:"הסתיים",
};

export default function TimelinePage() {
  const router   = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [yearFrom,  setYearFrom]  = useState(new Date().getFullYear());
  const [filterSt,  setFilterSt]  = useState("active");

  const YEARS = 3;
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

  // חשב מיקום ורוחב על ציר הזמן
  function getBar(startStr: string, endStr: string) {
    const totalMonths = YEARS * 12;
    const origin = new Date(yearFrom, 0, 1);
    const start  = new Date(startStr || yearFrom+"-01-01");
    const end    = new Date(endStr   || (yearTo+1)+"-01-01");

    const startM = Math.max(0, (start.getFullYear()-yearFrom)*12 + start.getMonth());
    const endM   = Math.min(totalMonths, (end.getFullYear()-yearFrom)*12 + end.getMonth()+1);

    if (endM <= 0 || startM >= totalMonths) return null;
    return {
      left:  Math.round((startM/totalMonths)*100),
      width: Math.round(((endM-startM)/totalMonths)*100),
    };
  }

  // קו היום
  function getTodayPos() {
    const totalMonths = YEARS * 12;
    const m = (today.getFullYear()-yearFrom)*12 + today.getMonth() + today.getDate()/31;
    if (m < 0 || m > totalMonths) return null;
    return Math.round((m/totalMonths)*100);
  }

  const filtered = contracts.filter(function(c) {
    return filterSt==="all" || c.status===filterSt;
  });

  const todayPct = getTodayPos();

  // header חודשים
  const headerMonths: {year:number;month:number}[] = [];
  for (let y = yearFrom; y <= yearTo; y++) {
    for (let m = 1; m <= 12; m++) headerMonths.push({year:y, month:m});
  }

  return (
    <div dir="rtl">
      <PageHero title="Timeline" icon="📊" tone="violet" subtitle={filtered.length + " חוזים | " + yearFrom + "–" + yearTo}
        actions={
          <div className="flex gap-2 items-center">
            <button onClick={function(){setYearFrom(yearFrom-1);}} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">←</button>
            <span className="text-sm font-bold">{yearFrom}–{yearTo}</span>
            <button onClick={function(){setYearFrom(yearFrom+1);}} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">→</button>
          </div>
        } />

      {/* פילטר סטטוס */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{v:"all",l:"הכל"},{v:"active",l:"פעילים"},{v:"expiring",l:"פוגים"},{v:"extended",l:"מורחבים"},{v:"upcoming",l:"עתידיים"}].map(function(s) {
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all " +
                (filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {s.v!=="all" && <span className={"inline-block w-2 h-2 rounded-full mr-1 " + STATUS_COLORS[s.v]} />}
              {s.l} ({s.v==="all" ? contracts.length : contracts.filter(function(c){return c.status===s.v;}).length})
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
          {/* Header שנים */}
          <div className="border-b border-slate-200 bg-slate-50 min-w-[760px]">
            <div className="flex">
              <div className="w-52 shrink-0 px-4 py-2 text-xs font-semibold text-slate-500 border-l border-slate-200">שוכר / נכס</div>
              <div className="flex-1 relative">
                {/* שנים */}
                <div className="flex">
                  {Array.from({length:YEARS},function(_,i){return yearFrom+i;}).map(function(y) {
                    return (
                      <div key={y} className="flex-1 text-center text-xs font-bold text-slate-600 py-1 border-l border-slate-200 first:border-l-0">
                        {y}
                      </div>
                    );
                  })}
                </div>
                {/* חודשים */}
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

          {/* שורות */}
          <div className="divide-y divide-slate-100 min-w-[760px]">
            {filtered.map(function(c) {
              const bar = c.start_date && c.end_date ? getBar(c.start_date, c.end_date) : null;
              const color = STATUS_COLORS[c.status] ?? "bg-slate-300";
              const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : null;
              const options = (c.contract_options??[]).filter(function(o:any){return o.status!=="expired";});

              return (
                <div key={c.id} className="flex items-center hover:bg-slate-50 group min-h-[44px]">
                  <div className="w-52 shrink-0 px-4 py-2 border-l border-slate-200">
                    <div className="font-semibold text-slate-800 text-sm truncate cursor-pointer hover:text-blue-600"
                      onClick={function(){router.push("/contracts");}}>
                      {c.tenants?.name}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={"w-2 h-2 rounded-full " + color} />
                      <span className="text-xs text-slate-400 truncate">{c.properties?.name}</span>
                    </div>
                  </div>
                  <div className="flex-1 relative h-10 flex items-center">
                    {/* קו היום */}
                    {todayPct !== null && (
                      <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10 opacity-70"
                        style={{left: todayPct+"%"}} />
                    )}
                    {/* בר חוזה */}
                    {bar && (
                      <div className={"absolute h-6 rounded-full flex items-center px-2 z-10 cursor-pointer hover:opacity-80 transition-opacity shadow-sm " + color}
                        style={{left:bar.left+"%", width:Math.max(bar.width,1)+"%"}}
                        onClick={function(){router.push("/contracts");}}>
                        {bar.width > 8 && (
                          <span className="text-white text-xs font-semibold truncate">
                            {days!==null&&days>=0&&days<=90 ? days+"י" : ""}
                          </span>
                        )}
                      </div>
                    )}
                    {/* אופציות */}
                    {options.map(function(opt:any, i:number) {
                      if (!opt.start_date || !opt.end_date) return null;
                      const ob = getBar(opt.start_date, opt.end_date);
                      if (!ob) return null;
                      return (
                        <div key={opt.id}
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
            {Object.entries(STATUS_COLORS).map(function([k,v]) {
              return (
                <span key={k} className="flex items-center gap-1">
                  <span className={"w-3 h-3 rounded " + v} />{STATUS_LABELS[k]}
                </span>
              );
            })}
            <span className="flex items-center gap-1"><span className="w-px h-4 bg-red-400 inline-block" />היום</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-blue-300 inline-block opacity-60" />אופציה</span>
          </div>
        </div>
      )}
    </div>
  );
}
