"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

function csvDownload(filename: string, rows: any[], headers: string[], keys: string[]) {
  const bom = "\uFEFF";
  const lines = [headers.join(","), ...rows.map(function(r) {
    return keys.map(function(k) {
      const v = k.split(".").reduce(function(o: any, p) { return o?.[p]; }, r) ?? "";
      return '"' + String(v).replace(/"/g, '""') + '"';
    }).join(",");
  })];
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const TABS = [
  { id: "revenue",    label: "הכנסות",       icon: "💰" },
  { id: "occupancy",  label: "תפוסה",        icon: "📊" },
  { id: "expiring",   label: "פוגות",        icon: "⏰" },
  { id: "charges",    label: "חיובים",       icon: "📋" },
  { id: "guarantees", label: "ערבויות",      icon: "🏦" },
  { id: "safety",     label: "בטיחות",       icon: "🔒" },
];

export default function ReportsPage() {
  const [tab,      setTab]      = useState("revenue");
  const [loading,  setLoading]  = useState(true);
  const [data,     setData]     = useState<any>({});
  const [fromDate, setFromDate] = useState("");
  const [toDate,   setToDate]   = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [
      { data: contracts },
      { data: charges },
      { data: guarantees },
      { data: safety },
      { data: properties },
    ] = await Promise.all([
      supabase.from("contracts").select("id,status,end_date,start_date,rent_per_sqm,charged_area,investment_addition,tenants(name),properties(name,total_rentable_area),contract_options(status)"),
      supabase.from("charges").select("id,status,total_amount,charge_type,billing_period_start,contracts(tenants(name),properties(name))").order("billing_period_start", { ascending: false }),
      supabase.from("guarantees").select("id,status,amount_actual,guarantee_type,end_date,contracts(tenants(name),properties(name))"),
      supabase.from("safety_inspections").select("id,inspection_type,status,next_inspection_date,properties(name)"),
      supabase.from("properties").select("id,name,total_rentable_area,spaces(id,status,area),units(id,status,area)"),
    ]);

    const active = (contracts ?? []).filter(function(c) { return ["active","expiring","extended"].includes(c.status); });
    const totalRevenue = active.reduce(function(s: number, c: any) {
      return s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
    }, 0);

    setData({
      contracts:    contracts ?? [],
      active,
      charges:      charges ?? [],
      guarantees:   guarantees ?? [],
      safety:       safety ?? [],
      properties:   properties ?? [],
      totalRevenue,
    });
    setLoading(false);
  }

  function filterByDate(rows: any[], dateKey: string) {
    return rows.filter(function(r) {
      const d = r[dateKey];
      if (!d) return true;
      if (fromDate && d < fromDate) return false;
      if (toDate   && d > toDate)   return false;
      return true;
    });
  }

  const daysLeft = function(d: string) {
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  };

  if (loading) return <div dir="rtl" className="py-12 text-center text-slate-400">טוען...</div>;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">דוחות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {data.active?.length} חוזים פעילים | ₪{Math.round(data.totalRevenue).toLocaleString()}/חודש
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" value={fromDate} onChange={function(e) { setFromDate(e.target.value); }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white" placeholder="מ-" />
          <span className="text-slate-400 text-xs">עד</span>
          <input type="date" value={toDate} onChange={function(e) { setToDate(e.target.value); }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white" />
          {(fromDate || toDate) && (
            <button onClick={function() { setFromDate(""); setToDate(""); }}
              className="text-xs text-red-400 hover:text-red-600">✕ נקה</button>
          )}
        </div>
      </div>

      {/* טאבים */}
      <div className="mb-5 flex gap-1 flex-wrap">
        {TABS.map(function(t) {
          return (
            <button key={t.id} onClick={function() { setTab(t.id); }}
              className={"rounded-xl border px-4 py-2 text-sm font-semibold transition-all " +
                (tab === t.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {/* הכנסות */}
      {tab === "revenue" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "הכנסה חודשית",     value: "₪" + Math.round(data.totalRevenue).toLocaleString(),     color: "text-green-700", bg: "bg-green-50",  border: "border-green-100" },
              { label: "הכנסה שנתית (צפי)", value: "₪" + Math.round(data.totalRevenue * 12).toLocaleString(), color: "text-blue-700",  bg: "bg-blue-50",   border: "border-blue-100"  },
              { label: "חוזים פעילים",      value: data.active?.length,                                       color: "text-slate-800", bg: "bg-white",     border: "border-slate-200" },
            ].map(function(k) {
              return (
                <div key={k.label} className={"rounded-xl border p-4 " + k.bg + " " + k.border}>
                  <div className={"text-2xl font-black " + k.color}>{k.value}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
                </div>
              );
            })}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="font-semibold text-slate-700">פירוט הכנסות לפי חוזה</span>
              <button onClick={function() {
                csvDownload("הכנסות.csv", data.active,
                  ["שוכר","נכס","שכ\"ד/מ\"ר","שטח","הכנסה/חודש"],
                  ["tenants.name","properties.name","rent_per_sqm","charged_area","_monthly"]
                );
              }} className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 font-semibold">
                ⬇ CSV
              </button>
            </div>
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-700 border-b">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">שוכר</th>
                  <th className="px-4 py-2.5 font-semibold">נכס</th>
                  <th className="px-4 py-2.5 font-semibold">שכ"ד/מ"ר</th>
                  <th className="px-4 py-2.5 font-semibold">שטח</th>
                  <th className="px-4 py-2.5 font-semibold">חודשי</th>
                  <th className="px-4 py-2.5 font-semibold">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {data.active?.map(function(c: any) {
                  const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                  return (
                    <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{c.tenants?.name}</td>
                      <td className="px-4 py-2.5 text-slate-600">{c.properties?.name}</td>
                      <td className="px-4 py-2.5 text-slate-600">₪{c.rent_per_sqm ?? 0}</td>
                      <td className="px-4 py-2.5 text-slate-600">{c.charged_area ?? 0} מ"ר</td>
                      <td className="px-4 py-2.5 font-bold text-green-700">₪{Math.round(monthly).toLocaleString()}</td>
                      <td className="px-4 py-2.5">
                        <span className={"text-xs px-2 py-0.5 rounded-full " +
                          (c.status === "expiring" ? "bg-yellow-100 text-yellow-700" :
                            c.status === "extended" ? "bg-blue-100 text-blue-700" :
                            "bg-green-100 text-green-700")}>
                          {c.status === "expiring" ? "פוגה" : c.status === "extended" ? "מורחב" : "פעיל"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* תפוסה */}
      {tab === "occupancy" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center">
            <span className="font-semibold text-slate-700">תפוסה לפי נכס</span>
            <button onClick={function() {
              csvDownload("תפוסה.csv", data.properties,
                ["נכס","סה\"כ יחידות","מושכרות","תפוסה %"],
                ["name","_total","_occupied","_pct"]);
            }} className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg font-semibold">⬇ CSV</button>
          </div>
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b">
              <tr>
                <th className="px-4 py-2.5 font-semibold">נכס</th>
                <th className="px-4 py-2.5 font-semibold">יחידות</th>
                <th className="px-4 py-2.5 font-semibold">מושכרות</th>
                <th className="px-4 py-2.5 font-semibold">תפוסה</th>
                <th className="px-4 py-2.5 font-semibold">שטח מ"ר</th>
              </tr>
            </thead>
            <tbody>
              {data.properties?.map(function(p: any) {
                const items    = p.spaces?.length ? p.spaces : p.units ?? [];
                const total    = items.length;
                const occupied = items.filter(function(u: any) { return u.status === "rented"; }).length;
                const pct      = total > 0 ? Math.round(occupied / total * 100) : 0;
                const area     = items.reduce(function(s: number, u: any) { return s + (u.area ?? 0); }, 0);
                return (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                    <td className="px-4 py-3 text-slate-600">{total}</td>
                    <td className="px-4 py-3 text-slate-600">{occupied}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-slate-100 rounded-full h-2">
                          <div className={"h-2 rounded-full " + (pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400")}
                            style={{ width: pct + "%" }} />
                        </div>
                        <span className={"text-xs font-bold " + (pct >= 80 ? "text-green-700" : pct >= 50 ? "text-yellow-600" : "text-red-600")}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{area.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* פוגות */}
      {tab === "expiring" && (() => {
        const rows = data.contracts?.filter(function(c: any) {
          const d = daysLeft(c.end_date);
          return ["active","expiring","extended"].includes(c.status) && d <= 180;
        }).sort(function(a: any, b: any) { return daysLeft(a.end_date) - daysLeft(b.end_date); }) ?? [];
        return (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center">
              <span className="font-semibold text-slate-700">חוזים שפוגים ב-180 יום ({rows.length})</span>
              <button onClick={function() { csvDownload("פוגות.csv", rows, ["שוכר","נכס","תאריך סיום","ימים"], ["tenants.name","properties.name","end_date","_days"]); }}
                className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg font-semibold">⬇ CSV</button>
            </div>
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">שוכר</th>
                  <th className="px-4 py-2.5 font-semibold">נכס</th>
                  <th className="px-4 py-2.5 font-semibold">סיום</th>
                  <th className="px-4 py-2.5 font-semibold">ימים</th>
                  <th className="px-4 py-2.5 font-semibold">אופציה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(function(c: any) {
                  const d = daysLeft(c.end_date);
                  const hasOpt = c.contract_options?.some(function(o: any) { return o.status === "pending"; });
                  return (
                    <tr key={c.id} className={"border-t border-slate-100 " + (d <= 30 ? "bg-red-50" : d <= 60 ? "bg-yellow-50" : "hover:bg-slate-50")}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{c.tenants?.name}</td>
                      <td className="px-4 py-2.5 text-slate-600">{c.properties?.name}</td>
                      <td className="px-4 py-2.5 text-slate-600">{fmtDate(c.end_date)}</td>
                      <td className="px-4 py-2.5">
                        <span className={"font-bold text-sm " + (d <= 30 ? "text-red-600" : d <= 60 ? "text-yellow-600" : "text-slate-600")}>
                          {d} יום
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {hasOpt && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">יש אופציה</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* חיובים */}
      {tab === "charges" && (() => {
        const rows = fromDate || toDate ? filterByDate(data.charges ?? [], "billing_period_start") : (data.charges ?? []).slice(0, 50);
        const total = rows.reduce(function(s: number, c: any) { return s + (c.total_amount ?? 0); }, 0);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "חיובים", value: rows.length, color: "text-slate-800" },
                { label: "סה\"כ", value: "₪" + Math.round(total).toLocaleString(), color: "text-green-700" },
                { label: "ממתין", value: rows.filter(function(c:any){return c.status==="pending";}).length, color: "text-yellow-700" },
              ].map(function(k) {
                return <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4"><div className={"text-2xl font-black "+k.color}>{k.value}</div><div className="text-xs text-slate-500">{k.label}</div></div>;
              })}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b flex justify-between items-center">
                <span className="font-semibold text-slate-700">חיובים ({rows.length})</span>
                <button onClick={function() { csvDownload("חיובים.csv", rows, ["שוכר","נכס","סוג","סכום","תאריך"], ["contracts.tenants.name","contracts.properties.name","charge_type","total_amount","billing_period_start"]); }}
                  className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg font-semibold">⬇ CSV</button>
              </div>
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-slate-600 border-b">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">שוכר</th>
                    <th className="px-4 py-2.5 font-semibold">סוג</th>
                    <th className="px-4 py-2.5 font-semibold">סכום</th>
                    <th className="px-4 py-2.5 font-semibold">תאריך</th>
                    <th className="px-4 py-2.5 font-semibold">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(function(c: any) {
                    return (
                      <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{c.contracts?.tenants?.name}<div className="text-xs text-slate-400">{c.contracts?.properties?.name}</div></td>
                        <td className="px-4 py-2.5 text-slate-600">{c.charge_type}</td>
                        <td className="px-4 py-2.5 font-bold text-slate-800">₪{Math.round(c.total_amount ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(c.billing_period_start)}</td>
                        <td className="px-4 py-2.5"><span className={"text-xs px-2 py-0.5 rounded-full " + (c.status==="approved"?"bg-green-100 text-green-700":c.status==="paid"?"bg-blue-100 text-blue-700":"bg-yellow-100 text-yellow-700")}>{c.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ערבויות */}
      {tab === "guarantees" && (() => {
        const active = data.guarantees?.filter(function(g:any){return g.status==="active";}) ?? [];
        const total  = active.reduce(function(s:number,g:any){return s+(g.amount_actual??0);},0);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                {label:"פעילות",value:active.length,color:"text-blue-700"},
                {label:"סה\"כ",value:"₪"+Math.round(total).toLocaleString(),color:"text-green-700"},
                {label:"פגות ב-60 יום",value:active.filter(function(g:any){return g.end_date&&Math.ceil((new Date(g.end_date).getTime()-Date.now())/86400000)<=60;}).length,color:"text-yellow-700"},
              ].map(function(k){return <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4"><div className={"text-2xl font-black "+k.color}>{k.value}</div><div className="text-xs text-slate-500">{k.label}</div></div>;})
              }
            </div>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-slate-600 border-b">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">שוכר</th>
                    <th className="px-4 py-2.5 font-semibold">סוג</th>
                    <th className="px-4 py-2.5 font-semibold">סכום</th>
                    <th className="px-4 py-2.5 font-semibold">תוקף</th>
                    <th className="px-4 py-2.5 font-semibold">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.guarantees??[]).map(function(g:any){
                    const d = g.end_date ? daysLeft(g.end_date) : 999;
                    return (
                      <tr key={g.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{g.contracts?.tenants?.name}<div className="text-xs text-slate-400">{g.contracts?.properties?.name}</div></td>
                        <td className="px-4 py-2.5 text-slate-600">{g.guarantee_type}</td>
                        <td className="px-4 py-2.5 font-bold">₪{Math.round(g.amount_actual??0).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDate(g.end_date)}</td>
                        <td className="px-4 py-2.5"><span className={"text-xs px-2 py-0.5 rounded-full "+(g.status==="returned"?"bg-slate-100 text-slate-500":g.status==="forfeited"?"bg-red-100 text-red-700":d<=60?"bg-yellow-100 text-yellow-700":"bg-green-100 text-green-700")}>{g.status==="returned"?"הוחזרה":g.status==="forfeited"?"חולטה":d<=60?d+" ימים":"פעילה"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* בטיחות */}
      {tab === "safety" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b flex justify-between items-center">
            <span className="font-semibold text-slate-700">בדיקות בטיחות ({data.safety?.length})</span>
            <button onClick={function() { csvDownload("בטיחות.csv", data.safety??[], ["נכס","סוג","סטטוס","בדיקה הבאה"], ["properties.name","inspection_type","status","next_inspection_date"]); }}
              className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg font-semibold">⬇ CSV</button>
          </div>
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b">
              <tr>
                <th className="px-4 py-2.5 font-semibold">נכס</th>
                <th className="px-4 py-2.5 font-semibold">סוג</th>
                <th className="px-4 py-2.5 font-semibold">בדיקה הבאה</th>
                <th className="px-4 py-2.5 font-semibold">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {(data.safety??[]).map(function(s:any){
                const d = daysLeft(s.next_inspection_date);
                return (
                  <tr key={s.id} className={"border-t border-slate-100 "+(s.status!=="completed"&&d<0?"bg-red-50":s.status!=="completed"&&d<=30?"bg-yellow-50":"hover:bg-slate-50")}>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{s.properties?.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{s.inspection_type}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(s.next_inspection_date)}</td>
                    <td className="px-4 py-2.5"><span className={"text-xs px-2 py-0.5 rounded-full "+(s.status==="completed"?"bg-green-100 text-green-700":d<0?"bg-red-100 text-red-700":d<=30?"bg-yellow-100 text-yellow-700":"bg-slate-100 text-slate-600")}>{s.status==="completed"?"✓ בוצע":d<0?"באיחור":d+" יום"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
