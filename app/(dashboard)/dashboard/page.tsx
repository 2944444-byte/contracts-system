"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>({
    contracts: [], alerts: [], properties: [], charges: [],
    guarantees: [], safety: [], insurances: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [
      { data: contracts },
      { data: alerts },
      { data: properties },
      { data: charges },
      { data: guarantees },
      { data: safety },
      { data: insurances },
    ] = await Promise.all([
      supabase.from("contracts")
        .select("id, status, end_date, tenants(name), properties(name), charged_area, rent_per_sqm, investment_addition, contract_options(status)")
        .in("status", ["active","expiring","extended"]),
      supabase.from("alerts")
        .select("*").eq("is_handled", false).order("created_at", { ascending: false }).limit(8),
      supabase.from("properties")
        .select("id, name, total_rentable_area, units(id, status), spaces(id, status)"),
      supabase.from("charges")
        .select("id, status, total_amount, charge_type, contracts(tenants(name), properties(name))")
        .in("status", ["pending","approved"]).limit(10),
      supabase.from("guarantees")
        .select("id, end_date, guarantee_type, amount_actual, contracts(tenants(name))")
        .eq("status", "active"),
      supabase.from("safety_inspections")
        .select("id, inspection_type, next_inspection_date, properties(name)"),
      supabase.from("insurances_tenant")
        .select("id, end_date, contracts(tenants(name))"),
    ]);

    setData({
      contracts:  contracts  ?? [],
      alerts:     alerts     ?? [],
      properties: properties ?? [],
      charges:    charges    ?? [],
      guarantees: guarantees ?? [],
      safety:     safety     ?? [],
      insurances: insurances ?? [],
    });
    setLoading(false);
  }

  // חישובים
  const totalRevenue = data.contracts.reduce(function(s: number, c: any) {
    return s + ((c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0));
  }, 0);

  const expiringContracts = data.contracts.filter(function(c: any) {
    const d = daysLeft(c.end_date);
    return d >= 0 && d <= 90;
  });

  const pendingCharges = data.charges.filter(function(c: any) { return c.status === "pending"; });
  const approvedCharges = data.charges.filter(function(c: any) { return c.status === "approved"; });

  const expiringGuarantees = data.guarantees.filter(function(g: any) {
    const d = daysLeft(g.end_date);
    return d >= 0 && d <= 60;
  });

  const urgentSafety = data.safety.filter(function(s: any) {
    return daysLeft(s.next_inspection_date) <= 30;
  });

  const expiringInsurances = data.insurances.filter(function(i: any) {
    const d = daysLeft(i.end_date);
    return d >= 0 && d <= 60;
  });

  const totalUnits = data.properties.reduce(function(s: number, p: any) {
    return s + (p.spaces?.length || p.units?.length || 0);
  }, 0);
  const occupiedUnits = data.properties.reduce(function(s: number, p: any) {
    const items = p.spaces?.length ? p.spaces : p.units ?? [];
    return s + items.filter(function(u: any) { return u.status === "rented"; }).length;
  }, 0);
  const occupancyPct = totalUnits > 0 ? Math.round(occupiedUnits / totalUnits * 100) : 0;

  if (loading) {
    return (
      <div dir="rtl" className="flex items-center justify-center py-24">
        <div className="text-slate-400 text-center">
          <div className="text-4xl mb-3 animate-spin">⟳</div>
          <div>טוען דשבורד...</div>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">דשבורד</h1>
        <p className="text-sm text-slate-500 mt-1">{new Date().toLocaleDateString("he-IL", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}</p>
      </div>

      {/* KPI ראשיים */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-green-100 bg-green-50 p-4 shadow-sm">
          <div className="text-xs text-green-600 font-semibold mb-1">הכנסה חודשית</div>
          <div className="text-2xl font-black text-green-800">₪{Math.round(totalRevenue).toLocaleString()}</div>
          <div className="text-xs text-green-500 mt-1">{data.contracts.length} חוזים פעילים</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm cursor-pointer hover:bg-blue-100"
          onClick={function() { router.push("/contracts"); }}>
          <div className="text-xs text-blue-600 font-semibold mb-1">תפוסה</div>
          <div className="text-2xl font-black text-blue-800">{occupancyPct}%</div>
          <div className="text-xs text-blue-500 mt-1">{occupiedUnits}/{totalUnits} יחידות</div>
        </div>
        <div className={"rounded-xl border p-4 shadow-sm cursor-pointer " +
          (pendingCharges.length > 0 ? "border-yellow-100 bg-yellow-50 hover:bg-yellow-100" : "border-slate-100 bg-white hover:bg-slate-50")}
          onClick={function() { router.push("/payments"); }}>
          <div className="text-xs text-yellow-700 font-semibold mb-1">ממתינים לאישור</div>
          <div className={"text-2xl font-black " + (pendingCharges.length > 0 ? "text-yellow-800" : "text-slate-400")}>
            {pendingCharges.length}
          </div>
          <div className="text-xs text-yellow-600 mt-1">חיובים לאישור</div>
        </div>
        <div className={"rounded-xl border p-4 shadow-sm cursor-pointer " +
          (data.alerts.length > 0 ? "border-red-100 bg-red-50 hover:bg-red-100" : "border-slate-100 bg-white hover:bg-slate-50")}
          onClick={function() { router.push("/alerts"); }}>
          <div className="text-xs text-red-600 font-semibold mb-1">התראות פתוחות</div>
          <div className={"text-2xl font-black " + (data.alerts.length > 0 ? "text-red-800" : "text-slate-400")}>
            {data.alerts.length}
          </div>
          <div className="text-xs text-red-500 mt-1">דורשות טיפול</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* טור שמאל */}
        <div className="lg:col-span-2 space-y-5">

          {/* חוזים פגים בקרוב */}
          {expiringContracts.length > 0 && (
            <div className="rounded-xl border border-orange-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-orange-50 border-b border-orange-100 flex items-center justify-between">
                <span className="text-sm font-bold text-orange-800">⏰ חוזים פגים ב-90 יום ({expiringContracts.length})</span>
                <button onClick={function() { router.push("/contracts"); }}
                  className="text-xs text-orange-600 hover:underline">כל החוזים ←</button>
              </div>
              <div className="divide-y divide-slate-100">
                {expiringContracts.slice(0,5).map(function(c: any) {
                  const d = daysLeft(c.end_date);
                  const hasOption = c.contract_options?.some(function(o: any) { return o.status === "pending"; });
                  return (
                    <div key={c.id} onClick={function() { router.push("/contracts"); }}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 cursor-pointer">
                      <div className={"w-10 h-10 rounded-full flex items-center justify-center text-xs font-black shrink-0 " +
                        (d <= 30 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700")}>
                        {d}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 text-sm truncate">{c.tenants?.name}</div>
                        <div className="text-xs text-slate-400">{c.properties?.name} | סיום: {fmtDate(c.end_date)}</div>
                      </div>
                      {hasOption && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold shrink-0">
                          יש אופציה
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* חיובים ממתינים */}
          {pendingCharges.length > 0 && (
            <div className="rounded-xl border border-yellow-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-yellow-50 border-b border-yellow-100 flex items-center justify-between">
                <span className="text-sm font-bold text-yellow-800">💰 חיובים ממתינים לאישור ({pendingCharges.length})</span>
                <button onClick={function() { router.push("/payments"); }}
                  className="text-xs text-yellow-600 hover:underline">לאישור ←</button>
              </div>
              <div className="divide-y divide-slate-100">
                {pendingCharges.slice(0,4).map(function(c: any) {
                  return (
                    <div key={c.id} onClick={function() { router.push("/payments"); }}
                      className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 cursor-pointer">
                      <div>
                        <div className="font-semibold text-slate-800 text-sm">{c.contracts?.tenants?.name}</div>
                        <div className="text-xs text-slate-400">{c.contracts?.properties?.name}</div>
                      </div>
                      <span className="font-bold text-slate-800">₪{(c.total_amount ?? 0).toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* נכסים — תפוסה */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-700">🏢 תפוסת נכסים</span>
              <button onClick={function() { router.push("/properties"); }}
                className="text-xs text-blue-600 hover:underline">כל הנכסים ←</button>
            </div>
            <div className="divide-y divide-slate-100">
              {data.properties.slice(0,5).map(function(p: any) {
                const items = p.spaces?.length ? p.spaces : p.units ?? [];
                const total    = items.length;
                const occupied = items.filter(function(u: any) { return u.status === "rented"; }).length;
                const pct      = total > 0 ? Math.round(occupied / total * 100) : 0;
                return (
                  <div key={p.id} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-slate-700">{p.name}</span>
                      <span className={"text-xs font-bold " + (pct >= 80 ? "text-green-600" : pct >= 50 ? "text-yellow-600" : "text-red-600")}>
                        {pct}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div className={"h-1.5 rounded-full " + (pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400")}
                        style={{ width: pct + "%" }} />
                    </div>
                    <div className="text-xs text-slate-400 mt-1">{occupied}/{total} יחידות</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* טור ימין */}
        <div className="space-y-4">

          {/* התראות */}
          {data.alerts.length > 0 && (
            <div className="rounded-xl border border-red-100 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center justify-between">
                <span className="text-xs font-bold text-red-700">🔔 התראות ({data.alerts.length})</span>
                <button onClick={function() { router.push("/alerts"); }}
                  className="text-xs text-red-600 hover:underline">כולן ←</button>
              </div>
              <div className="divide-y divide-slate-100">
                {data.alerts.slice(0,4).map(function(a: any) {
                  const isHigh = a.priority === "high" || a.priority === "critical";
                  return (
                    <div key={a.id} className="px-4 py-2.5">
                      <div className={"text-xs font-semibold " + (isHigh ? "text-red-700" : "text-slate-700")}>
                        {isHigh ? "🔴" : "🟡"} {a.title}
                      </div>
                      {a.message && <div className="text-xs text-slate-400 mt-0.5 truncate">{a.message}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ערבויות פוגות */}
          {expiringGuarantees.length > 0 && (
            <div className="rounded-xl border border-yellow-100 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-yellow-50 border-b border-yellow-100 flex items-center justify-between">
                <span className="text-xs font-bold text-yellow-700">🏦 ערבויות פוגות ({expiringGuarantees.length})</span>
                <button onClick={function() { router.push("/guarantees"); }}
                  className="text-xs text-yellow-600 hover:underline">כולן ←</button>
              </div>
              <div className="divide-y divide-slate-100">
                {expiringGuarantees.slice(0,3).map(function(g: any) {
                  const d = daysLeft(g.end_date);
                  return (
                    <div key={g.id} className="px-4 py-2.5 flex justify-between items-center">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">{g.contracts?.tenants?.name}</div>
                        <div className="text-xs text-slate-400">{fmtDate(g.end_date)}</div>
                      </div>
                      <span className={"text-xs font-bold px-2 py-0.5 rounded-full " +
                        (d <= 30 ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>
                        {d} יום
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* בדיקות בטיחות דחופות */}
          {urgentSafety.length > 0 && (
            <div className="rounded-xl border border-orange-100 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-orange-50 border-b border-orange-100 flex items-center justify-between">
                <span className="text-xs font-bold text-orange-700">🔒 בטיחות דחוף ({urgentSafety.length})</span>
                <button onClick={function() { router.push("/safety"); }}
                  className="text-xs text-orange-600 hover:underline">כולן ←</button>
              </div>
              <div className="divide-y divide-slate-100">
                {urgentSafety.slice(0,3).map(function(s: any) {
                  return (
                    <div key={s.id} className="px-4 py-2.5 flex justify-between items-center">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">{s.properties?.name}</div>
                        <div className="text-xs text-slate-400">{s.inspection_type}</div>
                      </div>
                      <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                        {daysLeft(s.next_inspection_date)} יום
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ביטוחי שוכרים פוגים */}
          {expiringInsurances.length > 0 && (
            <div className="rounded-xl border border-blue-100 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
                <span className="text-xs font-bold text-blue-700">🛡️ ביטוחים פוגים ({expiringInsurances.length})</span>
                <button onClick={function() { router.push("/insurances"); }}
                  className="text-xs text-blue-600 hover:underline">כולן ←</button>
              </div>
              <div className="divide-y divide-slate-100">
                {expiringInsurances.slice(0,3).map(function(i: any) {
                  return (
                    <div key={i.id} className="px-4 py-2.5 flex justify-between items-center">
                      <div className="text-xs font-semibold text-slate-800">
                        {i.contracts?.tenants?.name}
                      </div>
                      <span className="text-xs text-slate-400">{fmtDate(i.end_date)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* קישורי מהירות */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <div className="text-xs font-bold text-slate-500 mb-3">⚡ פעולות מהירות</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: "/contracts/new", label: "חוזה חדש",    icon: "📄" },
                { href: "/payments",     label: "חיוב חדש",    icon: "₪"  },
                { href: "/letters",      label: "הפק מכתב",    icon: "✉"  },
                { href: "/reports",      label: "דוחות",        icon: "📊" },
              ].map(function(item) {
                return (
                  <button key={item.href}
                    onClick={function() { router.push(item.href); }}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-all">
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
