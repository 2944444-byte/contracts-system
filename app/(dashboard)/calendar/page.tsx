"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';
import { deriveEvents, EVENT_TYPES, type CalEvent, type CalEventType } from '@/lib/calendar-events';

const DAYS_HE  = ["א","ב","ג","ד","ה","ו","ש"];
const MONTHS_HE = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const TYPE_KEYS = Object.keys(EVENT_TYPES) as CalEventType[];

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoOf(d: Date) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function daysBetween(a: string, b: string) {
  var pa = a.split("-"), pb = b.split("-");
  var da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
  var db = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export default function CalendarPage() {
  const today = new Date();
  const todayISO = isoOf(today);
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [view,  setView]  = useState<"month" | "year">("month");
  const [events,  setEvents]  = useState<CalEvent[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [propFilter, setPropFilter] = useState("");   // "" = all properties (within scope)
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  // Which event types are visible (all on by default).
  const [enabled, setEnabled] = useState<Record<string, boolean>>(function () {
    var o: Record<string, boolean> = {}; TYPE_KEYS.forEach(function (k) { o[k] = true; }); return o;
  });
  const [feedUrl, setFeedUrl] = useState("");
  const [showSub, setShowSub] = useState(false);

  useEffect(function () { loadEvents(); }, [year]);
  useEffect(function () { loadFeed(); }, []);

  async function loadFeed() {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return;
    const { data: p } = await supabase.from("user_profiles").select("calendar_token").eq("id", u.user.id).maybeSingle();
    if (p?.calendar_token) {
      // The feed MUST be served from the PUBLIC production domain — the
      // git-branch / team-slug URLs are gated by Vercel Authentication (SSO),
      // which Google/Outlook can't pass. The canonical *.vercel.app alias is
      // public. Override with NEXT_PUBLIC_SITE_URL if a custom domain is added.
      const base = process.env.NEXT_PUBLIC_SITE_URL || "https://contracts-system.vercel.app";
      setFeedUrl(base + "/api/calendar/ics?token=" + p.calendar_token);
    }
  }

  async function loadEvents() {
    setLoading(true);
    // Wide window: the whole displayed year UNION the next 12 months from today,
    // so both the year view and the always-on "upcoming" list have their data.
    const yStart = year + "-01-01";
    const yEnd   = year + "-12-31";
    const horizonEnd = isoOf(new Date(today.getFullYear(), today.getMonth() + 12, 0));
    const from = yStart < todayISO ? yStart : todayISO;
    const to   = yEnd > horizonEnd ? yEnd : horizonEnd;

    const [c, g, it, ib, sf, op, al, pr] = await Promise.all([
      supabase.from("contracts").select("id, end_date, start_date, status, property_id, tenants(name)").in("status", ["active","expiring","extended","upcoming","ended"]),
      supabase.from("guarantees").select("id, end_date, contract_id, contracts(property_id, tenants(name))").eq("status","active").not("end_date","is",null),
      supabase.from("insurances_tenant").select("id, end_date, contract_id, contracts(property_id, tenants(name))").eq("status","active").not("end_date","is",null),
      supabase.from("insurances_building").select("id, end_date, property_id, properties(name)").eq("status","active").not("end_date","is",null),
      supabase.from("safety_inspections").select("id, next_inspection_date, inspection_type, property_id, properties(name)").not("next_inspection_date","is",null),
      supabase.from("contract_options").select("id, notice_deadline, status, contract_id, contracts(property_id, tenants(name))").not("notice_deadline","is",null).not("status","in","(exercised,declined,expired)"),
      supabase.from("alerts").select("id, title, due_date, severity, property_id, contracts(property_id)").eq("is_resolved",false).not("due_date","is",null),
      supabase.from("properties").select("id, name").order("name"),
    ]);

    const scope = await getScopeIds();
    setProperties(scopeRows(pr.data ?? [], scope, function (r: any) { return r.id; }));
    const pid = function (r: any) { return r.property_id || r.contracts?.property_id; };
    const data = {
      contracts:  scopeRows(c.data ?? [],  scope, function (r: any) { return r.property_id; }),
      guarantees: scopeRows(g.data ?? [],  scope, function (r: any) { return r.contracts?.property_id; }),
      insT:       scopeRows(it.data ?? [], scope, function (r: any) { return r.contracts?.property_id; }),
      insB:       scopeRows(ib.data ?? [], scope, function (r: any) { return r.property_id; }),
      safety:     scopeRows(sf.data ?? [], scope, function (r: any) { return r.property_id; }),
      options:    scopeRows(op.data ?? [], scope, function (r: any) { return r.contracts?.property_id; }),
      alerts:     scopeRows(al.data ?? [], scope, pid),
    };

    setEvents(deriveEvents(data, from, to));
    setLoading(false);
  }

  const visible = events.filter(function (e) {
    if (!enabled[e.type]) return false;
    if (propFilter && e.propertyId !== propFilter) return false;
    return true;
  });

  function prevMonth() { if (month === 1) { setYear(year - 1); setMonth(12); } else setMonth(month - 1); }
  function nextMonth() { if (month === 12) { setYear(year + 1); setMonth(1); } else setMonth(month + 1); }
  function goToday() { setYear(today.getFullYear()); setMonth(today.getMonth() + 1); setView("month"); }
  function toggleType(k: string) { setEnabled(function (p) { var n = Object.assign({}, p); n[k] = !n[k]; return n; }); }

  function eventsOn(dateStr: string) { return visible.filter(function (e) { return e.date === dateStr; }); }

  const monthCount = visible.filter(function (e) { return e.date.slice(0, 7) === year + "-" + pad(month); }).length;

  // Upcoming (today onward), grouped by horizon, with countdown.
  const upcoming = visible.filter(function (e) { return e.date >= todayISO; })
    .sort(function (a, b) { return a.date.localeCompare(b.date); });
  const horizons = [
    { key: "week",  label: "השבוע",        max: 7 },
    { key: "m1",    label: "תוך 30 יום",   max: 30 },
    { key: "m3",    label: "תוך 90 יום",   max: 90 },
    { key: "later", label: "מאוחר יותר",   max: 99999 },
  ];
  function horizonOf(e: CalEvent) { var d = daysBetween(todayISO, e.date); for (var i = 0; i < horizons.length; i++) if (d <= horizons[i].max) return horizons[i].key; return "later"; }

  const selEvents = sel ? visible.filter(function (e) { return e.date === sel; }) : [];

  return (
    <div dir="rtl">
      <PageHero title="לוח שנה" icon="📅" tone="blue"
        subtitle={view === "month" ? (monthCount + " אירועים החודש") : (visible.filter(function (e) { return e.date.slice(0, 4) === String(year); }).length + " אירועים השנה")}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-xl bg-white/15 backdrop-blur border border-white/25 overflow-hidden">
              <button onClick={function () { setView("month"); }} className={"px-3 py-2 text-sm font-bold " + (view === "month" ? "bg-white text-blue-700" : "text-white hover:bg-white/15")}>חודש</button>
              <button onClick={function () { setView("year"); }} className={"px-3 py-2 text-sm font-bold " + (view === "year" ? "bg-white text-blue-700" : "text-white hover:bg-white/15")}>שנה</button>
            </div>
            {view === "month" ? (
              <>
                <button onClick={prevMonth} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">←</button>
                <span className="text-base sm:text-lg font-bold min-w-[7rem] text-center">{MONTHS_HE[month]} {year}</span>
                <button onClick={nextMonth} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">→</button>
              </>
            ) : (
              <>
                <button onClick={function () { setYear(year - 1); }} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">←</button>
                <span className="text-lg font-bold min-w-[4rem] text-center">{year}</span>
                <button onClick={function () { setYear(year + 1); }} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-white hover:bg-white/25">→</button>
              </>
            )}
            <button onClick={goToday} className="rounded-xl bg-white text-blue-700 px-3 py-2 text-sm font-bold hover:bg-blue-50 shadow-sm">היום</button>
            <button onClick={function () { setShowSub(true); }} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-sm font-bold text-white hover:bg-white/25">🔗 סנכרון</button>
          </div>
        } />

      {/* Property filter — only properties the user is allowed to see appear. */}
      {properties.length > 0 && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-600 shrink-0">🏢 נכס:</span>
          <select value={propFilter} onChange={function (e) { setPropFilter(e.target.value); }}
            className="w-full sm:w-72 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-right text-slate-800">
            <option value="">כל הנכסים ({properties.length})</option>
            {properties.map(function (p: any) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
          </select>
          {propFilter && <button onClick={function () { setPropFilter(""); }} className="text-xs text-blue-600 font-semibold shrink-0">✕ נקה</button>}
        </div>
      )}

      {/* Legend + type filter */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TYPE_KEYS.map(function (k) {
          var t = EVENT_TYPES[k];
          var on = enabled[k];
          return (
            <button key={k} onClick={function () { toggleType(k); }}
              className={"flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all " +
                (on ? "border-slate-200 bg-white text-slate-700" : "border-slate-100 bg-slate-50 text-slate-300 line-through")}>
              <span className={"w-2 h-2 rounded-full " + (on ? t.dot : "bg-slate-300")} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Calendar */}
        <div className="lg:col-span-3">
          {view === "month" ? (
            <MonthGrid year={year} month={month} today={today} eventsOn={eventsOn}
              sel={sel} setSel={setSel} />
          ) : (
            <YearGrid year={year} today={today} visible={visible}
              onPickMonth={function (m: number, day?: number) { setMonth(m); setView("month"); if (day) setSel(year + "-" + pad(m) + "-" + pad(day)); }} />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {sel && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-semibold text-slate-700 text-sm">{new Date(sel).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })}</span>
                <button onClick={function () { setSel(null); }} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              {selEvents.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-sm">אין אירועים</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {selEvents.map(function (e, i) { return <EventRow key={i} e={e} todayISO={todayISO} withDate={false} />; })}
                </div>
              )}
            </div>
          )}

          {/* Upcoming — always on, grouped, with countdown */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">
              אירועים קרובים ({upcoming.length})
            </div>
            {loading ? (
              <div className="p-4 text-center text-slate-400 text-sm">טוען...</div>
            ) : upcoming.length === 0 ? (
              <div className="p-4 text-center text-slate-400 text-sm">אין אירועים קרובים</div>
            ) : (
              <div className="max-h-[28rem] overflow-y-auto">
                {horizons.map(function (h) {
                  var rows = upcoming.filter(function (e) { return horizonOf(e) === h.key; });
                  if (rows.length === 0) return null;
                  return (
                    <div key={h.key}>
                      <div className="px-4 py-1.5 bg-slate-50 text-[11px] font-bold text-slate-400 sticky top-0">{h.label} · {rows.length}</div>
                      <div className="divide-y divide-slate-100">
                        {rows.map(function (e, i) {
                          return (
                            <div key={i} onClick={function () { var p = e.date.split("-"); setMonth(Number(p[1])); setYear(Number(p[0])); setView("month"); setSel(e.date); }}
                              className="cursor-pointer hover:bg-slate-50">
                              <EventRow e={e} todayISO={todayISO} withDate={true} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {showSub && <SubscribeModal feedUrl={feedUrl} propFilter={propFilter}
        propName={(properties.find(function (p: any) { return p.id === propFilter; }) || {}).name}
        onClose={function () { setShowSub(false); }} />}
    </div>
  );
}

// ── Month grid ───────────────────────────────────────────────────────────────
function MonthGrid(props: { year: number; month: number; today: Date; eventsOn: (d: string) => CalEvent[]; sel: string | null; setSel: (s: string | null) => void; }) {
  const { year, month, today } = props;
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  function isToday(day: number) { return day === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear(); }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
        {DAYS_HE.map(function (d) { return <div key={d} className="text-center text-xs font-bold text-slate-500 py-2">{d}</div>; })}
      </div>
      <div className="grid grid-cols-7">
        {cells.map(function (day, i) {
          if (!day) return <div key={i} className="min-h-16 sm:min-h-20 border-b border-l border-slate-100 bg-slate-50/50" />;
          const dateStr = year + "-" + pad(month) + "-" + pad(day);
          const evs = props.eventsOn(dateStr);
          const today_ = isToday(day);
          const seld = props.sel === dateStr;
          return (
            <div key={i} onClick={function () { props.setSel(seld ? null : dateStr); }}
              className={"min-h-16 sm:min-h-20 border-b border-l border-slate-100 p-1 cursor-pointer transition-colors " +
                (seld ? "bg-blue-100/60 ring-1 ring-inset ring-blue-300" : today_ ? "bg-blue-50" : "hover:bg-slate-50")}>
              <div className={"text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full " + (today_ ? "bg-blue-600 text-white" : "text-slate-700")}>{day}</div>
              {/* mobile: dots only; sm+: labels */}
              <div className="hidden sm:block space-y-0.5">
                {evs.slice(0, 3).map(function (e, j) {
                  return <div key={j} className={"text-[11px] leading-tight px-1 py-0.5 rounded border truncate " + EVENT_TYPES[e.type].chip}>{EVENT_TYPES[e.type].icon} {e.label}</div>;
                })}
                {evs.length > 3 && <div className="text-[10px] text-slate-400">+{evs.length - 3} עוד</div>}
              </div>
              {evs.length > 0 && (
                <div className="sm:hidden flex flex-wrap gap-0.5 mt-0.5">
                  {evs.slice(0, 4).map(function (e, j) { return <span key={j} className={"w-1.5 h-1.5 rounded-full " + EVENT_TYPES[e.type].dot} />; })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Year grid: 12 mini-months ────────────────────────────────────────────────
function YearGrid(props: { year: number; today: Date; visible: CalEvent[]; onPickMonth: (m: number, day?: number) => void; }) {
  const { year, today, visible } = props;
  // index events by date for quick lookup
  const byDate: Record<string, number> = {};
  const dotsByDate: Record<string, string[]> = {};
  visible.forEach(function (e) {
    if (e.date.slice(0, 4) !== String(year)) return;
    byDate[e.date] = (byDate[e.date] || 0) + 1;
    if (!dotsByDate[e.date]) dotsByDate[e.date] = [];
    if (dotsByDate[e.date].length < 3) dotsByDate[e.date].push(EVENT_TYPES[e.type].dot);
  });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {Array.from({ length: 12 }, function (_, k) { return k + 1; }).map(function (m) {
        const firstDay = new Date(year, m - 1, 1).getDay();
        const daysInMonth = new Date(year, m, 0).getDate();
        const cells: (number | null)[] = Array(firstDay).fill(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);
        const count = visible.filter(function (e) { return e.date.slice(0, 7) === year + "-" + pad(m); }).length;
        return (
          <div key={m} className="rounded-xl border border-slate-200 bg-white shadow-sm p-3">
            <button onClick={function () { props.onPickMonth(m); }} className="w-full flex items-center justify-between mb-2 group">
              <span className="font-bold text-slate-700 text-sm group-hover:text-blue-600">{MONTHS_HE[m]}</span>
              {count > 0 && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5">{count}</span>}
            </button>
            <div className="grid grid-cols-7 gap-0.5">
              {DAYS_HE.map(function (d) { return <div key={d} className="text-center text-[8px] text-slate-300 font-bold">{d}</div>; })}
              {cells.map(function (day, i) {
                if (!day) return <div key={i} className="aspect-square" />;
                const dateStr = year + "-" + pad(m) + "-" + pad(day);
                const dots = dotsByDate[dateStr] || [];
                const isT = day === today.getDate() && m === today.getMonth() + 1 && year === today.getFullYear();
                return (
                  <button key={i} onClick={function () { props.onPickMonth(m, day); }}
                    className={"aspect-square flex flex-col items-center justify-center rounded text-[9px] leading-none " +
                      (isT ? "bg-blue-600 text-white font-bold" : dots.length ? "bg-slate-50 text-slate-600 font-semibold hover:bg-slate-100" : "text-slate-400 hover:bg-slate-50")}>
                    <span>{day}</span>
                    {dots.length > 0 && (
                      <span className="flex gap-px mt-px">
                        {dots.map(function (c, j) { return <span key={j} className={"w-1 h-1 rounded-full " + (isT ? "bg-white" : c)} />; })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── A single event row (sidebar) ─────────────────────────────────────────────
function EventRow(props: { e: CalEvent; todayISO: string; withDate: boolean }) {
  const { e, todayISO, withDate } = props;
  const t = EVENT_TYPES[e.type];
  const d = daysBetween(todayISO, e.date);
  const countdown = d === 0 ? "היום" : d === 1 ? "מחר" : d > 0 ? "עוד " + d + " ימים" : "לפני " + Math.abs(d) + " ימים";
  const urgent = d >= 0 && d <= 7;
  return (
    <div className="px-4 py-2.5 flex gap-2 items-start">
      <div className={"w-2 h-2 rounded-full mt-1.5 shrink-0 " + t.dot} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={"text-[10px] px-1.5 py-0.5 rounded border " + t.chip}>{t.label}</span>
          {withDate && <span className="text-[11px] text-slate-400">{new Date(e.date).toLocaleDateString("he-IL", { day: "numeric", month: "short" })}</span>}
          <span className={"text-[10px] font-bold " + (urgent ? "text-red-600" : "text-slate-400")}>{countdown}</span>
        </div>
        <div className="text-xs font-medium text-slate-700 truncate mt-0.5">{e.label}</div>
      </div>
    </div>
  );
}

// ── Subscribe (ICS feed) modal ───────────────────────────────────────────────
function SubscribeModal(props: { feedUrl: string; propFilter: string; propName?: string; onClose: () => void }) {
  const [scopeChoice, setScopeChoice] = useState<"all" | "prop">(props.propFilter ? "prop" : "all");
  const [copied, setCopied] = useState(false);
  // When a property is selected, offer either the full feed or a property-only
  // feed (?property=<id>) — validated server-side against the user's scope.
  const url = (scopeChoice === "prop" && props.propFilter) ? (props.feedUrl + "&property=" + props.propFilter) : props.feedUrl;
  const webcal = url.replace(/^https?:\/\//, "webcal://");
  function copy() { if (url) { navigator.clipboard.writeText(url); setCopied(true); setTimeout(function () { setCopied(false); }, 2000); } }
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; (props.onClose)(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" dir="rtl" onClick={function (e) { e.stopPropagation(); }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-black text-slate-800">🔗 סנכרון יומן ל-Google / Outlook</h2>
          <button onClick={props.onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>
        <p className="text-sm text-slate-500 mb-4 leading-relaxed">
          הירשם לכתובת הזו ביומן שלך — האירועים (סיומי חוזה, ערבויות, ביטוחים, בדיקות בטיחות, אופציות והתראות) יופיעו אוטומטית, וההתראות ינוהלו ע"י היומן האישי שלך. הקישור אישי וסודי, ומציג רק נכסים שמורשים לך — אל תשתף אותו.
        </p>
        {props.propFilter && props.propName && (
          <div className="flex gap-1.5 mb-3">
            <button onClick={function () { setScopeChoice("all"); }} className={"rounded-lg border px-3 py-1.5 text-xs font-semibold " + (scopeChoice === "all" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>כל הנכסים שלי</button>
            <button onClick={function () { setScopeChoice("prop"); }} className={"rounded-lg border px-3 py-1.5 text-xs font-semibold " + (scopeChoice === "prop" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>רק: {props.propName}</button>
          </div>
        )}
        {!props.feedUrl ? (
          <div className="text-sm text-slate-400">טוען קישור...</div>
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              <input readOnly value={url} className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 bg-slate-50" />
              <button onClick={copy} className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-bold hover:bg-blue-700 shrink-0">{copied ? "✓ הועתק" : "העתק"}</button>
            </div>
            <div className="space-y-2 text-sm">
              <a href={webcal} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">📅 <span className="font-semibold text-slate-700">הוסף ל-Apple / Outlook</span><span className="text-xs text-slate-400">(webcal)</span></a>
              <a href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">🟢 <span className="font-semibold text-slate-700">הוסף ל-Google Calendar</span><span className="text-xs text-slate-400">(הדבק את הקישור)</span></a>
            </div>
            <div className="mt-4 text-[11px] text-slate-400 leading-relaxed bg-slate-50 rounded-lg p-3">
              ב-Google: הגדרות → "הוספת יומן" → "מכתובת URL" → הדבק את הקישור. היומן מתעדכן אוטומטית מעת לעת (Google בודק כל כמה שעות).
            </div>
          </>
        )}
      </div>
    </div>
  );
}
