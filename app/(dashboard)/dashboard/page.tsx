"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { fetchCpiAdjusted, fetchHighestChainedCpi } from '@/lib/cpi-server';
import { getKnownIndexMonth } from '@/lib/cpi-utils';
import CalcProgress, { CalcProgressState } from '@/components/CalcProgress';

function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

// Calculate base monthly rent for a contract (handles per-unit pricing)
function calcContractRent(c: any): number {
  var total = 0;
  if (c.contract_spaces?.length > 0) {
    c.contract_spaces.forEach(function(cs: any) {
      if (cs.charge_method === "fixed" && cs.fixed_rent) total += Number(cs.fixed_rent);
      else total += (Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0) * (cs.spaces?.area || 0);
    });
  }
  if (total === 0) total = (Number(c.rent_per_sqm) || 0) * (Number(c.charged_area) || 0);
  return total + (Number(c.investment_addition) || 0);
}

export default function DashboardPage() {
  const router  = useRouter();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<any[]>([]);
  const [propGroups, setPropGroups] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [guarantees, setGuarantees] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [unsentLetters, setUnsentLetters] = useState<any[]>([]);
  const [cpiRatios, setCpiRatios] = useState<Record<string, number>>({});
  const [cpiProgress, setCpiProgress] = useState<CalcProgressState | null>(null);

  // Filters
  const [filterGroup, setFilterGroup] = useState("all");
  const [filterProp,  setFilterProp]  = useState("all");

  const today = new Date().toLocaleDateString("he-IL", {
    weekday:"long", year:"numeric", month:"long", day:"numeric"
  });

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: pg }, { data: p }, { data: c }, { data: sp }, { data: gu }, { data: al }] = await Promise.all([
      supabase.from("property_groups").select("id,group_name").order("group_name"),
      supabase.from("properties").select("id,name,group_id,city,total_area,property_type"),
      supabase.from("contracts").select("id,status,rent_per_sqm,charged_area,investment_addition,property_id,end_date,start_date,index_base_date,indexation_method,index_mechanism,is_amendment,tenants(name),properties(name),contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))").in("status",["active","extended","expiring"]),
      supabase.from("spaces").select("id,property_id,status,space_name,area"),
      supabase.from("guarantees").select("id,contract_id,amount_required,amount_actual,end_date,guarantee_type").eq("status","active"),
      supabase.from("alerts").select("id,title,severity,due_date,entity_type,contract_id").eq("is_resolved",false).order("severity").order("due_date").limit(20),
    ]);

    setPropGroups(pg ?? []);
    setProperties(p ?? []);
    setContracts((c ?? []).filter(function(c:any){return !c.is_amendment;}));
    setSpaces(sp ?? []);
    setGuarantees(gu ?? []);
    setAlerts(al ?? []);

    // Letters waiting to be sent (draft + ready) — surfaced as a banner.
    const { data: ul } = await supabase.from("letters")
      .select("id,title,status,billing_type,contracts(tenants(name))")
      .in("status", ["draft", "ready"]).order("created_at", { ascending: false });
    setUnsentLetters(ul ?? []);

    // Compute per-contract CPI ratios.
    // Group contracts by (base date + mechanism) to dedupe CBS calls — but
    // each contract still receives its own ratio based on its own base date
    // and indexation method. For highest_in_period / no_drop contracts, scan
    // the chained peak via CBS calculator. Standard contracts use a single
    // base→today call.
    try {
      var validContracts = (c ?? []).filter(function(x: any) {
        return !x.is_amendment && x.index_base_date
          && x.indexation_method && x.indexation_method !== "none";
      });

      var toCbsDate = function(d: string): string {
        var dt = new Date(d); if (dt.getDate() === 15) dt.setDate(16);
        var mm = String(dt.getMonth()+1).padStart(2,"0");
        var dd = String(dt.getDate()).padStart(2,"0");
        return mm + "-" + dd + "-" + dt.getFullYear();
      };
      var now = new Date();
      var todayCbs = String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0")+"-"+now.getFullYear();
      var nowKnown = getKnownIndexMonth(now);

      var groupMap: Record<string, { contractIds: string[]; fromDate: string; rawBase: string; isHighest: boolean }> = {};
      validContracts.forEach(function(x: any) {
        var fromDate = toCbsDate(x.index_base_date);
        var isHighest = x.indexation_method === "highest_in_period" || x.indexation_method === "no_drop"
          || x.index_mechanism === "highest_in_period" || x.index_mechanism === "no_drop";
        var key = fromDate + "|" + (isHighest ? "H" : "S");
        if (!groupMap[key]) groupMap[key] = { contractIds: [], fromDate: fromDate, rawBase: x.index_base_date, isHighest: isHighest };
        groupMap[key].contractIds.push(x.id);
      });

      var calcStart = Date.now();
      var groupKeys = Object.keys(groupMap);
      var totalGroups = groupKeys.length;
      setCpiProgress({ current: 0, total: totalGroups, label: "מחשב יחס מדד לכל החוזים...", startedAt: calcStart });

      // Process groups sequentially to update progress; each group is one
      // base-date × mechanism pair (peak scan can be ~30 CBS calls).
      var groupResults: any[] = [];
      for (var gi = 0; gi < groupKeys.length; gi++) {
        var k = groupKeys[gi];
        var g = groupMap[k];
        setCpiProgress({
          current: gi + 1,
          total: totalGroups,
          label: g.isHighest ? "סורק שיא מדד..." : "מביא יחס מדד...",
          startedAt: calcStart,
        });
        try {
          var groupRatio = 1;
          if (g.isHighest) {
            var baseDateObj = new Date(g.rawBase);
            var peak = await fetchHighestChainedCpi({
              baseFromDate: g.fromDate,
              scanFromYear: baseDateObj.getFullYear(),
              scanFromMonth: baseDateObj.getMonth() + 1,
              scanToYear: nowKnown.year,
              scanToMonth: nowKnown.month,
            });
            if (peak.success && peak.peakRatio) {
              groupResults.push({ key: k, ratio: peak.peakRatio });
              continue;
            }
          }
          var data: any = await fetchCpiAdjusted({ value: 10000, fromDate: g.fromDate, toDate: todayCbs });
          groupRatio = (data && data.success) ? (Number(data.adjustedRentPerSqm) || 10000) / 10000 : 1;
          groupResults.push({ key: k, ratio: groupRatio });
        } catch { groupResults.push({ key: k, ratio: 1 }); }
      }

      var ratioMap: Record<string, number> = {};
      groupResults.forEach(function(r: any) {
        var g = groupMap[r.key];
        if (!g) return;
        g.contractIds.forEach(function(cid: string) { ratioMap[cid] = r.ratio; });
      });
      setCpiRatios(ratioMap);
    } catch(e) { /* keep ratios empty */ }
    setCpiProgress(null);
    setLoading(false);
  }

  // ─── Apply filters (group → property) ───
  var filteredProps = properties;
  if (filterGroup !== "all") filteredProps = filteredProps.filter(function(p){return p.group_id===filterGroup;});
  if (filterProp !== "all") filteredProps = filteredProps.filter(function(p){return p.id===filterProp;});
  const filteredPropIds = filteredProps.map(function(p){return p.id;});

  const filteredContracts = contracts.filter(function(c){return filteredPropIds.includes(c.property_id);});
  const filteredSpaces = spaces.filter(function(s){return filteredPropIds.includes(s.property_id);});
  const filteredGuarantees = guarantees.filter(function(g){
    return filteredContracts.some(function(c){return c.id===g.contract_id;});
  });

  // ─── Calculations ───
  // Base revenue: sum of contract base rents (no CPI applied).
  // Indexed revenue: sum of (base × ratio) per contract — each contract gets
  // its own ratio based on its own base date and indexation method.
  const baseRevenue = filteredContracts.reduce(function(s,c){return s+calcContractRent(c);},0);
  const indexedRevenue = filteredContracts.reduce(function(s,c){
    var r = cpiRatios[c.id] || 1;
    return s + calcContractRent(c) * r;
  },0);

  const totalArea = filteredSpaces.reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
  const occupiedArea = filteredSpaces.filter(function(s){return s.status==="occupied";}).reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
  const occupancyPct = totalArea > 0 ? Math.round(occupiedArea/totalArea*100) : 0;

  const vacantSpaces = filteredSpaces.filter(function(s){return s.status==="vacant";});
  const vacantArea = vacantSpaces.reduce(function(s,sp){return s+(Number(sp.area)||0);},0);
  const occupiedSpaces = filteredSpaces.filter(function(s){return s.status==="occupied";});

  // Expiring contracts in next 12 months (by date, not status)
  const oneYearMs = 365*24*60*60*1000;
  const expiringSoon = filteredContracts.filter(function(c){
    if (!c.end_date) return false;
    var diff = new Date(c.end_date).getTime() - Date.now();
    return diff > 0 && diff <= oneYearMs;
  }).sort(function(a,b){return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();});

  // Expiring in next 90 days (for warning counter)
  const expiring90 = expiringSoon.filter(function(c){
    var days = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / 86400000);
    return days <= 90;
  });

  // Guarantee analysis
  const totalGuarantees = filteredGuarantees.reduce(function(s,g){return s+(Number(g.amount_required)||0);},0);
  const guaranteeGaps = filteredGuarantees.filter(function(g){return (Number(g.amount_actual)||0) < (Number(g.amount_required)||0);});
  const expiringGuarantees = filteredGuarantees.filter(function(g){
    if (!g.end_date) return false;
    var diff = new Date(g.end_date).getTime() - Date.now();
    return diff > 0 && diff <= oneYearMs;
  });

  // Alerts
  const urgentAlerts = alerts.filter(function(a){return a.severity==="urgent" || a.severity==="high";});

  // Available properties for dropdown based on group filter
  const propOptions = filterGroup === "all" ? properties : properties.filter(function(p){return p.group_id===filterGroup;});

  const QUICK = [
    {label:"חוזה חדש",  href:"/contracts/new", icon:"📄", bg:"bg-blue-600"    },
    {label:"חיוב חדש",  href:"/payments",       icon:"💳", bg:"bg-purple-600"  },
    {label:"ערבות",     href:"/guarantees",     icon:"🏦", bg:"bg-emerald-600" },
    {label:"התראות",    href:"/alerts",         icon:"🔔", bg:urgentAlerts.length>0?"bg-red-500":"bg-orange-500"},
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
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">דשבורד</h1>
          <p className="text-sm text-slate-400 mt-1">{today}</p>
        </div>
        {/* Filters */}
        <div className="flex gap-2 items-center">
          <span className="text-xs text-slate-500">סינון:</span>
          <select value={filterGroup} onChange={function(e){setFilterGroup(e.target.value); setFilterProp("all");}}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
            <option value="all">📁 כל הקבוצות</option>
            {propGroups.map(function(g){return <option key={g.id} value={g.id}>{g.group_name}</option>;})}
          </select>
          <select value={filterProp} onChange={function(e){setFilterProp(e.target.value);}}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
            <option value="all">🏢 כל הנכסים</option>
            {propOptions.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
          </select>
          {(filterGroup !== "all" || filterProp !== "all") && (
            <button onClick={function(){setFilterGroup("all"); setFilterProp("all");}}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200">✕ נקה</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[1,2,3,4].map(function(i){return <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse"/>;})}
        </div>
      ) : (
        <>
          {unsentLetters.length > 0 && (() => {
            var guarCount = unsentLetters.filter(function(l:any){ return l.billing_type === "guarantee"; }).length;
            return (
              <button onClick={function(){router.push("/letters");}}
                className="w-full mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3.5 text-right hover:bg-amber-100 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">✉️</span>
                  <div>
                    <div className="font-bold text-amber-800">{unsentLetters.length} מכתבים ממתינים לשליחה</div>
                    <div className="text-xs text-amber-700">
                      {guarCount > 0 ? "כולל " + guarCount + " מכתבי חידוש ערבות · " : ""}לחץ למסך המכתבים לבדיקה ושליחה
                    </div>
                  </div>
                </div>
                <span className="text-amber-600 font-bold text-sm whitespace-nowrap">למכתבים →</span>
              </button>
            );
          })()}
          {cpiProgress && (
            <div className="mb-3">
              <CalcProgress {...cpiProgress} />
            </div>
          )}
          {/* Row 1 — main KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <button onClick={function(){router.push("/cashflow");}}
              className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-right hover:shadow-md transition-all">
              <div className="flex items-start justify-between">
                <span className="text-2xl">💰</span>
                <div className="text-xl font-black text-emerald-700">{fmtMoney(indexedRevenue)}</div>
              </div>
              <div className="text-xs font-semibold text-slate-600 mt-1">הכנסה חודשית צמודה</div>
              <div className="text-xs text-slate-500">בסיס: {fmtMoney(baseRevenue)}</div>
            </button>

            <button onClick={function(){router.push("/units");}}
              className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-right hover:shadow-md transition-all">
              <div className="flex items-start justify-between">
                <span className="text-2xl">📐</span>
                <div className="text-2xl font-black text-blue-700">{occupancyPct}%</div>
              </div>
              <div className="text-xs font-semibold text-slate-600 mt-1">תפוסה (לפי מ&quot;ר)</div>
              <div className="text-xs text-slate-500">{occupiedArea.toLocaleString("he-IL")}/{totalArea.toLocaleString("he-IL")} מ&quot;ר</div>
            </button>

            <button onClick={function(){router.push("/contracts");}}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-right hover:shadow-md transition-all">
              <div className="flex items-start justify-between">
                <span className="text-2xl">📄</span>
                <div className="text-2xl font-black text-slate-800">{filteredContracts.length}</div>
              </div>
              <div className="text-xs font-semibold text-slate-600 mt-1">חוזים פעילים</div>
              <div className="text-xs text-slate-500">{expiring90.length} פוגים תוך 90 יום</div>
            </button>

            <button onClick={function(){router.push("/alerts");}}
              className={"rounded-2xl border p-4 text-right hover:shadow-md transition-all " + (urgentAlerts.length>0?"bg-red-50 border-red-100":"bg-white border-slate-200")}>
              <div className="flex items-start justify-between">
                <span className="text-2xl">🔔</span>
                <div className={"text-2xl font-black " + (urgentAlerts.length>0?"text-red-700":"text-slate-400")}>{alerts.length}</div>
              </div>
              <div className="text-xs font-semibold text-slate-600 mt-1">התראות פתוחות</div>
              <div className="text-xs text-slate-500">{urgentAlerts.length} דחופות</div>
            </button>
          </div>

          {/* Row 2 — secondary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <button onClick={function(){router.push("/properties");}}
              className="rounded-xl border border-slate-200 p-3 text-right hover:shadow-sm bg-white">
              <div className="text-xl font-black text-purple-700">{filteredProps.length}</div>
              <div className="text-xs text-slate-500 mt-0.5">נכסים</div>
            </button>
            <button onClick={function(){router.push("/units");}}
              className="rounded-xl border border-slate-200 p-3 text-right hover:shadow-sm bg-white">
              <div className="text-xl font-black text-slate-700">{occupiedSpaces.length}/{filteredSpaces.length}</div>
              <div className="text-xs text-slate-500 mt-0.5">יחידות{vacantSpaces.length > 0 ? " ("+vacantSpaces.length+" פנויות)" : ""}</div>
            </button>
            <button onClick={function(){router.push("/guarantees");}}
              className={"rounded-xl border p-3 text-right hover:shadow-sm " + (guaranteeGaps.length>0?"bg-orange-50 border-orange-100":"bg-white border-slate-200")}>
              <div className={"text-xl font-black " + (guaranteeGaps.length>0?"text-orange-700":"text-slate-700")}>{fmtMoney(totalGuarantees)}</div>
              <div className="text-xs text-slate-500 mt-0.5">ערבויות{guaranteeGaps.length > 0 ? " ("+guaranteeGaps.length+" פערים)" : ""}</div>
            </button>
            <button onClick={function(){router.push("/contracts");}}
              className="rounded-xl border border-slate-200 p-3 text-right hover:shadow-sm bg-white">
              <div className="text-xl font-black text-green-700">{fmtMoney(indexedRevenue * 12)}</div>
              <div className="text-xs text-slate-500 mt-0.5">הכנסה שנתית צמודה</div>
            </button>
          </div>

          {/* Row 3 — panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {/* Quick actions */}
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

            {/* Expiring contracts */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-700 text-sm">⏰ חוזים מסתיימים ({expiringSoon.length})</span>
                <button onClick={function(){router.push("/contracts");}} className="text-xs text-blue-600 hover:underline">הכל →</button>
              </div>
              {expiringSoon.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">אין חוזים מסתיימים השנה ✓</div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                  {expiringSoon.slice(0, 8).map(function(c: any) {
                    const mon  = calcContractRent(c);
                    const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : null;
                    const monthsLeft = days !== null ? Math.floor(days / 30) : null;
                    return (
                      <div key={c.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer" onClick={function(){router.push("/contracts");}}>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-800 text-sm truncate">{c.tenants?.name}</div>
                          <div className="text-xs text-slate-400 truncate">{c.properties?.name}</div>
                        </div>
                        <div className="text-left shrink-0 mr-2">
                          <div className={"text-sm font-black " + (days!==null&&days<=30?"text-red-600":days!==null&&days<=90?"text-orange-600":"text-slate-500")}>
                            {monthsLeft !== null && monthsLeft > 0 ? monthsLeft+" חו'" : days+" י'"}
                          </div>
                          <div className="text-xs text-green-600">{fmtMoney(mon)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Alerts */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-700 text-sm">🔔 התראות ({alerts.length})</span>
                <button onClick={function(){router.push("/alerts");}} className="text-xs text-blue-600 hover:underline">הכל →</button>
              </div>
              {alerts.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">אין התראות פתוחות 🎉</div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                  {alerts.slice(0, 8).map(function(a: any) {
                    return (
                      <div key={a.id} className={"px-4 py-3 flex items-start gap-2 cursor-pointer hover:bg-slate-50 " + (a.severity==="urgent"?"bg-red-50/50":a.severity==="high"?"bg-orange-50/50":"")} onClick={function(){router.push("/alerts");}}>
                        <div className={"w-2 h-2 rounded-full mt-1.5 shrink-0 " + (a.severity==="urgent"?"bg-red-500":a.severity==="high"?"bg-orange-500":"bg-yellow-400")} />
                        <div className="min-w-0 flex-1">
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

          {/* Row 4 — Vacant units list (detailed) */}
          {vacantSpaces.length > 0 && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/30 shadow-sm overflow-hidden mb-4">
              <div className="px-5 py-3 border-b border-blue-200 flex items-center justify-between">
                <span className="font-bold text-blue-800 text-sm">🏠 יחידות פנויות ({vacantSpaces.length})</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-blue-600 font-semibold">{vacantArea.toLocaleString("he-IL")} מ&quot;ר זמין להשכרה</span>
                  <button onClick={function(){router.push("/units");}} className="text-xs text-blue-600 hover:underline">נהל →</button>
                </div>
              </div>
              <div className="divide-y divide-blue-100 max-h-96 overflow-y-auto">
                {vacantSpaces.map(function(sp: any) {
                  const prop = properties.find(function(p: any){return p.id===sp.property_id;});
                  return (
                    <div key={sp.id} className="px-5 py-2.5 flex items-center justify-between hover:bg-blue-50 cursor-pointer"
                      onClick={function(){router.push("/units?propertyId="+sp.property_id);}}>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-blue-500">📍</span>
                        <span className="font-semibold text-slate-700 text-sm">{sp.space_name}</span>
                        {prop && <span className="text-xs text-slate-500 truncate">— {prop.name}{prop.city ? " / " + prop.city : ""}</span>}
                      </div>
                      <span className="text-sm font-bold text-blue-700 shrink-0 mr-2">{sp.area || "—"} מ&quot;ר</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
