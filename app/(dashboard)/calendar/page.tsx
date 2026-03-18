"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';

const DAYS_HE  = ["א","ב","ג","ד","ה","ו","ש"];
const MONTHS_HE = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

type CalEvent = { date: string; label: string; type: string; color: string; };

export default function CalendarPage() {
  const today    = new Date();
  const [year,   setYear]   = useState(today.getFullYear());
  const [month,  setMonth]  = useState(today.getMonth()+1);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading,setLoading]= useState(true);
  const [sel,    setSel]    = useState<string | null>(null);

  useEffect(function() { loadEvents(); }, [year, month]);

  async function loadEvents() {
    setLoading(true);
    const from = `${year}-${String(month).padStart(2,"0")}-01`;
    const to   = `${year}-${String(month).padStart(2,"0")}-31`;

    const [{ data: c }, { data: a }, { data: g }] = await Promise.all([
      supabase.from("contracts")
        .select("id, end_date, start_date, tenants(name)")
        .or(`end_date.gte.${from},start_date.gte.${from}`)
        .or(`end_date.lte.${to},start_date.lte.${to}`),
      supabase.from("alerts")
        .select("id, title, due_date, severity")
        .gte("due_date", from).lte("due_date", to).eq("status", "open"),
      supabase.from("guarantees")
        .select("id, end_date, contracts(tenants(name))")
        .gte("end_date", from).lte("end_date", to).eq("status", "active"),
    ]);

    const ev: CalEvent[] = [];
    // חוזים פוגים
    (c ?? []).forEach(function(x) {
      if (x.end_date >= from && x.end_date <= to) {
        ev.push({ date: x.end_date.split("T")[0], label: "סיום: " + (x.tenants?.name ?? ""), type:"contract_end", color:"bg-red-100 text-red-700 border-red-200" });
      }
      if (x.start_date >= from && x.start_date <= to) {
        ev.push({ date: x.start_date.split("T")[0], label: "תחילה: " + (x.tenants?.name ?? ""), type:"contract_start", color:"bg-green-100 text-green-700 border-green-200" });
      }
    });
    // התראות
    (a ?? []).forEach(function(x) {
      if (x.due_date) {
        ev.push({ date: x.due_date.split("T")[0], label: x.title, type:"alert", color: x.severity==="urgent" ? "bg-red-100 text-red-700 border-red-200" : "bg-yellow-100 text-yellow-700 border-yellow-200" });
      }
    });
    // ערבויות
    (g ?? []).forEach(function(x) {
      if (x.end_date) {
        ev.push({ date: x.end_date.split("T")[0], label: "ערבות פגה: " + (x.contracts?.tenants?.name ?? ""), type:"guarantee", color:"bg-orange-100 text-orange-700 border-orange-200" });
      }
    });

    setEvents(ev);
    setLoading(false);
  }

  function prevMonth() {
    if (month === 1) { setYear(year-1); setMonth(12); }
    else setMonth(month-1);
  }
  function nextMonth() {
    if (month === 12) { setYear(year+1); setMonth(1); }
    else setMonth(month+1);
  }

  // בנה ימי החודש
  const firstDay = new Date(year, month-1, 1).getDay(); // 0=ראשון
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number|null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function dayEvents(day: number) {
    const dateStr = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return events.filter(function(e) { return e.date === dateStr; });
  }

  function isToday(day: number) {
    return day === today.getDate() && month === today.getMonth()+1 && year === today.getFullYear();
  }

  const selEvents = sel ? events.filter(function(e){return e.date===sel;}) : [];

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">לוח שנה</h1>
          <p className="text-sm text-slate-500 mt-1">{events.length} אירועים החודש</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-600 hover:bg-slate-50">←</button>
          <span className="text-lg font-bold text-slate-700 min-w-36 text-center">{MONTHS_HE[month]} {year}</span>
          <button onClick={nextMonth} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-600 hover:bg-slate-50">→</button>
          <button onClick={function(){setYear(today.getFullYear());setMonth(today.getMonth()+1);}}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700 text-sm font-semibold">היום</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* לוח */}
        <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* ימי השבוע */}
          <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
            {DAYS_HE.map(function(d) {
              return (
                <div key={d} className="text-center text-xs font-bold text-slate-500 py-2">{d}</div>
              );
            })}
          </div>
          {/* ימים */}
          <div className="grid grid-cols-7">
            {cells.map(function(day, i) {
              if (!day) return <div key={i} className="min-h-20 border-b border-l border-slate-100 bg-slate-50/50" />;
              const dayEvs = dayEvents(day);
              const today_ = isToday(day);
              return (
                <div key={i} onClick={function(){setSel(sel===`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`?null:`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`);}}
                  className={"min-h-20 border-b border-l border-slate-100 p-1 cursor-pointer hover:bg-slate-50 transition-colors " +
                    (today_?"bg-blue-50":"")}>
                  <div className={"text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full " +
                    (today_?"bg-blue-600 text-white":"text-slate-700")}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvs.slice(0,2).map(function(e,j) {
                      return (
                        <div key={j} className={"text-xs px-1 py-0.5 rounded border truncate " + e.color}>
                          {e.label.substring(0,18)}
                        </div>
                      );
                    })}
                    {dayEvs.length > 2 && <div className="text-xs text-slate-400">+{dayEvs.length-2} עוד</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* פאנל ימין */}
        <div className="space-y-4">
          {/* אירועים ביום נבחר */}
          {sel && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-semibold text-slate-700 text-sm">
                  {new Date(sel).toLocaleDateString("he-IL", {day:"numeric",month:"long",year:"numeric"})}
                </span>
                <button onClick={function(){setSel(null);}} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              {selEvents.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-sm">אין אירועים</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {selEvents.map(function(e,i) {
                    return (
                      <div key={i} className="px-4 py-3">
                        <div className={"text-xs px-2 py-0.5 rounded border inline-block mb-1 " + e.color}>
                          {e.type==="contract_end"?"סיום חוזה":e.type==="contract_start"?"תחילת חוזה":e.type==="alert"?"התראה":"ערבות"}
                        </div>
                        <div className="text-sm text-slate-700 font-medium">{e.label}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* אירועים קרובים */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">
              אירועים החודש ({events.length})
            </div>
            {loading ? (
              <div className="p-4 text-center text-slate-400 text-sm">טוען...</div>
            ) : events.length === 0 ? (
              <div className="p-4 text-center text-slate-400 text-sm">אין אירועים</div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {events.sort(function(a,b){return a.date.localeCompare(b.date);}).map(function(e,i) {
                  return (
                    <div key={i} className="px-4 py-2.5 flex gap-2 items-start cursor-pointer hover:bg-slate-50"
                      onClick={function(){setSel(e.date);}}>
                      <div className={"w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 " + e.color.split(" ")[0].replace("bg-","bg-").replace("100","500")} />
                      <div className="min-w-0">
                        <div className="text-xs text-slate-500">{new Date(e.date).toLocaleDateString("he-IL",{day:"numeric",month:"short"})}</div>
                        <div className="text-xs font-medium text-slate-700 truncate">{e.label}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
