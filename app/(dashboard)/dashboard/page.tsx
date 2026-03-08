
"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function DashboardPage() {
  const [properties, setProperties] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: props }, { data: unitData }, { data: contractData }] = await Promise.all([
        supabase.from("properties").select("id, name, address"),
        supabase.from("units").select("id, name, area, status, property_id, properties(name)"),
        supabase.from("contracts").select("id, status, rent_per_sqm, charged_area, investment_addition, start_date, end_date, tenant_id, tenants(name), properties(name)"),
      ]);
      setProperties(props ?? []);
      setUnits(unitData ?? []);
      setContracts(contractData ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const activeContracts = contracts.filter(c => c.status === "active");
  const expiringContracts = contracts.filter(c => c.status === "expiring");
  const upcomingContracts = contracts.filter(c => c.status === "upcoming");

  const totalMonthlyRevenue = activeContracts.reduce((sum, c) => {
    const rent = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
    return sum + rent;
  }, 0);

  const occupiedUnits = units.filter(u => u.status === "occupied");
  const vacantUnits = units.filter(u => u.status === "vacant");
  const totalArea = units.reduce((s, u) => s + (u.area ?? 0), 0);
  const occupiedArea = occupiedUnits.reduce((s, u) => s + (u.area ?? 0), 0);
  const occupancyPct = totalArea > 0 ? Math.round(occupiedArea / totalArea * 100) : 0;

  const alerts = [
    ...expiringContracts.map(c => ({
      id: c.id, severity: "critical",
      title: "חוזה עומד לפוג",
      desc: `חוזה עם ${c.tenants?.name ?? ""} בנכס ${c.properties?.name ?? ""}`
    })),
    ...upcomingContracts.map(c => ({
      id: c.id + "_u", severity: "info",
      title: "חוזה עתידי מתחיל בקרוב",
      desc: `חוזה עם ${c.tenants?.name ?? ""} מתחיל ${c.start_date}`
    })),
  ];

  const propertiesWithStats = properties.map(p => {
    const pUnits = units.filter(u => u.property_id === p.id);
    const pOccupied = pUnits.filter(u => u.status === "occupied");
    const pArea = pUnits.reduce((s, u) => s + (u.area ?? 0), 0);
    const pOccArea = pOccupied.reduce((s, u) => s + (u.area ?? 0), 0);
    const pct = pArea > 0 ? Math.round(pOccArea / pArea * 100) : 0;
    return { ...p, totalUnits: pUnits.length, occupiedUnits: pOccupied.length, totalArea: pArea, occupiedArea: pOccArea, pct };
  });

  if (loading) return <div dir="rtl" className="p-8 text-slate-400">טוען...</div>;

  return (
    <div dir="rtl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800">דשבורד</h1>
        <p className="mt-1 text-slate-500">סקירת מצב עדכנית</p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-blue-700">
          <div className="text-2xl font-bold">₪{totalMonthlyRevenue.toLocaleString()}</div>
          <div className="text-sm font-medium">הכנסות חודשיות</div>
          <div className="mt-1 text-xs opacity-70">מחוזים פעילים</div>
        </div>
        <div className="rounded-xl border border-green-100 bg-green-50 p-4 text-green-700">
          <div className="text-2xl font-bold">{activeContracts.length}</div>
          <div className="text-sm font-medium">חוזים פעילים</div>
          <div className="mt-1 text-xs opacity-70">{expiringContracts.length} עומדים לפוג</div>
        </div>
        <div className="rounded-xl border border-purple-100 bg-purple-50 p-4 text-purple-700">
          <div className="text-2xl font-bold">{occupancyPct}%</div>
          <div className="text-sm font-medium">תפוסה לפי שטח</div>
          <div className="mt-1 text-xs opacity-70">{occupiedArea.toLocaleString()} / {totalArea.toLocaleString()} מ"ר</div>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-red-700">
          <div className="text-2xl font-bold">{alerts.length}</div>
          <div className="text-sm font-medium">התראות פתוחות</div>
          <div className="mt-1 text-xs opacity-70">דורשות טיפול</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">סטטוס נכסים</h2>
          {propertiesWithStats.map(p => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800">{p.name}</div>
                  <div className="text-xs text-slate-400">{p.address}</div>
                </div>
                <div className="text-sm"><span className="font-bold text-blue-600">{p.pct}%</span> <span className="text-slate-400">תפוסה</span></div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${p.pct >= 80 ? "bg-green-500" : p.pct >= 50 ? "bg-yellow-400" : "bg-red-400"}`} style={{ width: `${p.pct}%` }} />
              </div>
              <div className="mt-2 flex gap-4 text-xs text-slate-500">
                <span>{p.occupiedUnits}/{p.totalUnits} יחידות</span>
                <span>{p.occupiedArea.toLocaleString()} / {p.totalArea.toLocaleString()} מ"ר</span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">התראות</h2>
            <div className="space-y-2">
              {alerts.length === 0 && <div className="text-sm text-slate-400">אין התראות</div>}
              {alerts.map(a => (
                <div key={a.id} className={`rounded-xl border p-3 ${a.severity === "critical" ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50"}`}>
                  <div className="text-sm font-semibold text-slate-800">{a.title}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{a.desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">יחידות פנויות ({vacantUnits.length})</h2>
            <div className="space-y-1">
              {vacantUnits.map(u => (
                <div key={u.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-700">{u.name}</span>
                  <span className="text-xs text-slate-400">{(u.properties as any)?.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
