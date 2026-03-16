"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const HE_DAYS   = ["א","ב","ג","ד","ה","ו","ש"];

export default function CalendarPage() {
  const router = useRouter();
  const today  = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(function() { loadEvents(); }, [year, month]);

  async function loadEvents() {
    setLoading(true);
    const from = `${year}-${String(month+1).padStart(2,"0")}-01`;
    const to   = `${year}-${String(month+1).padStart(2,"0")}-${getDaysInMonth(year,month)}`;

    const [{ data: contracts }, { data: alerts }] = await Promise.all([
      supabase.from("contracts")
        .select("id, status, start_date, end_date, tenants(name), properties(name), contract_options(start_date, end_date, status)")
        .or(`start_date.gte.${from},end_date.gte.${from}`)
        .lte("start_date", to),
      supabase.from("alerts")
        .select("id, title, severity, due_date")
        .eq("status", "open")
        .gte("due_date", from)
        .lte("due_date", to),
    ]);

    const evts: any[] = [];

    // חוזים שמתחילים החודש
    (contracts ?? []).forEach(function(c) {
      if (c.start_date >= from && c.start_date <= to) {
        evts.push({ date: c.start_date, type: "start", label: "תחילת: " + c.tenants?.name, color: "bg-green-500", contractId: c.id });
      }
      if (c.end_date >= from && c.end_date <= to) {
        evts.push({ date: c.end_date, type: "end", label: "סיום: " + c.tenants?.name, color: "bg-red-500", contractId: c.id });
      }
      // אופציות
      (c.contract_options ?? []).forEach(function(opt: any) {
        if (opt.end_date >= from && opt.end_date <= to && opt.status === "pending") {
          evts.push({ date: opt.end_date, type: "option", label: "אופציה: " + c.tenants?.name, color: "bg-blue-500", contractId: c.id });
        }
      });
    });

    // התראות
    (alerts ?? []).forEach(function(a) {
      if (a.due_date) {
        const sev = a.severity === "urgent" ? "bg-red-400" : a.severity === "warning" ? "bg-yellow-400" : "bg-blue-400";
        evts.push({ date: a.due_date, type: "alert", label: a.title, color: sev });
      }
    });

    setEvents(evts);
    setLoading(false);
  }

  function getEventsForDay(day: number): any[] {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return events.filter(function(e) { return e.date?.startsWith(dateStr); });
  }

  function prevMonth() {
    if (month === 0) { setYear(year-1); setMonth(11); }
    else { setMonth(month-1); }
    setSelected(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(year+1); setMonth(0); }
    else { setMonth(month+1); }
    setSelected(null);
  }

  const daysInMonth   = getDaysInMonth(year, month);
  const firstDay      = getFirstDayOfMonth(year, month);
  const todayStr      = today.toISOString().split("T")[0];
  const selectedEvts  = selected ? events.filter(function(e) { return e.date?.startsWith(selected); }) : [];

  // סיכום חודשי
  const starts  = events.filter(function(e) { return e.type === "start"; }).length;
  const ends    = events.filter(function(e) { return e.type === "end"; }).length;
  const options = events.filter(function(e) { return e.type === "option"; }).length;
  const alertsC = events.filter(function(e) { return e.type === "alert"; }).length;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">לוח שנה</h1>
          <p className="text-sm text-slate-500 mt-1">ציוני דרך לחוזים והתראות</p>
        </div>
      </div>

      {/* KPI חודשי */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "התחלות",  value: starts,  color: "text-green-700", bg: "bg-green-50",  border: "border-green-200"  },
          { label: "סיומים",  value: ends,    color: "text-red-700",   bg: "bg-red-50",    border: "border-red-200"    },
          { label: "אופציות", value: options, color: "text-blue-700",  bg: "bg-blue-50",   border: "border-blue-200"   },
          { label: "התראות",  value: alertsC, color: "text-yellow-700",bg: "bg-yellow-50", border: "border-yellow-200" },
        ].map(function(k) {
          return (
            <div key={k.label} className={"rounded-xl border p-3 text-center " + k.bg + " " + k.border}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* לוח */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
            <button onClick={prevMonth} className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-600">←</button>
            <span className="font-bold text-slate-800">{HE_MONTHS[month]} {year}</span>
            <button onClick={nextMonth} className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-600">→</button>
          </div>

          {/* ימי שבוע */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {HE_DAYS.map(function(d) {
              return <div key={d} className="text-center text-xs font-semibold text-slate-400 py-2">{d}</div>;
            })}
          </div>

          {/* ימים */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }).map(function(_, i) {
              return <div key={"e"+i} className="min-h-[80px] border-b border-l border-slate-100 bg-slate-50" />;
            })}
            {Array.from({ length: daysInMonth }).map(function(_, i) {
              const day     = i + 1;
              const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const dayEvts = getEventsForDay(day);
              const isToday = dateStr === todayStr;
              const isSel   = selected === dateStr;
              return (
                <div key={day}
                  onClick={function() { setSelected(isSel ? null : dateStr); }}
                  className={"min-h-[80px] border-b border-l border-slate-100 p-1 cursor-pointer transition-colors " +
                    (isSel ? "bg-blue-50" : isToday ? "bg-blue-50" : "hover:bg-slate-50")}>
                  <div className={"text-xs font-bold mb-1 w-6 h-6 rounded-full flex items-center justify-center " +
                    (isToday ? "bg-blue-600 text-white" : "text-slate-600")}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvts.slice(0,3).map(function(e, j) {
                      return (
                        <div key={j} className={"text-white text-xs rounded px-1 truncate " + e.color}>
                          {e.label}
                        </div>
                      );
                    })}
                    {dayEvts.length > 3 && (
                      <div className="text-xs text-slate-400">+{dayEvts.length-3}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* פירוט יום נבחר */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <span className="font-semibold text-slate-700">
              {selected ? new Date(selected).toLocaleDateString("he-IL", { day:"numeric", month:"long", year:"numeric" }) : "בחר יום"}
            </span>
          </div>
          {!selected ? (
            <div className="p-6 text-center text-slate-400 text-sm">לחץ על יום בלוח</div>
          ) : selectedEvts.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm">אין אירועים ביום זה</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedEvts.map(function(e, i) {
                const typeLabel = e.type === "start" ? "📗 תחילת חוזה" :
                  e.type === "end" ? "📕 סיום חוזה" :
                  e.type === "option" ? "📘 אופציה" : "🔔 התראה";
                return (
                  <div key={i} className="p-4">
                    <div className="text-xs text-slate-400 mb-1">{typeLabel}</div>
                    <div className="font-semibold text-slate-800 text-sm">{e.label}</div>
                    {e.contractId && (
                      <button onClick={function() { router.push("/contracts"); }}
                        className="mt-2 text-xs text-blue-600 hover:underline">פתח חוזה →</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* אירועים קרובים */}
          <div className="border-t border-slate-100 px-5 py-3 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 mb-2">אירועים קרובים</div>
            <div className="space-y-1.5">
              {events
                .filter(function(e) { return e.date >= todayStr; })
                .sort(function(a, b) { return a.date.localeCompare(b.date); })
                .slice(0, 5)
                .map(function(e, i) {
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <div className={"w-2 h-2 rounded-full shrink-0 " + e.color} />
                      <div className="text-xs text-slate-600 truncate">{e.label}</div>
                      <div className="text-xs text-slate-400 shrink-0 mr-auto">
                        {new Date(e.date).toLocaleDateString("he-IL", { day:"numeric", month:"short" })}
                      </div>
                    </div>
                  );
                })}
              {events.filter(function(e) { return e.date >= todayStr; }).length === 0 && (
                <div className="text-xs text-slate-400">אין אירועים קרובים</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
