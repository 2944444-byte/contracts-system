"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function DashboardPage() {
  const router = useRouter();
  const [data,    setData]    = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [
      { data: contracts },
      { data: alerts },
      { data: properties },
      { data: guarantees },
    ] = await Promise.all([
      supabase.from("contracts")
        .select("id, status, end_date, rent_per_sqm, charged_area, investment_addition, tenants(name), properties(name)")
        .in("status", ["active","expiring","extended","upcoming"]),
      supabase.from("alerts")
        .select("id, title, severity, status, created_at")
        .eq("status", "open").order("created_at", { ascending: false }).limit(8),
      supabase.from("properties")
        .select("id, name, spaces(id,status)"),
      supabase.from("guarantees")
        .select("id, status, end_date, amount_actual")
        .eq("status", "active"),
    ]);

    const active   = (contracts ?? []).filter(function(c) { return ["active","expiring","extended"].includes(c.status); });
    const expiring = active.filter(function(c) { return c.end_date && daysLeft(c.end_date) <= 90; });
    const revenue  = active.reduce(function(s: number, c: any) {
      return s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
    }, 0);

    const allSpaces   = (properties ?? []).flatMap(function(p: any) { return p.spaces ?? []; });
    const occupied    = allSpaces.filter(function(s: any) { return s.status === "rented"; }).length;
    const occupancyPct= allSpaces.length > 0 ? Math.round(occupied / allSpaces.length * 100) : 0;

    const guaranteeTotal = (guarantees ?? []).reduce(function(s: number, g: any) { return s + (g.amount_actual ?? 0); }, 0);
    const guaranteeExp   = (guarantees ?? []).filter(function(g: any) { return g.end_date && daysLeft(g.end_date) <= 60; }).length;

    setData({
      contracts: contracts ?? [], active, expiring, revenue,
      alerts: alerts ?? [],
      properties: properties ?? [], allSpaces, occupied, occupancyPct,
      guarantees: guarantees ?? [], guaranteeTotal, guaranteeExp,
    });
    setLoading(false);
  }

  if (loading) {
    return (
      <div dir="rtl" className="space-y-4">
        <div className="h-8 bg-slate-100 rounded-xl w-48 animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(function(i) {
            return <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />;
          })}
        </div>
      </div>
    );
  }

  const kpis = [
    { label: "הכנסה חודשית",    value: "₪" + Math.round(data.revenue).toLocaleString(), sub: "מחוזים פעילים",           bg: "bg-green-50",  border: "border-green-100", color: "text-green-700"  },
    { label: "חוזים פעילים",    value: data.active?.length,                              sub: data.expiring?.length + " פגים ב-90 יום", bg: "bg-blue-50",   border: "border-blue-100",  color: "text-blue-700"   },
    { label: "תפוסה",           value: data.occupancyPct + "%",                          sub: data.occupied + "/" + data.allSpaces?.length + " יחידות", bg: "bg-purple-50", border: "border-purple-100",color: "text-purple-700" },
    { label: "התראות פתוחות",   value: data.alerts?.length,                              sub: "דורשות טיפול",            bg: data.alerts?.length > 0 ? "bg-red-50" : "bg-slate-50", border: data.alerts?.length > 0 ? "border-red-100" : "border-slate-200", color: data.alerts?.length > 0 ? "text-red-700" : "text-slate-600" },
  ];

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">דשבורד</h1>
        <p className="text-slate-500 text-sm mt-1">סקירת מצב עדכנית</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map(function(k) {
          return (
            <div key={k.label} className={"rounded-xl border p-4 " + k.bg + " " + k.border}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-sm font-semibold mt-0.5 " + k.color}>{k.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{k.sub}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* חוזים פוגים */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="font-semibold text-slate-700">⏰ חוזים פוגים בקרוב</span>
            <button onClick={function() { router.push("/contracts"); }}
              className="text-xs text-blue-600 hover:underline">כל החוזים →</button>
          </div>
          {data.expiring?.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">אין חוזים פוגים ב-90 יום ✅</div>
          ) : (
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs border-b">
                <tr>
                  <th className="px-4 py-2.5">שוכר</th>
                  <th className="px-4 py-2.5">נכס</th>
                  <th className="px-4 py-2.5">סיום</th>
                  <th className="px-4 py-2.5">ימים</th>
                </tr>
              </thead>
              <tbody>
                {data.expiring?.map(function(c: any) {
                  const d = daysLeft(c.end_date);
                  return (
                    <tr key={c.id} className={"border-t border-slate-100 " + (d <= 30 ? "bg-red-50" : d <= 60 ? "bg-yellow-50" : "hover:bg-slate-50")}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{c.tenants?.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{c.properties?.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{fmtDate(c.end_date)}</td>
                      <td className="px-4 py-2.5">
                        <span className={"font-bold text-sm " + (d <= 30 ? "text-red-600" : d <= 60 ? "text-yellow-600" : "text-slate-600")}>
                          {d}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* התראות */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="font-semibold text-slate-700">🔔 התראות</span>
            <button onClick={function() { router.push("/alerts"); }}
              className="text-xs text-blue-600 hover:underline">הכל →</button>
          </div>
          {data.alerts?.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">אין התראות פתוחות ✅</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.alerts?.map(function(a: any) {
                const colors: Record<string, string> = {
                  urgent:   "bg-red-100 text-red-700",
                  warning:  "bg-yellow-100 text-yellow-700",
                  info:     "bg-blue-100 text-blue-700",
                };
                return (
                  <div key={a.id} className="px-4 py-3 flex items-start gap-2">
                    <span className={"text-xs px-1.5 py-0.5 rounded-full font-semibold shrink-0 mt-0.5 " + (colors[a.severity] ?? colors.info)}>
                      {a.severity === "urgent" ? "דחוף" : a.severity === "warning" ? "אזהרה" : "מידע"}
                    </span>
                    <span className="text-sm text-slate-700 leading-snug">{a.title}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* נכסים — תפוסה */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="font-semibold text-slate-700">🏢 תפוסה לפי נכס</span>
            <button onClick={function() { router.push("/properties"); }}
              className="text-xs text-blue-600 hover:underline">כל הנכסים →</button>
          </div>
          <div className="p-4 space-y-3">
            {data.properties?.slice(0, 6).map(function(p: any) {
              const spaces   = p.spaces ?? [];
              const occupied = spaces.filter(function(s: any) { return s.status === "rented"; }).length;
              const pct      = spaces.length > 0 ? Math.round(occupied / spaces.length * 100) : 0;
              return (
                <div key={p.id}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium text-slate-700">{p.name}</span>
                    <span className={"text-xs font-bold " + (pct >= 80 ? "text-green-700" : pct >= 50 ? "text-yellow-600" : "text-red-500")}>
                      {occupied}/{spaces.length} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={"h-full rounded-full " + (pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400")}
                      style={{ width: pct + "%" }} />
                  </div>
                </div>
              );
            })}
            {data.properties?.length === 0 && (
              <div className="py-4 text-center text-slate-400 text-sm">אין נכסים במערכת</div>
            )}
          </div>
        </div>

        {/* ערבויות */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="font-semibold text-slate-700 mb-3 flex items-center justify-between">
            <span>🏦 ערבויות</span>
            <button onClick={function() { router.push("/guarantees"); }}
              className="text-xs text-blue-600 hover:underline">הכל →</button>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xl font-black text-slate-800">₪{Math.round(data.guaranteeTotal ?? 0).toLocaleString()}</div>
              <div className="text-xs text-slate-500">סה"כ בערבות</div>
            </div>
            <div className={"rounded-xl p-3 " + (data.guaranteeExp > 0 ? "bg-yellow-50" : "bg-green-50")}>
              <div className={"text-xl font-black " + (data.guaranteeExp > 0 ? "text-yellow-700" : "text-green-700")}>
                {data.guaranteeExp ?? 0}
              </div>
              <div className="text-xs text-slate-500">פגות ב-60 יום</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xl font-black text-slate-800">{data.guarantees?.length ?? 0}</div>
              <div className="text-xs text-slate-500">ערבויות פעילות</div>
            </div>
          </div>
        </div>

      {/* פעולות מהירות */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <div className="font-semibold text-slate-700 mb-3">⚡ פעולות מהירות</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: "חוזה חדש",   href: "/contracts/new", icon: "📄", color: "bg-blue-600 hover:bg-blue-700"   },
            { label: "שוכר חדש",   href: "/tenants",       icon: "👤", color: "bg-green-600 hover:bg-green-700" },
            { label: "חיוב חדש",   href: "/payments",      icon: "₪",  color: "bg-purple-600 hover:bg-purple-700"},
            { label: "דוח מחזור",  href: "/revenue",       icon: "📊", color: "bg-orange-600 hover:bg-orange-700"},
          ].map(function(a) {
            return (
              <button key={a.href} onClick={function() { router.push(a.href); }}
                className={"rounded-xl py-3 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors " + a.color}>
                <span>{a.icon}</span>
                <span>{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      </div>
    </div>
  );
}
