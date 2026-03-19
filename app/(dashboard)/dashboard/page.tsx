"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';

function fmtMoney(n: number) { return "₪" + Math.round(n ?? 0).toLocaleString(); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

export default function DashboardPage() {
  const router  = useRouter();
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({
    activeContracts: 0, expiringContracts: 0, pendingPayments: 0,
    openAlerts: 0, urgentAlerts: 0, monthlyRevenue: 0,
    occupancyRate: 0, totalSpaces: 0, occupiedSpaces: 0,
    guaranteeGaps: 0, overduePayments: 0, totalProperties: 0,
  });
  const [expiring,   setExpiring]   = useState<any[]>([]);
  const [urgAlerts,  setUrgAlerts]  = useState<any[]>([]);
  const [recentPay,  setRecentPay]  = useState<any[]>([]);

  const today = new Date().toLocaleDateString("he-IL", {
    weekday:"long", year:"numeric", month:"long", day:"numeric"
  });

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [
      { count: active },
      { count: expiring90 },
      { count: pending },
      { count: alerts },
      { data: contracts },
      { data: spaces },
      { data: charges },
      { data: expiringList },
      { data: urgentAlerts },
      { data: guarantees },
      { data: properties },
    ] = await Promise.all([
      supabase.from("contracts").select("id",{count:"exact",head:true}).eq("status","active"),
      supabase.from("contracts").select("id",{count:"exact",head:true}).eq("status","expiring"),
      supabase.from("contracts").select("id",{count:"exact",head:true}).eq("status","expiring"),
      supabase.from("alerts").select("id",{count:"exact",head:true}).eq("is_resolved",false),
      supabase.from("contracts").select("rent_per_sqm,charged_area,investment_addition").in("status",["active","expiring","extended"]),
      supabase.from("spaces").select("id,status"),
      supabase.from("contracts").select("id,end_date,status").eq("status","expiring"),
      supabase.from("contracts").select("id,end_date,status,tenants(name),properties(name),rent_per_sqm,charged_area,investment_addition").in("status",["active","expiring"]).order("end_date").limit(5),
      supabase.from("alerts").select("id,title,severity,due_date,entity_type").eq("is_resolved",false).in("severity",["urgent","warning"]).order("severity").order("due_date").limit(6),
      supabase.from("guarantees").select("amount_required,amount_actual").eq("status","active"),
      supabase.from("properties").select("id",{count:"exact",head:true}),
    ]);

    const monthly = (contracts??[]).reduce(function(s,c){return s+(c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);},0);
    const total   = (spaces??[]).length;
    const occ     = (spaces??[]).filter(function(s){return s.status==="occupied";}).length;
    const overdue = (charges??[]).filter(function(c){return c.due_date&&new Date(c.due_date)<new Date();}).length;
    const gaps    = (guarantees??[]).filter(function(g){return (g.amount_actual??0)<(g.amount_required??0);}).length;

    setKpi({
      activeContracts:  active??0, expiringContracts: expiring90??0,
      pendingPayments:  pending??0, openAlerts: alerts??0,
      urgentAlerts:     (urgentAlerts??[]).filter(function(a){return a.severity==="urgent";}).length,
      monthlyRevenue:   monthly, occupancyRate: total>0?Math.round(occ/total*100):0,
      totalSpaces: total, occupiedSpaces: occ,
      guaranteeGaps: gaps, overduePayments: overdue,
      totalProperties: 0,
    });
    setExpiring(expiringList??[]);
    setUrgAlerts(urgentAlerts??[]);
    setLoading(false);
  }

  const QUICK = [
    {label:"חוזה חדש",  href:"/contracts/new", icon:"📄", bg:"bg-blue-600"    },
    {label:"חיוב חדש",  href:"/payments",       icon:"💳", bg:"bg-purple-600"  },
    {label:"ערבות",     href:"/guarantees",     icon:"🏦", bg:"bg-emerald-600" },
    {label:"התראות",    href:"/alerts",         icon:"🔔", bg:kpi.urgentAlerts>0?"bg-red-500":"bg-orange-500"},
    {label:"דוחות",     href:"/reports",        icon:"📋", bg:"bg-slate-600"   },
    {label:"הגדרות",    href:"/settings",       icon:"⚙️", bg:"bg-slate-500"   },
  ];

  const LINKS = [
    {label:"Timeline",  href:"/timeline",  icon:"📊"},
    {label:"תזרים",    href:"/cashflow",  icon:"💹"},
    {label:"מדד CBS",  href:"/indexation",icon:"📈"},
    {label:"לוח שנה",  href:"/calendar",  icon:"📅"},
  ];

  return (
    <div dir="rtl">
      <div className="mb-5">
        <h1 className="text-3xl font-bold text-slate-800">דשבורד</h1>
        <p className="text-sm text-slate-400 mt-1">{today}</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[1,2,3,4].map(function(i){return <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse"/>;})}
        </div>
      ) : (
        <>
          {/* Row 1 — 4 KPI ראשיים */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {[
              {label:"הכנסה חודשית",    value:fmtMoney(kpi.monthlyRevenue), sub:"חוזים פעילים",         icon:"💰", color:"text-emerald-700", bg:"bg-emerald-50",  border:"border-emerald-100", href:"/cashflow"},
              {label:"תפוסה",           value:kpi.occupancyRate+"%",         sub:kpi.occupiedSpaces+"/"+kpi.totalSpaces+" יחידות", icon:"🏢", color:"text-blue-700",    bg:"bg-blue-50",     border:"border-blue-100",    href:"/units"},
              {label:"חוזים פעילים",   value:String(kpi.activeContracts),   sub:kpi.expiringContracts+" פוגים",     icon:"📄", color:"text-slate-800",  bg:"bg-white",       border:"border-slate-200",   href:"/contracts"},
              {label:"התראות פתוחות",  value:String(kpi.openAlerts),        sub:kpi.urgentAlerts+" דחופות",         icon:"🔔", color:kpi.openAlerts>0?"text-red-700":"text-slate-400", bg:kpi.openAlerts>0?"bg-red-50":"bg-white", border:kpi.openAlerts>0?"border-red-100":"border-slate-200", href:"/alerts"},
            ].map(function(k) {
              return (
                <button key={k.label} onClick={function(){router.push(k.href);}}
                  className={"rounded-2xl border p-4 text-right hover:shadow-md transition-all " + k.bg + " " + k.border}>
                  <div className="flex items-start justify-between">
                    <span className="text-2xl">{k.icon}</span>
                    <div className={"text-2xl font-black " + k.color}>{k.value}</div>
                  </div>
                  <div className="text-xs font-semibold text-slate-600 mt-1">{k.label}</div>
                  <div className="text-xs text-slate-400">{k.sub}</div>
                </button>
              );
            })}
          </div>

          {/* Row 2 — 4 KPI משניים */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              {label:"ממתינים לאישור",  value:String(kpi.pendingPayments),  color:"text-blue-700",   bg:"bg-blue-50",   href:"/payments"},
              {label:"חיובים באיחור",   value:String(kpi.overduePayments),  color:kpi.overduePayments>0?"text-red-700":"text-slate-400",  bg:kpi.overduePayments>0?"bg-red-50":"bg-white",   href:"/payments"},
              {label:"פוגים ב-90 יום",  value:String(kpi.expiringContracts),color:kpi.expiringContracts>0?"text-yellow-700":"text-slate-400",bg:kpi.expiringContracts>0?"bg-yellow-50":"bg-white", href:"/reports"},
              {label:"ערבויות עם פער",  value:String(kpi.guaranteeGaps),   color:kpi.guaranteeGaps>0?"text-orange-700":"text-slate-400",  bg:kpi.guaranteeGaps>0?"bg-orange-50":"bg-white",  href:"/guarantees"},
            ].map(function(k) {
              return (
                <button key={k.label} onClick={function(){router.push(k.href);}}
                  className={"rounded-xl border border-slate-200 p-3 text-right hover:shadow-sm transition-all " + k.bg}>
                  <div className={"text-xl font-black " + k.color}>{k.value}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
                </button>
              );
            })}
          </div>

          {/* Row 3 — 3 פאנלים */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* פעולות מהירות */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="font-bold text-slate-700 text-sm mb-3">⚡ פעולות מהירות</div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {QUICK.map(function(q) {
                  return (
                    <button key={q.href} onClick={function(){router.push(q.href);}}
                      className={"rounded-xl py-2.5 text-white text-xs font-semibold flex flex-col items-center gap-1 transition-opacity hover:opacity-90 " + q.bg}>
                      <span className="text-lg">{q.icon}</span><span>{q.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-slate-100 pt-3 grid grid-cols-4 gap-1.5">
                {LINKS.map(function(l) {
                  return (
                    <button key={l.href} onClick={function(){router.push(l.href);}}
                      className="rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 flex flex-col items-center gap-0.5">
                      <span>{l.icon}</span><span className="text-center leading-tight">{l.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* חוזים פוגים */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-700 text-sm">⏳ פוגים בקרוב</span>
                <button onClick={function(){router.push("/contracts");}} className="text-xs text-blue-600 hover:underline">הכל →</button>
              </div>
              {expiring.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">אין חוזים פוגים ✓</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {expiring.map(function(c) {
                    const mon  = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
                    const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : null;
                    return (
                      <div key={c.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer" onClick={function(){router.push("/contracts");}}>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 text-sm truncate">{c.tenants?.name}</div>
                          <div className="text-xs text-slate-400 truncate">{c.properties?.name}</div>
                        </div>
                        <div className="text-left shrink-0 mr-2">
                          <div className={"text-sm font-black " + (days!==null&&days<=30?"text-red-600":days!==null&&days<=60?"text-yellow-600":"text-slate-500")}>
                            {days!==null ? days+"י" : "—"}
                          </div>
                          <div className="text-xs text-green-600">{fmtMoney(mon)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* התראות */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-700 text-sm">🔔 התראות פעילות</span>
                <button onClick={function(){router.push("/alerts");}} className="text-xs text-blue-600 hover:underline">הכל →</button>
              </div>
              {urgAlerts.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">אין התראות דחופות 🎉</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {urgAlerts.map(function(a) {
                    return (
                      <div key={a.id} className={"px-4 py-3 flex items-start gap-2 cursor-pointer hover:bg-slate-50 " + (a.severity==="urgent"?"bg-red-50/50":"")} onClick={function(){router.push("/alerts");}}>
                        <div className={"w-2 h-2 rounded-full mt-1.5 shrink-0 " + (a.severity==="urgent"?"bg-red-500":"bg-yellow-400")} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{a.title}</div>
                          {a.due_date && <div className="text-xs text-slate-400">{fmtDate(a.due_date)}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
