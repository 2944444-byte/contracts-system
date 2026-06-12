"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';

const TABS = [
  {id:"contracts",  label:"חוזים",       icon:"📄"},
  {id:"payments",   label:"חיובים",      icon:"💳"},
  {id:"tenants",    label:"שוכרים",      icon:"👤"},
  {id:"properties", label:"נכסים",       icon:"🏢"},
  {id:"guarantees", label:"ערבויות",     icon:"🏦"},
  {id:"expiring",   label:"פוגים בקרוב", icon:"⚠️"},
];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return n ? "₪"+n.toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; }

function csvDownload(filename: string, rows: any[][], headers: string[]) {
  const bom="\uFEFF";
  const lines=[headers.join(","),...rows.map(function(r){return r.map(function(v){return '"'+String(v??"").replace(/"/g,'""')+'"';}).join(",");})];
  const url=URL.createObjectURL(new Blob([bom+lines.join("\n")],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [tab,       setTab]       = useState("contracts");
  const [loading,   setLoading]   = useState(false);
  const [data,      setData]      = useState<any[]>([]);
  const [filterYear,setFilterYear]= useState(new Date().getFullYear());

  useEffect(function() { loadTab(tab); }, [tab, filterYear]);

  async function loadTab(t: string) {
    setLoading(true);
    if (t==="contracts" || t==="expiring") {
      const { data: c } = await supabase.from("contracts")
        .select("id,property_id,status,start_date,end_date,rent_per_sqm,charged_area,investment_addition,vat_type,tenants(name),properties(name)")
        .order("end_date");
      setData(scopeRows(c ?? [], await getScopeIds(), function(x: any){ return x.property_id; }));
    } else if (t==="payments") {
      const { data: p } = await supabase.from("charges")
        .select("id,charge_type,billing_period_start,base_amount,vat_amount,total_amount,status,contracts(property_id,tenants(name),properties(name))")
        .gte("billing_period_start", filterYear+"-01-01").lte("billing_period_start", filterYear+"-12-31")
        .order("billing_period_start",{ascending:false});
      setData(scopeRows(p ?? [], await getScopeIds(), function(x: any){ return x.contracts?.property_id; }));
    } else if (t==="tenants") {
      const { data: ten } = await supabase.from("tenants").select("*").order("name");
      setData(ten ?? []);
    } else if (t==="properties") {
      const { data: pr } = await supabase.from("properties").select("id,name,property_type,city,total_area,companies(company_name)").order("name");
      setData(scopeRows(pr ?? [], await getScopeIds(), function(x: any){ return x.id; }));
    } else if (t==="guarantees") {
      const { data: g } = await supabase.from("guarantees")
        .select("id,guarantee_type,amount_required,amount_actual,status,end_date,contracts(property_id,tenants(name),properties(name))")
        .order("end_date");
      setData(scopeRows(g ?? [], await getScopeIds(), function(x: any){ return x.contracts?.property_id; }));
    }
    setLoading(false);
  }

  function expiringData() {
    return data.filter(function(c) {
      if (!c.end_date) return false;
      const d=Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000);
      return d>=0&&d<=90;
    });
  }

  function handleCSV() {
    const activeData = tab==="expiring" ? expiringData() : data;
    if (tab==="contracts"||tab==="expiring") {
      csvDownload("חוזים.csv",
        activeData.map(function(c){const m=(c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);const d=c.end_date?Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000):null;return[c.tenants?.name,c.properties?.name,c.status,fmtDate(c.start_date),fmtDate(c.end_date),Math.round(m),d??""]}),
        ["שוכר","נכס","סטטוס","תחילה","סיום","הכנסה","ימים"]);
    } else if (tab==="payments") {
      csvDownload(`חיובים_${filterYear}.csv`,
        data.map(function(p){return[p.contracts?.tenants?.name,p.contracts?.properties?.name,fmtDate(p.billing_period_start),p.charge_type,Math.round(p.base_amount??0),Math.round(p.vat_amount??0),Math.round(p.total_amount??0),p.status]}),
        ["שוכר","נכס","תאריך","סוג","בסיס","מעמ","סהכ","סטטוס"]);
    } else if (tab==="tenants") {
      csvDownload("שוכרים.csv",
        data.map(function(t){return[t.name,t.company_name,t.id_number,t.phone,t.email,t.address]}),
        ["שם","חברה","חפ","טלפון","אימייל","כתובת"]);
    } else if (tab==="guarantees") {
      csvDownload("ערבויות.csv",
        data.map(function(g){const diff=(g.amount_actual??0)-(g.amount_required??0);return[g.contracts?.tenants?.name,g.contracts?.properties?.name,g.guarantee_type,Math.round(g.amount_required??0),Math.round(g.amount_actual??0),diff>=0?"תקין":"-₪"+Math.abs(diff),g.status,fmtDate(g.end_date)]}),
        ["שוכר","נכס","סוג","נדרש","בפועל","פער","סטטוס","תוקף"]);
    }
  }

  const activeData = tab==="expiring" ? expiringData() : data;

  const StatusBadge = function({s}:{s:string}) {
    const m:Record<string,string>={active:"bg-green-100 text-green-700",expiring:"bg-yellow-100 text-yellow-700",ended:"bg-slate-100 text-slate-500",paid:"bg-green-100 text-green-700",approved:"bg-blue-100 text-blue-700",pending:"bg-slate-100 text-slate-600"};
    const l:Record<string,string>={active:"פעיל",expiring:"פוגה",ended:"הסתיים",paid:"שולם",approved:"מאושר",pending:"ממתין"};
    return <span className={"text-xs px-2 py-0.5 rounded-full font-semibold "+(m[s]||"bg-slate-100 text-slate-500")}>{l[s]??s}</span>;
  };

  return (
    <div dir="rtl">
      <PageHero title="דוחות" icon="📑" tone="slate" subtitle="ייצוא נתונים ל-CSV"
        actions={
          <div className="flex gap-2 items-center">
            {tab==="payments" && (
              <select value={filterYear} onChange={function(e){setFilterYear(Number(e.target.value));}}
                className="rounded-xl bg-white/15 backdrop-blur border border-white/25 text-white px-3 py-2 text-sm [&>option]:text-slate-800">
                {[2023,2024,2025,2026].map(function(y){return <option key={y} value={y}>{y}</option>;})}
              </select>
            )}
            <button onClick={handleCSV} className="rounded-xl bg-white text-slate-700 px-4 py-2 text-sm font-bold hover:bg-slate-100 shadow-sm">
              ⬇ CSV
            </button>
          </div>
        } />

      <div className="flex gap-1 mb-5 flex-wrap">
        {TABS.map(function(t) {
          return (
            <button key={t.id} onClick={function(){setTab(t.id);}}
              className={"rounded-xl border px-4 py-2 text-sm font-semibold transition-all "+(tab===t.id?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {t.icon} {t.label}
              {t.id==="expiring" && tab!=="expiring" && expiringData().length>0 && (
                <span className="mr-1 bg-red-500 text-white text-xs rounded-full px-1.5">{expiringData().length}</span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-2.5 border-b border-slate-100 text-xs text-slate-400">{activeData.length} רשומות</div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b text-xs text-slate-600">
                <tr>
                  {(tab==="contracts"||tab==="expiring") && <><th className="px-4 py-2.5 font-semibold">שוכר</th><th className="px-4 py-2.5 font-semibold">נכס</th><th className="px-4 py-2.5 font-semibold">סטטוס</th><th className="px-4 py-2.5 font-semibold">תחילה</th><th className="px-4 py-2.5 font-semibold">סיום</th><th className="px-4 py-2.5 font-semibold">הכנסה</th><th className="px-4 py-2.5 font-semibold">ימים</th></>}
                  {tab==="payments" && <><th className="px-4 py-2.5 font-semibold">שוכר/נכס</th><th className="px-4 py-2.5 font-semibold">תאריך</th><th className="px-4 py-2.5 font-semibold">בסיס</th><th className="px-4 py-2.5 font-semibold">מע"מ</th><th className="px-4 py-2.5 font-semibold">סה"כ</th><th className="px-4 py-2.5 font-semibold">סטטוס</th></>}
                  {tab==="tenants" && <><th className="px-4 py-2.5 font-semibold">שם</th><th className="px-4 py-2.5 font-semibold">חברה</th><th className="px-4 py-2.5 font-semibold">ח.פ</th><th className="px-4 py-2.5 font-semibold">טלפון</th><th className="px-4 py-2.5 font-semibold">אימייל</th></>}
                  {tab==="properties" && <><th className="px-4 py-2.5 font-semibold">שם</th><th className="px-4 py-2.5 font-semibold">חברה</th><th className="px-4 py-2.5 font-semibold">עיר</th><th className="px-4 py-2.5 font-semibold">שטח</th></>}
                  {tab==="guarantees" && <><th className="px-4 py-2.5 font-semibold">שוכר</th><th className="px-4 py-2.5 font-semibold">סוג</th><th className="px-4 py-2.5 font-semibold">נדרש</th><th className="px-4 py-2.5 font-semibold">בפועל</th><th className="px-4 py-2.5 font-semibold">פער</th><th className="px-4 py-2.5 font-semibold">תוקף</th><th className="px-4 py-2.5 font-semibold">סטטוס</th></>}
                </tr>
              </thead>
              <tbody>
                {activeData.slice(0,100).map(function(row, i) {
                  if (tab==="contracts"||tab==="expiring") {
                    const m=(row.rent_per_sqm??0)*(row.charged_area??0)+(row.investment_addition??0);
                    const d=row.end_date?Math.ceil((new Date(row.end_date).getTime()-Date.now())/86400000):null;
                    return <tr key={row.id} className={"border-t border-slate-100 "+(d!==null&&d<=30?"bg-red-50":d!==null&&d<=60?"bg-yellow-50":"hover:bg-slate-50")}><td className="px-4 py-2.5 font-medium">{row.tenants?.name}</td><td className="px-4 py-2.5 text-slate-500 text-xs">{row.properties?.name}</td><td className="px-4 py-2.5"><StatusBadge s={row.status}/></td><td className="px-4 py-2.5 text-xs text-slate-400">{fmtDate(row.start_date)}</td><td className="px-4 py-2.5 text-xs text-slate-400">{fmtDate(row.end_date)}</td><td className="px-4 py-2.5 font-semibold text-green-700">{fmtMoney(m)}</td><td className="px-4 py-2.5"><span className={"font-bold "+(d!==null&&d<=30?"text-red-600":d!==null&&d<=60?"text-yellow-600":"text-slate-400")}>{d}</span></td></tr>;
                  }
                  if (tab==="payments") return <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50"><td className="px-4 py-2.5"><div className="font-medium text-slate-800">{row.contracts?.tenants?.name}</div><div className="text-xs text-slate-400">{row.contracts?.properties?.name}</div></td><td className="px-4 py-2.5 text-xs text-slate-500">{fmtDate(row.billing_period_start)}</td><td className="px-4 py-2.5">{fmtMoney(row.base_amount)}</td><td className="px-4 py-2.5 text-slate-500">{fmtMoney(row.vat_amount)}</td><td className="px-4 py-2.5 font-bold">{fmtMoney(row.total_amount)}</td><td className="px-4 py-2.5"><StatusBadge s={row.status}/></td></tr>;
                  if (tab==="tenants") return <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50"><td className="px-4 py-2.5 font-semibold">{row.name}</td><td className="px-4 py-2.5 text-slate-500">{row.company_name}</td><td className="px-4 py-2.5 text-xs font-mono text-slate-400">{row.id_number}</td><td className="px-4 py-2.5 text-slate-500" dir="ltr">{row.phone}</td><td className="px-4 py-2.5 text-xs text-slate-400" dir="ltr">{row.email}</td></tr>;
                  if (tab==="properties") return <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50"><td className="px-4 py-2.5 font-semibold">{row.name}</td><td className="px-4 py-2.5 text-slate-500">{row.companies?.company_name}</td><td className="px-4 py-2.5 text-slate-500">{row.city}</td><td className="px-4 py-2.5 text-slate-500">{row.total_area?row.total_area+' מ"ר':"—"}</td></tr>;
                  if (tab==="guarantees") { const diff=(row.amount_actual??0)-(row.amount_required??0); return <tr key={row.id} className={"border-t border-slate-100 "+(diff<0?"bg-red-50":"hover:bg-slate-50")}><td className="px-4 py-2.5"><div className="font-medium">{row.contracts?.tenants?.name}</div><div className="text-xs text-slate-400">{row.contracts?.properties?.name}</div></td><td className="px-4 py-2.5 text-slate-600">{row.guarantee_type}</td><td className="px-4 py-2.5">{fmtMoney(row.amount_required)}</td><td className="px-4 py-2.5 font-semibold">{fmtMoney(row.amount_actual)}</td><td className="px-4 py-2.5"><span className={diff<0?"text-red-600 font-bold":"text-green-600"}>{diff<0?"-₪"+Math.abs(diff).toLocaleString():"✓"}</span></td><td className="px-4 py-2.5 text-xs text-slate-400">{fmtDate(row.end_date)}</td><td className="px-4 py-2.5"><StatusBadge s={row.status}/></td></tr>; }
                  return null;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
