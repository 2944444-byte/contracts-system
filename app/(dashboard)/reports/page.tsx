"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const TABS = [
  { key: "occupancy",    label: "תפוסה",       icon: "🏢" },
  { key: "contracts",    label: "חוזים",       icon: "📄" },
  { key: "revenue",      label: "הכנסות",      icon: "₪"  },
  { key: "guarantees",   label: "ערבויות",     icon: "🏦" },
  { key: "insurance",    label: "ביטוחים",     icon: "🛡️" },
  { key: "cashflow",     label: "תזרים צפוי",  icon: "📈" },
];

function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function exportCSV(rows: any[][], filename: string) {
  const bom = "\uFEFF";
  const csv = bom + rows.map(function(r) {
    return r.map(function(v) {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",");
  }).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [tab,        setTab]        = useState("occupancy");
  const [loading,    setLoading]    = useState(false);
  const [properties, setProperties] = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [guarantees, setGuarantees] = useState<any[]>([]);
  const [insurances, setInsurances] = useState<any[]>([]);
  const [charges,    setCharges]    = useState<any[]>([]);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [
      { data: props },
      { data: contracts },
      { data: guar },
      { data: ins },
      { data: ch },
    ] = await Promise.all([
      supabase.from("properties")
        .select("*, spaces(id, status, area, space_type), units(id, status, area)"),
      supabase.from("contracts")
        .select("*, tenants(name), properties(name), contract_options(*)"),
      supabase.from("guarantees")
        .select("*, contracts(tenants(name), properties(name))"),
      supabase.from("insurances_tenant")
        .select("*, contracts(tenants(name), properties(name))"),
      supabase.from("charges")
        .select("*, contracts(tenants(name), properties(name))")
        .eq("status", "paid")
        .order("period_start", { ascending: false })
        .limit(100),
    ]);
    setProperties(props  ?? []);
    setContracts(contracts ?? []);
    setGuarantees(guar   ?? []);
    setInsurances(ins    ?? []);
    setCharges(ch        ?? []);
    setLoading(false);
  }

  // === תפוסה ===
  function renderOccupancy() {
    const rows = properties.map(function(p) {
      const items  = p.spaces?.length ? p.spaces : p.units ?? [];
      const total  = items.length;
      const occ    = items.filter(function(u: any) { return u.status === "rented"; }).length;
      const area   = items.reduce(function(s: number, u: any) { return s + (u.area ?? 0); }, 0);
      const occArea= items.filter(function(u: any) { return u.status === "rented"; })
                          .reduce(function(s: number, u: any) { return s + (u.area ?? 0); }, 0);
      const pct    = total > 0 ? Math.round(occ / total * 100) : 0;
      return { ...p, total, occ, area, occArea, pct };
    });

    const totArea   = rows.reduce(function(s, r) { return s + r.area; }, 0);
    const totOcc    = rows.reduce(function(s, r) { return s + r.occArea; }, 0);
    const avgPct    = totArea > 0 ? Math.round(totOcc / totArea * 100) : 0;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 mb-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className="text-2xl font-black text-slate-800">{avgPct}%</div>
            <div className="text-xs text-slate-400">תפוסה ממוצעת</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className="text-2xl font-black text-slate-800">{totOcc.toLocaleString()}</div>
            <div className="text-xs text-slate-400">מ"ר מושכר</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className="text-2xl font-black text-slate-800">{(totArea - totOcc).toLocaleString()}</div>
            <div className="text-xs text-slate-400">מ"ר פנוי</div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b flex justify-between items-center">
            <span className="text-sm font-bold text-slate-700">פירוט לפי נכס</span>
            <button onClick={function() {
              exportCSV([
                ["נכס","יחידות","מושכרות","פנויות","תפוסה %","שטח כולל","שטח מושכר"],
                ...rows.map(function(r) { return [r.name, r.total, r.occ, r.total-r.occ, r.pct+"%", r.area, r.occArea]; })
              ], "תפוסה.csv");
            }} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">
              ⬇️ Excel
            </button>
          </div>
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs border-b">
              <tr>
                <th className="px-4 py-2.5 font-semibold">נכס</th>
                <th className="px-4 py-2.5 font-semibold">יחידות</th>
                <th className="px-4 py-2.5 font-semibold">מושכרות</th>
                <th className="px-4 py-2.5 font-semibold">פנויות</th>
                <th className="px-4 py-2.5 font-semibold">תפוסה</th>
                <th className="px-4 py-2.5 font-semibold">שטח מ"ר</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(function(r) {
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{r.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.total}</td>
                    <td className="px-4 py-2.5 text-green-700 font-medium">{r.occ}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.total - r.occ}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 min-w-12">
                          <div className={"h-1.5 rounded-full " + (r.pct >= 80 ? "bg-green-500" : r.pct >= 50 ? "bg-yellow-400" : "bg-red-400")}
                            style={{ width: r.pct + "%" }} />
                        </div>
                        <span className={"text-xs font-bold " + (r.pct >= 80 ? "text-green-600" : r.pct >= 50 ? "text-yellow-600" : "text-red-600")}>
                          {r.pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.area.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // === חוזים ===
  function renderContracts() {
    const active   = contracts.filter(function(c) { return ["active","extended","expiring"].includes(c.status); });
    const expiring = contracts.filter(function(c) { return c.end_date && daysLeft(c.end_date) <= 90 && daysLeft(c.end_date) >= 0; });
    const withOpts = contracts.filter(function(c) { return c.contract_options?.length > 0; });

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-green-100 bg-green-50 p-4 text-center shadow-sm">
            <div className="text-2xl font-black text-green-800">{active.length}</div>
            <div className="text-xs text-green-600">חוזים פעילים</div>
          </div>
          <div className="rounded-xl border border-orange-100 bg-orange-50 p-4 text-center shadow-sm">
            <div className="text-2xl font-black text-orange-800">{expiring.length}</div>
            <div className="text-xs text-orange-600">פגים ב-90 יום</div>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-center shadow-sm">
            <div className="text-2xl font-black text-blue-800">{withOpts.length}</div>
            <div className="text-xs text-blue-600">עם אופציות</div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b flex justify-between items-center">
            <span className="text-sm font-bold text-slate-700">כל החוזים הפעילים</span>
            <button onClick={function() {
              exportCSV([
                ["שוכר","נכס","התחלה","סיום","ימים לסיום","שכ\"ד חודשי","סטטוס","אופציות"],
                ...active.map(function(c) {
                  const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                  return [c.tenants?.name, c.properties?.name, fmtDate(c.start_date), fmtDate(c.end_date), daysLeft(c.end_date), monthly, c.status, c.contract_options?.length ?? 0];
                })
              ], "חוזים.csv");
            }} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">
              ⬇️ Excel
            </button>
          </div>
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs border-b">
              <tr>
                <th className="px-4 py-2.5 font-semibold">שוכר</th>
                <th className="px-4 py-2.5 font-semibold">נכס</th>
                <th className="px-4 py-2.5 font-semibold">סיום</th>
                <th className="px-4 py-2.5 font-semibold">ימים</th>
                <th className="px-4 py-2.5 font-semibold">שכ"ד/חודש</th>
                <th className="px-4 py-2.5 font-semibold">אופציות</th>
              </tr>
            </thead>
            <tbody>
              {active.map(function(c) {
                const d       = daysLeft(c.end_date);
                const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                return (
                  <tr key={c.id} className={"border-t border-slate-100 " + (d <= 30 ? "bg-red-50" : d <= 90 ? "bg-yellow-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{c.tenants?.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{c.properties?.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{fmtDate(c.end_date)}</td>
                    <td className="px-4 py-2.5">
                      <span className={"text-xs font-bold px-2 py-0.5 rounded-full " +
                        (d <= 30 ? "bg-red-100 text-red-700" : d <= 90 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700")}>
                        {d}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">₪{Math.round(monthly).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{c.contract_options?.length ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // === הכנסות ===
  function renderRevenue() {
    const active = contracts.filter(function(c) { return ["active","extended","expiring"].includes(c.status); });
    const totalMonthly = active.reduce(function(s, c) {
      return s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
    }, 0);
    const byProperty: Record<string, number> = {};
    active.forEach(function(c) {
      const pn = c.properties?.name ?? "—";
      const m  = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
      byProperty[pn] = (byProperty[pn] ?? 0) + m;
    });

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-green-100 bg-green-50 p-4 text-center shadow-sm">
            <div className="text-xl font-black text-green-800">₪{Math.round(totalMonthly).toLocaleString()}</div>
            <div className="text-xs text-green-600">הכנסה חודשית</div>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-center shadow-sm">
            <div className="text-xl font-black text-blue-800">₪{Math.round(totalMonthly * 12).toLocaleString()}</div>
            <div className="text-xs text-blue-600">הכנסה שנתית</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className="text-xl font-black text-slate-800">{active.length}</div>
            <div className="text-xs text-slate-400">חוזים פעילים</div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b flex justify-between items-center">
            <span className="text-sm font-bold text-slate-700">הכנסות לפי נכס</span>
            <button onClick={function() {
              exportCSV([
                ["נכס","הכנסה חודשית","הכנסה שנתית","אחוז מסה\"כ"],
                ...Object.entries(byProperty).map(function([name, m]) {
                  return [name, Math.round(m), Math.round(m*12), (totalMonthly > 0 ? Math.round(m/totalMonthly*100) : 0) + "%"];
                })
              ], "הכנסות.csv");
            }} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">
              ⬇️ Excel
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {Object.entries(byProperty).sort(function(a, b) { return b[1] - a[1]; }).map(function([name, m]) {
              const pct = totalMonthly > 0 ? Math.round(m / totalMonthly * 100) : 0;
              return (
                <div key={name} className="px-5 py-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-semibold text-slate-800 text-sm">{name}</span>
                    <span className="font-bold text-slate-800">₪{Math.round(m).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-100 rounded-full h-2">
                      <div className="h-2 rounded-full bg-blue-500" style={{ width: pct + "%" }} />
                    </div>
                    <span className="text-xs text-slate-400 w-8">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* פירוט לפי שוכר */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b">
            <span className="text-sm font-bold text-slate-700">פירוט לפי שוכר</span>
          </div>
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs border-b">
              <tr>
                <th className="px-4 py-2.5 font-semibold">שוכר</th>
                <th className="px-4 py-2.5 font-semibold">נכס</th>
                <th className="px-4 py-2.5 font-semibold">שכ"ד למ"ר</th>
                <th className="px-4 py-2.5 font-semibold">שטח</th>
                <th className="px-4 py-2.5 font-semibold">חודשי</th>
                <th className="px-4 py-2.5 font-semibold">שנתי</th>
              </tr>
            </thead>
            <tbody>
              {active.map(function(c) {
                const m = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{c.tenants?.name}</td>
                    <td className="px-4 py-2.5 text-slate-500">{c.properties?.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">₪{c.rent_per_sqm ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500">{c.charged_area ?? "—"} מ"ר</td>
                    <td className="px-4 py-2.5 font-semibold text-green-700">₪{Math.round(m).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-slate-600">₪{Math.round(m * 12).toLocaleString()}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <td colSpan={4} className="px-4 py-3 text-slate-700">סה"כ</td>
                <td className="px-4 py-3 text-green-700">₪{Math.round(totalMonthly).toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-700">₪{Math.round(totalMonthly * 12).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // === ערבויות ===
  function renderGuarantees() {
    const active   = guarantees.filter(function(g) { return g.status === "active"; });
    const expiring = active.filter(function(g) { return daysLeft(g.end_date) <= 60; });
    const expired  = active.filter(function(g) { return daysLeft(g.end_date) < 0; });
    const totalAmt = active.reduce(function(s, g) { return s + (g.amount_actual ?? 0); }, 0);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className="text-2xl font-black text-slate-800">{active.length}</div>
            <div className="text-xs text-slate-400">ערבויות פעילות</div>
          </div>
          <div className="rounded-xl border border-yellow-100 bg-yellow-50 p-4 text-center shadow-sm">
            <div className="text-2xl font-black text-yellow-800">{expiring.length + expired.length}</div>
            <div className="text-xs text-yellow-600">דורשות תשומת לב</div>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-center shadow-sm">
            <div className="text-xl font-black text-blue-800">₪{totalAmt.toLocaleString()}</div>
            <div className="text-xs text-blue-600">סה"כ ערבויות</div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b flex justify-between items-center">
            <span className="text-sm font-bold text-slate-700">כל הערבויות</span>
            <button onClick={function() {
              exportCSV([
                ["שוכר","נכס","סוג","נדרש","בפועל","תוקף עד","ימים לפקיעה"],
                ...guarantees.map(function(g) {
                  return [g.contracts?.tenants?.name, g.contracts?.properties?.name, g.guarantee_type, g.amount_required ?? "", g.amount_actual ?? "", fmtDate(g.end_date), daysLeft(g.end_date)];
                })
              ], "ערבויות.csv");
            }} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">
              ⬇️ Excel
            </button>
          </div>
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs border-b">
              <tr>
                <th className="px-4 py-2.5 font-semibold">שוכר</th>
                <th className="px-4 py-2.5 font-semibold">סוג</th>
                <th className="px-4 py-2.5 font-semibold">נדרש</th>
                <th className="px-4 py-2.5 font-semibold">בפועל</th>
                <th className="px-4 py-2.5 font-semibold">תוקף</th>
                <th className="px-4 py-2.5 font-semibold">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {guarantees.map(function(g) {
                const d   = daysLeft(g.end_date);
                const gap = g.amount_required && g.amount_actual ? g.amount_actual - g.amount_required : null;
                return (
                  <tr key={g.id} className={"border-t border-slate-100 " + (d < 0 ? "bg-red-50" : d <= 60 ? "bg-yellow-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{g.contracts?.tenants?.name}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{g.guarantee_type}</td>
                    <td className="px-4 py-2.5 text-slate-600">{g.amount_required ? "₪" + g.amount_required.toLocaleString() : "—"}</td>
                    <td className="px-4 py-2.5">
                      {g.amount_actual ? <span className="font-semibold">₪{g.amount_actual.toLocaleString()}</span> : "—"}
                      {gap !== null && gap < 0 && <span className="text-xs text-red-600 mr-1">⚠️</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{fmtDate(g.end_date)}</td>
                    <td className="px-4 py-2.5">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (d < 0 ? "bg-red-100 text-red-700" : d <= 60 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700")}>
                        {d < 0 ? "פג" : d <= 60 ? d + " יום" : "תקין"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // === ביטוחים ===
  function renderInsurance() {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b flex justify-between items-center">
          <span className="text-sm font-bold text-slate-700">ביטוחי שוכרים</span>
          <button onClick={function() {
            exportCSV([
              ["שוכר","נכס","סוג","תוקף","ימים לפקיעה"],
              ...insurances.map(function(i) {
                return [i.contracts?.tenants?.name, i.contracts?.properties?.name, i.insurance_type ?? "", fmtDate(i.end_date), daysLeft(i.end_date)];
              })
            ], "ביטוחים.csv");
          }} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">
            ⬇️ Excel
          </button>
        </div>
        {insurances.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">אין ביטוחים</div>
        ) : (
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs border-b">
              <tr>
                <th className="px-4 py-2.5 font-semibold">שוכר</th>
                <th className="px-4 py-2.5 font-semibold">נכס</th>
                <th className="px-4 py-2.5 font-semibold">תוקף</th>
                <th className="px-4 py-2.5 font-semibold">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {insurances.map(function(i) {
                const d = daysLeft(i.end_date);
                return (
                  <tr key={i.id} className={"border-t border-slate-100 " + (d < 0 ? "bg-red-50" : d <= 60 ? "bg-yellow-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{i.contracts?.tenants?.name}</td>
                    <td className="px-4 py-2.5 text-slate-500">{i.contracts?.properties?.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{fmtDate(i.end_date)}</td>
                    <td className="px-4 py-2.5">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (d < 0 ? "bg-red-100 text-red-700" : d <= 60 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700")}>
                        {d < 0 ? "פג" : d <= 60 ? d + " יום" : "תקין"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  // === תזרים צפוי ===
  function renderCashflow() {
    const active = contracts.filter(function(c) { return ["active","extended","expiring"].includes(c.status); });
    const months: { label: string; amount: number }[] = [];
    const HE_MONTHS = ["ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצמ"];
    const now  = new Date();
    for (let i = 0; i < 12; i++) {
      const d   = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mon = d.getMonth();
      const yr  = d.getFullYear();
      const amt = active.filter(function(c) {
        const start = new Date(c.start_date);
        const end   = new Date(c.end_date);
        return start <= d && end >= d;
      }).reduce(function(s, c) {
        return s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
      }, 0);
      months.push({ label: HE_MONTHS[mon] + " " + yr, amount: Math.round(amt) });
    }
    const maxAmt = Math.max(...months.map(function(m) { return m.amount; }), 1);

    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="text-sm font-bold text-slate-700 mb-4">תזרים הכנסות צפוי — 12 חודשים קדימה</div>
          <div className="flex items-end gap-1 h-40">
            {months.map(function(m, i) {
              const h = Math.round((m.amount / maxAmt) * 100);
              const isCurrent = i === 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-xs text-slate-400 font-medium">
                    {m.amount > 0 ? "₪" + Math.round(m.amount / 1000) + "K" : "—"}
                  </div>
                  <div className={"rounded-t-sm w-full " + (isCurrent ? "bg-blue-600" : "bg-blue-200")}
                    style={{ height: h + "%" }} />
                  <div className="text-xs text-slate-400 whitespace-nowrap" style={{ fontSize: "9px" }}>
                    {m.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs border-b">
              <tr>
                <th className="px-4 py-2.5 font-semibold">חודש</th>
                <th className="px-4 py-2.5 font-semibold">הכנסה צפויה</th>
                <th className="px-4 py-2.5 font-semibold">שנתי מצטבר</th>
              </tr>
            </thead>
            <tbody>
              {months.map(function(m, i) {
                const cumulative = months.slice(0, i+1).reduce(function(s, x) { return s + x.amount; }, 0);
                return (
                  <tr key={i} className={"border-t border-slate-100 " + (i === 0 ? "bg-blue-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-2 font-medium text-slate-700">{m.label}</td>
                    <td className="px-4 py-2 font-semibold text-green-700">₪{m.amount.toLocaleString()}</td>
                    <td className="px-4 py-2 text-slate-500">₪{cumulative.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const renderContent = function() {
    if (loading) return <div className="text-center py-12 text-slate-400">טוען...</div>;
    if (tab === "occupancy")  return renderOccupancy();
    if (tab === "contracts")  return renderContracts();
    if (tab === "revenue")    return renderRevenue();
    if (tab === "guarantees") return renderGuarantees();
    if (tab === "insurance")  return renderInsurance();
    if (tab === "cashflow")   return renderCashflow();
    return null;
  };

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">דוחות</h1>
        <p className="text-sm text-slate-500 mt-1">ניתוח וייצוא נתוני הנכסים</p>
      </div>

      {/* טאבים */}
      <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto">
        {TABS.map(function(t) {
          return (
            <button key={t.key} onClick={function() { setTab(t.key); }}
              className={"px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap " +
                (tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {renderContent()}
    </div>
  );
}
