"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm";

function csvDownload(filename: string, rows: any[][], headers: string[]) {
  const bom   = "\uFEFF";
  const lines = [headers.join(","), ...rows.map(function(r) {
    return r.map(function(v) { return '"' + String(v ?? "").replace(/"/g, '""') + '"'; }).join(",");
  })];
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const TABS = [
  { id: "contracts",   label: "חוזים",         icon: "📄" },
  { id: "payments",    label: "חיובים",         icon: "💳" },
  { id: "tenants",     label: "שוכרים",         icon: "👤" },
  { id: "properties",  label: "נכסים",          icon: "🏢" },
  { id: "guarantees",  label: "ערבויות",        icon: "🏦" },
  { id: "expiring",    label: "פוגים בקרוב",    icon: "⚠️" },
];

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}
function fmtMoney(n: number) {
  return n ? "₪" + Math.round(n).toLocaleString() : "—";
}

export default function ReportsPage() {
  const [tab,         setTab]         = useState("contracts");
  const [loading,     setLoading]     = useState(false);
  const [contracts,   setContracts]   = useState<any[]>([]);
  const [payments,    setPayments]    = useState<any[]>([]);
  const [tenants,     setTenants]     = useState<any[]>([]);
  const [properties,  setProperties]  = useState<any[]>([]);
  const [guarantees,  setGuarantees]  = useState<any[]>([]);
  const [filterYear,  setFilterYear]  = useState(new Date().getFullYear());

  useEffect(function() { loadTab(tab); }, [tab, filterYear]);

  async function loadTab(t: string) {
    setLoading(true);
    if (t === "contracts") {
      const { data } = await supabase.from("contracts")
        .select("id, status, start_date, end_date, rent_per_sqm, charged_area, investment_addition, vat_type, tenants(name), properties(name)")
        .order("status").order("end_date");
      setContracts(data ?? []);
    } else if (t === "payments") {
      const from = `${filterYear}-01-01`;
      const to   = `${filterYear}-12-31`;
      const { data } = await supabase.from("charges")
        .select("id, charge_type, billing_period_start, base_amount, vat_amount, total_amount, status, contracts(tenants(name), properties(name))")
        .gte("billing_period_start", from).lte("billing_period_start", to)
        .order("billing_period_start", { ascending: false });
      setPayments(data ?? []);
    } else if (t === "tenants") {
      const { data } = await supabase.from("tenants").select("*").order("name");
      setTenants(data ?? []);
    } else if (t === "properties") {
      const { data } = await supabase.from("properties")
        .select("id, name, property_type, city, total_area, companies(company_name)")
        .order("name");
      setProperties(data ?? []);
    } else if (t === "guarantees") {
      const { data } = await supabase.from("guarantees")
        .select("id, guarantee_type, amount_required, amount_actual, status, end_date, contracts(tenants(name), properties(name))")
        .order("end_date");
      setGuarantees(data ?? []);
    } else if (t === "expiring") {
      const { data } = await supabase.from("contracts")
        .select("id, status, end_date, rent_per_sqm, charged_area, investment_addition, tenants(name), properties(name)")
        .in("status", ["active","expiring"])
        .order("end_date");
      setContracts(data ?? []);
    }
    setLoading(false);
  }

  function handleCSV() {
    if (tab === "contracts" || tab === "expiring") {
      const rows = contracts.map(function(c) {
        const mon = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
        const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : null;
        return [c.tenants?.name, c.properties?.name, c.status, fmtDate(c.start_date), fmtDate(c.end_date), Math.round(mon), days ?? ""];
      });
      csvDownload("חוזים.csv", rows, ["שוכר","נכס","סטטוס","תחילה","סיום","הכנסה חודשית","ימים לסיום"]);
    } else if (tab === "payments") {
      const rows = payments.map(function(p) {
        return [p.contracts?.tenants?.name, p.contracts?.properties?.name, fmtDate(p.billing_period_start), p.charge_type, Math.round(p.base_amount??0), Math.round(p.vat_amount??0), Math.round(p.total_amount??0), p.status];
      });
      csvDownload(`חיובים_${filterYear}.csv`, rows, ["שוכר","נכס","תאריך","סוג","בסיס","מעמ","סהכ","סטטוס"]);
    } else if (tab === "tenants") {
      const rows = tenants.map(function(t) {
        return [t.name, t.company_name, t.id_number, t.phone, t.email, t.address];
      });
      csvDownload("שוכרים.csv", rows, ["שם","חברה","חפ","טלפון","אימייל","כתובת"]);
    } else if (tab === "guarantees") {
      const rows = guarantees.map(function(g) {
        const diff = (g.amount_actual??0) - (g.amount_required??0);
        return [g.contracts?.tenants?.name, g.contracts?.properties?.name, g.guarantee_type, Math.round(g.amount_required??0), Math.round(g.amount_actual??0), diff >= 0 ? "תקין" : "חסר ₪"+Math.abs(diff), g.status, fmtDate(g.end_date)];
      });
      csvDownload("ערבויות.csv", rows, ["שוכר","נכס","סוג","נדרש","בפועל","פער","סטטוס","תוקף"]);
    }
  }

  const statusBadge = function(s: string) {
    const map: Record<string,string> = {
      active:   "bg-green-100 text-green-700",
      expiring: "bg-yellow-100 text-yellow-700",
      ended:    "bg-slate-100 text-slate-500",
      upcoming: "bg-purple-100 text-purple-700",
      extended: "bg-blue-100 text-blue-700",
      paid:     "bg-green-100 text-green-700",
      approved: "bg-blue-100 text-blue-700",
      pending:  "bg-slate-100 text-slate-600",
    };
    const labels: Record<string,string> = {
      active:"פעיל", expiring:"פוגה", ended:"הסתיים", upcoming:"עתידי",
      extended:"מורחב", paid:"שולם", approved:"מאושר", pending:"ממתין",
    };
    return <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + (map[s]||"bg-slate-100 text-slate-500")}>{labels[s]??s}</span>;
  };

  const expiringContracts = contracts.filter(function(c) {
    if (!c.end_date) return false;
    const d = Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000);
    return d >= 0 && d <= 90;
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">דוחות</h1>
          <p className="text-sm text-slate-500 mt-1">ייצוא נתונים ל-CSV</p>
        </div>
        <div className="flex gap-2 items-center">
          {(tab==="payments") && (
            <select value={filterYear} onChange={function(e){setFilterYear(Number(e.target.value));}} className={ic}>
              {[2023,2024,2025,2026].map(function(y){return <option key={y} value={y}>{y}</option>;})}
            </select>
          )}
          <button onClick={handleCSV}
            className="rounded-lg bg-slate-700 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800">
            ⬇ ייצא CSV
          </button>
        </div>
      </div>

      {/* טאבים */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {TABS.map(function(t) {
          return (
            <button key={t.id} onClick={function(){setTab(t.id);}}
              className={"rounded-xl border px-4 py-2 text-sm font-semibold transition-all " +
                (tab===t.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {t.icon} {t.label}
              {t.id==="expiring" && expiringContracts.length > 0 && tab!=="expiring" && (
                <span className="mr-1 bg-red-500 text-white text-xs rounded-full px-1.5">{expiringContracts.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">

          {/* חוזים / פוגים */}
          {(tab==="contracts" || tab==="expiring") && (
            <>
              <div className="px-5 py-3 border-b border-slate-100 text-sm text-slate-500">
                {tab==="expiring" ? expiringContracts.length+" חוזים פוגים ב-90 יום" : contracts.length+" חוזים"}
              </div>
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-slate-600 border-b text-xs">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">שוכר</th>
                    <th className="px-4 py-2.5 font-semibold">נכס</th>
                    <th className="px-4 py-2.5 font-semibold">סטטוס</th>
                    <th className="px-4 py-2.5 font-semibold">תחילה</th>
                    <th className="px-4 py-2.5 font-semibold">סיום</th>
                    <th className="px-4 py-2.5 font-semibold">הכנסה</th>
                    <th className="px-4 py-2.5 font-semibold">ימים</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab==="expiring" ? expiringContracts : contracts).map(function(c) {
                    const mon  = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
                    const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : null;
                    return (
                      <tr key={c.id} className={"border-t border-slate-100 " + (days!==null&&days<=30?"bg-red-50":days!==null&&days<=60?"bg-yellow-50":"hover:bg-slate-50")}>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{c.tenants?.name}</td>
                        <td className="px-4 py-2.5 text-slate-500">{c.properties?.name}</td>
                        <td className="px-4 py-2.5">{statusBadge(c.status)}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(c.start_date)}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(c.end_date)}</td>
                        <td className="px-4 py-2.5 font-semibold text-green-700">{fmtMoney(mon)}</td>
                        <td className="px-4 py-2.5">
                          {days !== null && <span className={"font-bold " + (days<=30?"text-red-600":days<=60?"text-yellow-600":"text-slate-500")}>{days}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {/* חיובים */}
          {tab==="payments" && (
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b text-xs">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">שוכר / נכס</th>
                  <th className="px-4 py-2.5 font-semibold">תאריך</th>
                  <th className="px-4 py-2.5 font-semibold">בסיס</th>
                  <th className="px-4 py-2.5 font-semibold">מע"מ</th>
                  <th className="px-4 py-2.5 font-semibold">סה"כ</th>
                  <th className="px-4 py-2.5 font-semibold">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(function(p) {
                  return (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800">{p.contracts?.tenants?.name}</div>
                        <div className="text-xs text-slate-400">{p.contracts?.properties?.name}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(p.billing_period_start)}</td>
                      <td className="px-4 py-2.5">{fmtMoney(p.base_amount)}</td>
                      <td className="px-4 py-2.5 text-slate-500">{fmtMoney(p.vat_amount)}</td>
                      <td className="px-4 py-2.5 font-bold text-slate-800">{fmtMoney(p.total_amount)}</td>
                      <td className="px-4 py-2.5">{statusBadge(p.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* שוכרים */}
          {tab==="tenants" && (
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b text-xs">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">שם</th>
                  <th className="px-4 py-2.5 font-semibold">חברה</th>
                  <th className="px-4 py-2.5 font-semibold">ח.פ / ת.ז</th>
                  <th className="px-4 py-2.5 font-semibold">טלפון</th>
                  <th className="px-4 py-2.5 font-semibold">אימייל</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(function(t) {
                  return (
                    <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-800">{t.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{t.company_name??""}</td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{t.id_number??""}</td>
                      <td className="px-4 py-2.5 text-slate-500" dir="ltr">{t.phone??""}</td>
                      <td className="px-4 py-2.5 text-slate-400 text-xs" dir="ltr">{t.email??""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* נכסים */}
          {tab==="properties" && (
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b text-xs">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">שם</th>
                  <th className="px-4 py-2.5 font-semibold">חברה</th>
                  <th className="px-4 py-2.5 font-semibold">עיר</th>
                  <th className="px-4 py-2.5 font-semibold">סוג</th>
                  <th className="px-4 py-2.5 font-semibold">שטח</th>
                </tr>
              </thead>
              <tbody>
                {properties.map(function(p) {
                  return (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-800">{p.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{p.companies?.company_name??""}</td>
                      <td className="px-4 py-2.5 text-slate-500">{p.city??""}</td>
                      <td className="px-4 py-2.5 text-slate-500">{p.property_type??""}</td>
                      <td className="px-4 py-2.5 text-slate-500">{p.total_area ? p.total_area+' מ"ר' : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ערבויות */}
          {tab==="guarantees" && (
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b text-xs">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">שוכר / נכס</th>
                  <th className="px-4 py-2.5 font-semibold">סוג</th>
                  <th className="px-4 py-2.5 font-semibold">נדרש</th>
                  <th className="px-4 py-2.5 font-semibold">בפועל</th>
                  <th className="px-4 py-2.5 font-semibold">פער</th>
                  <th className="px-4 py-2.5 font-semibold">תוקף</th>
                  <th className="px-4 py-2.5 font-semibold">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {guarantees.map(function(g) {
                  const diff = (g.amount_actual??0) - (g.amount_required??0);
                  return (
                    <tr key={g.id} className={"border-t border-slate-100 " + (diff<0?"bg-red-50":"hover:bg-slate-50")}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800">{g.contracts?.tenants?.name}</div>
                        <div className="text-xs text-slate-400">{g.contracts?.properties?.name}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{g.guarantee_type}</td>
                      <td className="px-4 py-2.5">{fmtMoney(g.amount_required)}</td>
                      <td className="px-4 py-2.5 font-semibold">{fmtMoney(g.amount_actual)}</td>
                      <td className="px-4 py-2.5">
                        <span className={diff<0?"text-red-600 font-bold":"text-green-600"}>
                          {diff<0 ? "-₪"+Math.abs(diff).toLocaleString() : "✓"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(g.end_date)}</td>
                      <td className="px-4 py-2.5">{statusBadge(g.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
