"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function fmtMoney(n: number) { return "₪" + Math.round(n ?? 0).toLocaleString(); }
function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    activeContracts: 0, expiringContracts: 0, pendingPayments: 0,
    openAlerts: 0, monthlyRevenue: 0, occupancyRate: 0,
    totalSpaces: 0, occupiedSpaces: 0, totalProperties: 0,
    guaranteeGaps: 0, overduePayments: 0,
  });
  const [expiring,   setExpiring]   = useState<any[]>([]);
  const [recentPay,  setRecentPay]  = useState<any[]>([]);
  const [urgAlerts,  setUrgAlerts]  = useState<any[]>([]);
  const today = new Date().toLocaleDateString("he-IL", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const now = new Date().toISOString();
    const in90 = new Date(Date.now()+90*86400000).toISOString().split("T")[0];

    const [
      { count: active },
      { count: expiring90 },
      { count: pending },
      { count: alerts },
      { data: contracts },
      { data: spaces },
      { data: charges },
      { data: expiringList },
      { data: recentCharges },
      { data: urgentAlerts },
      { data: guarantees },
    ] = await Promise.all([
      supabase.from("contracts").select("id",{count:"exact",head:true}).eq("status","active"),
      supabase.from("contracts").select("id",{count:"exact",head:true}).in("status",["expiring"]),
      supabase.from("charges").select("id",{count:"exact",head:true}).eq("status","pending"),
      supabase.from("alerts").select("id",{count:"exact",head:true}).eq("status","open"),
      supabase.from("contracts").select("rent_per_sqm,charged_area,investment_addition").in("status",["active","expiring","extended"]),
      supabase.from("spaces").select("id,status"),
      supabase.from("charges").select("id,due_date,status").eq("status","pending"),
      supabase.from("contracts").select("id,end_date,status,tenants(name),properties(name),rent_per_sqm,charged_area,investment_addition").in("status",["active","expiring"]).order("end_date").limit(5),
      supabase.from("charges").select("id,total_amount,status,billing_period_start,contracts(tenants(name),properties(name))").in("status",["pending","approved"]).order("created_at",{ascending:false}).limit(5),
      supabase.from("alerts").select("id,title,severity,due_date").eq("status","open").eq("severity","urgent").order("due_date").limit(4),
      supabase.from("guarantees").select("amount_required,amount_actual").eq("status","active"),
    ]);

    const monthly = (contracts ?? []).reduce(function(s,c) { return s+(c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0); },0);
    const total   = (spaces ?? []).length;
    const occ     = (spaces ?? []).filter(function(s) { return s.status==="occupied"; }).length;
    const overdueCount = (charges ?? []).filter(function(c) { return c.due_date && new Date(c.due_date) < new Date(); }).length;
    const gapCount = (guarantees ?? []).filter(function(g) { return (g.amount_actual??0) < (g.amount_required??0); }).length;

    setData({
      activeContracts:  active ?? 0,
      expiringContracts:expiring90 ?? 0,
      pendingPayments:  pending ?? 0,
      openAlerts:       alerts ?? 0,
      monthlyRevenue:   monthly,
      occupancyRate:    total > 0 ? Math.round(occ/total*100) : 0,
      totalSpaces:      total,
      occupiedSpaces:   occ,
      totalProperties:  0,
      guaranteeGaps:    gapCount,
      overduePayments:  overdueCount,
    });
    setExpiring(expiringList ?? []);
    setRecentPay(recentCharges ?? []);
    setUrgAlerts(urgentAlerts ?? []);
    setLoading(false);
  }

  const QUICK = [
    { label:"חוזה חדש",  href:"/contracts/new", icon:"📄", color:"bg-blue-600 hover:bg-blue-700"    },
    { label:"שוכר חדש",  href:"/tenants",        icon:"👤", color:"bg-emerald-600 hover:bg-emerald-700"},
    { label:"חיוב חדש",  href:"/payments",       icon:"₪",  color:"bg-purple-600 hover:bg-purple-700" },
    { label:"התראות",    href:"/alerts",         icon:"🔔", color:"bg-orange-500 hover:bg-orange-600"  },
  ];

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">דשבורד</h1>
        <p className="text-sm text-slate-400 mt-1">{today}</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1,2,3,4].map(function(i) { return <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />; })}
        </div>
      ) : (
        <>
          {/* KPI Row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {[
              { label:"הכנסה חודשית", value:fmtMoney(data.monthlyRevenue), sub:"חוזים פעילים", color:"text-emerald-700", bg:"bg-emerald-50", border:"border-emerald-200", icon:"💰", href:"/cashflow" },
              { label:"תפוסה",         value:data.occupancyRate+"%",        sub:data.occupiedSpaces+"/"+data.totalSpaces+" יח'", color:"text-blue-700", bg:"bg-blue-50", border:"border-blue-200", icon:"🏢", href:"/units" },
              { label:"חוזים פעילים", value:String(data.activeContracts),  sub:data.expiringContracts+" פוגים", color:"text-slate-800", bg:"bg-white", border:"border-slate-200", icon:"📄", href:"/contracts" },
              { label:"התראות פתוחות",value:String(data.openAlerts),       sub:urgAlerts.length+" דחופות", color:data.openAlerts>0?"text-red-700":"text-slate-500", bg:data.openAlerts>0?"bg-red-50":"bg-white", border:data.openAlerts>0?"border-red-200":"border-slate-200", icon:"🔔", href:"/alerts" },
            ].map(function(k) {
              return (
                <button key={k.label} onClick={function(){router.push(k.href);}}
                  className={"rounded-2xl border p-4 text-right hover:shadow-md transition-all " + k.bg + " " + k.border}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">{k.icon}</span>
                    <div className={"text-2xl font-black " + k.color}>{k.value}</div>
                  </div>
                  <div className="text-xs font-semibold text-slate-600">{k.label}</div>
                  <div className="text-xs text-slate-400">{k.sub}</div>
                </button>
              );
            })}
          </div>

          {/* KPI Row 2 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label:"ממתינים לאישור", value:String(data.pendingPayments), color:"text-blue-700", bg:"bg-blue-50", href:"/payments" },
              { label:"חיובים באיחור",  value:String(data.overduePayments), color:data.overduePayments>0?"text-red-700":"text-slate-400", bg:data.overduePayments>0?"bg-red-50":"bg-white", href:"/payments" },
              { label:"פוגים ב-90 יום", value:String(data.expiringContracts), color:data.expiringContracts>0?"text-yellow-700":"text-slate-400", bg:data.expiringContracts>0?"bg-yellow-50":"bg-white", href:"/reports" },
              { label:"ערבויות עם פער", value:String(data.guaranteeGaps),   color:data.guaranteeGaps>0?"text-orange-700":"text-slate-400", bg:data.guaranteeGaps>0?"bg-orange-50":"bg-white", href:"/guarantees" },
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* פעולות מהירות */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
              <div className="font-bold text-slate-700 mb-3 text-sm">⚡ פעולות מהירות</div>
              <div className="grid grid-cols-2 gap-2">
                {QUICK.map(function(q) {
                  return (
                    <button key={q.href} onClick={function(){router.push(q.href);}}
                      className={"rounded-xl py-3 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors " + q.color}>
                      <span>{q.icon}</span><span>{q.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2">
                {[{label:"Timeline",href:"/timeline",icon:"📊"},{label:"תזרים",href:"/cashflow",icon:"💹"},{label:"דוחות",href:"/reports",icon:"📋"}].map(function(b) {
                  return (
                    <button key={b.href} onClick={function(){router.push(b.href);}}
                      className="rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 flex flex-col items-center gap-0.5">
                      <span>{b.icon}</span><span>{b.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* חוזים פוגים */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-700 text-sm">⏳ חוזים פוגים</span>
                <button onClick={function(){router.push("/contracts");}} className="text-xs text-blue-600 hover:underline">כל החוזים →</button>
              </div>
              {expiring.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">אין חוזים פוגים בקרוב</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {expiring.map(function(c) {
                    const mon  = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
                    const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : null;
                    return (
                      <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer" onClick={function(){router.push("/contracts");}}>
                        <div>
                          <div className="font-semibold text-slate-800 text-sm">{c.tenants?.name}</div>
                          <div className="text-xs text-slate-400">{c.properties?.name}</div>
                        </div>
                        <div className="text-left">
                          <div className={"text-sm font-bold " + (days!==null&&days<=30?"text-red-600":days!==null&&days<=60?"text-yellow-600":"text-slate-600")}>
                            {days !== null ? days+"י" : "—"}
                          </div>
                          <div className="text-xs text-green-600">{fmtMoney(mon)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* התראות דחופות */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-700 text-sm">🔔 התראות דחופות</span>
                <button onClick={function(){router.push("/alerts");}} className="text-xs text-blue-600 hover:underline">כל ההתראות →</button>
              </div>
              {urgAlerts.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">אין התראות דחופות 🎉</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {urgAlerts.map(function(a) {
                    return (
                      <div key={a.id} className="px-5 py-3 flex items-start gap-3 hover:bg-red-50 cursor-pointer" onClick={function(){router.push("/alerts");}}>
                        <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                        <div>
                          <div className="font-semibold text-slate-800 text-sm">{a.title}</div>
                          {a.due_date && <div className="text-xs text-red-600">עד: {fmtDate(a.due_date)}</div>}
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
