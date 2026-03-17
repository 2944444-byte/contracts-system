"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const STATUS_COLORS: Record<string, { bar: string; text: string; bg: string }> = {
  active:   { bar: "bg-green-500",  text: "text-green-700",  bg: "bg-green-50"  },
  expiring: { bar: "bg-yellow-400", text: "text-yellow-700", bg: "bg-yellow-50" },
  extended: { bar: "bg-blue-400",   text: "text-blue-700",   bg: "bg-blue-50"   },
  upcoming: { bar: "bg-purple-400", text: "text-purple-700", bg: "bg-purple-50" },
  ended:    { bar: "bg-slate-300",  text: "text-slate-500",  bg: "bg-slate-50"  },
};

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

const HE_MONTHS_SHORT = ["ינ","פב","מר","אפ","מי","יו","יל","אג","ספ","אק","נו","דצ"];

export default function TimelinePage() {
  const router  = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [filterSt,  setFilterSt]  = useState("active");
  const [hovered,   setHovered]   = useState<string | null>(null);
  const [tooltip,   setTooltip]   = useState<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // טווח תצוגה — 3 שנים
  const today     = new Date();
  const viewStart = new Date(today.getFullYear() - 1, 0, 1);
  const viewEnd   = new Date(today.getFullYear() + 2, 11, 31);
  const totalMonths = monthsBetween(viewStart, viewEnd) + 1;

  useEffect(function() { loadContracts(); }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts")
      .select("id, status, start_date, end_date, rent_per_sqm, charged_area, investment_addition, tenants(name), properties(name), contract_options(id,status,start_date,end_date)")
      .not("status", "eq", "ended")
      .order("start_date", { ascending: true });
    setContracts(data ?? []);
    setLoading(false);
  }

  const filtered = contracts.filter(function(c) {
    return filterSt === "all" || c.status === filterSt;
  });

  // חשב position של bar
  function getBarStyle(startStr: string, endStr: string): { left: string; width: string; valid: boolean } {
    if (!startStr || !endStr) return { left: "0%", width: "0%", valid: false };
    const start   = new Date(startStr);
    const end     = new Date(endStr);
    const mStart  = monthsBetween(viewStart, start);
    const mEnd    = monthsBetween(viewStart, end) + 1;
    const left    = Math.max(0, (mStart / totalMonths) * 100);
    const right   = Math.min(100, (mEnd  / totalMonths) * 100);
    const width   = Math.max(0.5, right - left);
    return { left: left + "%", width: width + "%", valid: true };
  }

  // ציר זמן — חודשים
  const timeAxis: { year: number; month: number; isFirst: boolean }[] = [];
  let cur = new Date(viewStart);
  while (cur <= viewEnd) {
    timeAxis.push({ year: cur.getFullYear(), month: cur.getMonth(), isFirst: cur.getMonth() === 0 });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  // קו היום
  const todayLeft = (monthsBetween(viewStart, today) / totalMonths) * 100;

  const STATUS_OPTS = [
    { v: "active",   l: "פעילים",  color: "bg-green-500"  },
    { v: "expiring", l: "פוגים",   color: "bg-yellow-400" },
    { v: "extended", l: "מורחבים", color: "bg-blue-400"   },
    { v: "upcoming", l: "עתידיים", color: "bg-purple-400" },
    { v: "all",      l: "הכל",     color: "bg-slate-400"  },
  ];

  const monthly = function(c: any) {
    return (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Timeline חוזים</h1>
          <p className="text-sm text-slate-500 mt-1">{filtered.length} חוזים | תצוגה ויזואלית</p>
        </div>
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {STATUS_OPTS.map(function(s) {
          const cnt = s.v === "all" ? contracts.length : contracts.filter(function(c){return c.status===s.v;}).length;
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all " +
                (filterSt===s.v ? "border-slate-400 bg-slate-100" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              <div className={"w-2.5 h-2.5 rounded-full " + s.color} />
              {s.l} ({cnt})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📅</div><div>אין חוזים</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* ציר שנים */}
          <div className="border-b border-slate-200 bg-slate-50 overflow-hidden">
            <div className="flex" style={{ paddingRight: "220px" }}>
              {timeAxis.filter(function(t){return t.isFirst;}).map(function(t) {
                const left = (monthsBetween(viewStart, new Date(t.year,0,1)) / totalMonths) * 100;
                return (
                  <div key={t.year} className="absolute text-xs font-bold text-slate-600 py-1 pr-2"
                    style={{ right: (100-left)+"%", transform: "translateX(50%)" }}>
                    {t.year}
                  </div>
                );
              })}
            </div>
          </div>

          {/* header ציר */}
          <div className="flex border-b border-slate-100 bg-slate-50" style={{ direction: "ltr" }}>
            <div className="shrink-0 border-l border-slate-200 bg-slate-50" style={{ width: "220px", minWidth: "220px" }}>
              <div className="text-xs font-semibold text-slate-500 px-3 py-2">שוכר / נכס</div>
            </div>
            <div className="flex-1 relative overflow-hidden" style={{ minWidth: 0 }}>
              <div className="flex h-8">
                {timeAxis.map(function(t, i) {
                  return (
                    <div key={i} className={"shrink-0 border-r border-slate-100 flex items-center justify-center " +
                      (t.isFirst ? "border-r-slate-300" : "")}
                      style={{ width: (100/totalMonths)+"%" }}>
                      <span className="text-[9px] text-slate-400 font-medium">
                        {t.month === 0 ? t.year : HE_MONTHS_SHORT[t.month]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* שורות */}
          <div className="divide-y divide-slate-100 overflow-y-auto" style={{ maxHeight: "60vh" }}>
            {filtered.map(function(c) {
              const sc    = STATUS_COLORS[c.status] ?? STATUS_COLORS.ended;
              const bar   = getBarStyle(c.start_date, c.end_date);
              const isHov = hovered === c.id;
              const mon   = monthly(c);

              return (
                <div key={c.id}
                  className={"flex items-center transition-colors " + (isHov ? sc.bg : "hover:bg-slate-50")}
                  onMouseEnter={function(){setHovered(c.id);}}
                  onMouseLeave={function(){setHovered(null);}}>

                  {/* שם */}
                  <div className="shrink-0 px-3 py-2.5 border-l border-slate-200 cursor-pointer"
                    style={{ width: "220px", minWidth: "220px" }}
                    onClick={function(){router.push("/contracts");}}>
                    <div className="font-semibold text-slate-800 text-sm truncate">{c.tenants?.name}</div>
                    <div className="text-xs text-slate-400 truncate">{c.properties?.name}</div>
                    {mon > 0 && <div className="text-xs text-green-600 font-semibold">₪{Math.round(mon).toLocaleString()}</div>}
                  </div>

                  {/* bar */}
                  <div className="flex-1 relative h-12 overflow-hidden" style={{ direction: "ltr", minWidth: 0 }}>
                    {/* grid lines */}
                    {timeAxis.map(function(t, i) {
                      return (
                        <div key={i} className={"absolute top-0 bottom-0 border-r " +
                          (t.isFirst ? "border-slate-300" : "border-slate-100")}
                          style={{ right: ((totalMonths-i-1)/totalMonths)*100+"%" }} />
                      );
                    })}

                    {/* קו היום */}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10 opacity-60"
                      style={{ right: (100-todayLeft)+"%" }} />

                    {/* bar ראשי */}
                    {bar.valid && (
                      <div
                        className={"absolute top-2 bottom-2 rounded-lg " + sc.bar + " opacity-80 hover:opacity-100 transition-opacity cursor-pointer shadow-sm"}
                        style={{ right: (100-parseFloat(bar.left)-parseFloat(bar.width))+"%" , width: bar.width }}
                        onClick={function(){router.push("/contracts");}}
                        title={c.tenants?.name + " | " + c.start_date?.substring(0,7) + " — " + c.end_date?.substring(0,7)}
                      />
                    )}

                    {/* אופציות */}
                    {(c.contract_options ?? []).filter(function(o:any){return o.status==="pending";}).map(function(opt:any) {
                      const optBar = getBarStyle(opt.start_date ?? c.end_date, opt.end_date);
                      if (!optBar.valid) return null;
                      return (
                        <div key={opt.id}
                          className="absolute top-3 bottom-3 rounded-lg bg-blue-200 opacity-60 border border-blue-400"
                          style={{ right: (100-parseFloat(optBar.left)-parseFloat(optBar.width))+"%", width: optBar.width }}
                          title={"אופציה"}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* legend */}
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 flex items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-green-500 opacity-80" />פעיל</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-yellow-400 opacity-80" />פוגה</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-blue-400 opacity-80" />מורחב</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-purple-400 opacity-80" />עתידי</div>
            <div className="flex items-center gap-1"><div className="w-0.5 h-4 bg-red-400 opacity-60" />היום</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-blue-200 border border-blue-400" />אופציה</div>
          </div>
        </div>
      )}
    </div>
  );
}
