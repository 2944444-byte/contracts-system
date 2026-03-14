"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function formatDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function daysLeft(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - new Date().getTime()) / (1000*60*60*24));
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalRevenue: 0, activeContracts: 0, expiringContracts: 0,
    totalProperties: 0, occupancyPct: 0, totalArea: 0, rentedArea: 0,
  });
  const [expiringContracts, setExpiringContracts]   = useState<any[]>([]);
  const [pendingOptions, setPendingOptions]         = useState<any[]>([]);
  const [unreadAlerts, setUnreadAlerts]             = useState<any[]>([]);
  const [recentContracts, setRecentContracts]       = useState<any[]>([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const today = new Date(); today.setHours(0,0,0,0);
    const in90  = new Date(today); in90.setDate(in90.getDate() + 90);
    const in90s = in90.toISOString().split("T")[0];

    // חוזים
    const { data: contracts } = await supabase
      .from("contracts")
      .select("*, tenants(name), properties(name, total_rentable_area)");

    // נכסים
    const { data: properties } = await supabase
      .from("properties")
      .select("id, total_rentable_area");

    // אופציות ממתינות עם מועד הודעה קרוב
    const { data: options } = await supabase
      .from("contract_options")
      .select("*, contracts(tenant_id, property_id, tenants(name), properties(name))")
      .eq("status", "pending")
      .not("notice_deadline", "is", null)
      .lte("notice_deadline", in90s)
      .order("notice_deadline");

    // התראות פתוחות
    const { data: alerts } = await supabase
      .from("alerts")
      .select("*")
      .eq("is_handled", false)
      .order("due_date", { ascending: true })
      .limit(5);

    const now = new Date();
    const allContracts = contracts ?? [];

    // חישוב סטטיסטיקות
    const active = allContracts.filter((c: any) => {
      const s = new Date(c.start_date), e = new Date(c.end_date);
      return now >= s && now <= e;
    });
    const expiring = active.filter((c: any) => daysLeft(c.end_date) <= 90);
    const totalRev = active.reduce((s: number, c: any) =>
      s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0), 0);
    const totalArea = (properties ?? []).reduce((s: number, p: any) =>
      s + (p.total_rentable_area ?? 0), 0);
    const rentedArea = active.reduce((s: number, c: any) => s + (c.charged_area ?? 0), 0);

    setStats({
      totalRevenue:      totalRev,
      activeContracts:   active.length,
      expiringContracts: expiring.length,
      totalProperties:   (properties ?? []).length,
      occupancyPct:      totalArea > 0 ? Math.round((rentedArea / totalArea) * 100) : 0,
      totalArea,
      rentedArea,
    });

    setExpiringContracts(expiring.sort((a: any, b: any) =>
      new Date(a.end_date).getTime() - new Date(b.end_date).getTime()).slice(0, 5));
    setPendingOptions((options ?? []).slice(0, 5));
    setUnreadAlerts((alerts ?? []).slice(0, 5));
    setRecentContracts(allContracts
      .sort((a: any, b: any) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
      .slice(0, 5));
    setLoading(false);
  }

  if (loading) return (
    <div dir="rtl" className="flex items-center justify-center py-20 text-slate-400">
      <div className="text-center">
        <div className="text-4xl mb-3">⏳</div>
        <div>טוען נתונים...</div>
      </div>
    </div>
  );

  return (
    <div dir="rtl" className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">דשבורד</h1>
        <p className="text-sm text-slate-500 mt-1">סקירה כללית של המערכת</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">הכנסה חודשית</div>
          <div className="text-2xl font-bold text-slate-900">₪{stats.totalRevenue.toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">שנתי: ₪{(stats.totalRevenue * 12).toLocaleString()}</div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">חוזים פעילים</div>
          <div className="text-2xl font-bold text-green-700">{stats.activeContracts}</div>
          {stats.expiringContracts > 0 && (
            <div className="text-xs text-yellow-600 mt-1">⚠️ {stats.expiringContracts} פגים ב-90 יום</div>
          )}
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">תפוסה</div>
          <div className="text-2xl font-bold text-slate-900">{stats.occupancyPct}%</div>
          <div className="mt-2 bg-slate-100 rounded-full h-1.5">
            <div className={`h-1.5 rounded-full transition-all ${stats.occupancyPct >= 80 ? "bg-green-500" : stats.occupancyPct >= 50 ? "bg-yellow-500" : "bg-red-400"}`}
              style={{ width: `${stats.occupancyPct}%` }} />
          </div>
          <div className="text-xs text-slate-400 mt-1">{stats.rentedArea.toLocaleString()} / {stats.totalArea.toLocaleString()} מ"ר</div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">נכסים</div>
          <div className="text-2xl font-bold text-blue-700">{stats.totalProperties}</div>
          <div className="text-xs text-slate-400 mt-1">{stats.totalArea.toLocaleString()} מ"ר סה"כ</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* חוזים פגים בקרוב */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-800">⏰ חוזים פגים בקרוב</h2>
            <button onClick={() => router.push("/contracts")}
              className="text-xs text-blue-600 hover:underline">כל החוזים ←</button>
          </div>
          {expiringContracts.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">אין חוזים פגים ב-90 הימים הקרובים ✓</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {expiringContracts.map((c: any) => {
                const days = daysLeft(c.end_date);
                return (
                  <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                    onClick={() => router.push("/contracts")}>
                    <div>
                      <div className="font-medium text-slate-800 text-sm">{c.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{c.properties?.name} | סיום: {formatDate(c.end_date)}</div>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${days <= 30 ? "bg-red-100 text-red-700" : days <= 60 ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {days} ימים
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* אופציות ממתינות */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-800">📋 מועדי הודעת אופציה</h2>
            <button onClick={() => router.push("/contracts")}
              className="text-xs text-blue-600 hover:underline">לחוזים ←</button>
          </div>
          {pendingOptions.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">אין מועדי הודעה קרובים ✓</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {pendingOptions.map((o: any) => {
                const days = daysLeft(o.notice_deadline);
                return (
                  <div key={o.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
                    <div>
                      <div className="font-medium text-slate-800 text-sm">
                        {o.contracts?.tenants?.name} — אופציה {o.option_number}
                      </div>
                      <div className="text-xs text-slate-400">
                        {o.contracts?.properties?.name} | מועד הודעה: {formatDate(o.notice_deadline)}
                      </div>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${days <= 0 ? "bg-red-100 text-red-700" : days <= 30 ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {days < 0 ? `עבר לפני ${Math.abs(days)}י` : `${days} ימים`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* התראות פתוחות */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-800">🔔 התראות פתוחות</h2>
            <button onClick={() => router.push("/alerts")}
              className="text-xs text-blue-600 hover:underline">כל ההתראות ←</button>
          </div>
          {unreadAlerts.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">אין התראות פתוחות ✓</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {unreadAlerts.map((a: any) => (
                <div key={a.id} className="px-5 py-3 flex items-start gap-3 hover:bg-slate-50">
                  <span className={`mt-0.5 text-sm ${a.severity === "critical" ? "text-red-500" : a.severity === "high" ? "text-orange-500" : "text-yellow-500"}`}>
                    {a.severity === "critical" ? "🔴" : a.severity === "high" ? "🟠" : "🟡"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 text-sm truncate">{a.title}</div>
                    {a.message && <div className="text-xs text-slate-400 truncate">{a.message}</div>}
                    {a.due_date && <div className="text-xs text-slate-400">{formatDate(a.due_date)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* פעולות מהירות */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-800">⚡ פעולות מהירות</h2>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { label: "+ חוזה חדש",    icon: "📄", path: "/contracts/new",  color: "bg-blue-700 text-white hover:bg-blue-800" },
              { label: "חוזים",          icon: "📋", path: "/contracts",       color: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
              { label: "שוכרים",         icon: "👥", path: "/tenants",         color: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
              { label: "נכסים",          icon: "🏢", path: "/properties",      color: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
              { label: "מדד המחירים",    icon: "📈", path: "/cpi",             color: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
              { label: "חישוב הצמדה",   icon: "🔢", path: "/indexation",      color: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
              { label: "התראות",         icon: "🔔", path: "/alerts",          color: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
              { label: "דוחות",          icon: "📊", path: "/reports",         color: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
            ].map(item => (
              <button key={item.path} onClick={() => router.push(item.path)}
                className={`rounded-xl p-3 text-sm font-semibold text-right flex items-center gap-2 transition-colors ${item.color}`}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
