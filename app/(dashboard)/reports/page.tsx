"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
function fmt(n: number) { return n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(s: string) { if (!s) return "—"; const [y,m] = s.split("-"); return `${m}/${y}`; }

const MonthSelector = ({ value, onChange, label }: any) => (
  <div>
    <label className="mb-1 block text-xs font-semibold text-slate-700">{label}</label>
    <div className="flex gap-2">
      <select value={value.month} onChange={e => onChange({...value, month: e.target.value})
} className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-800 bg-white focus:outline-none">
        <option value="">חודש</option>
        {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
      </select>
      <input type="number" value={value.year} onChange={e => onChange({...value, year: e.target.value})} placeholder="שנה" className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white focus:outline-none" min="2000" max="2099" />
    </div>
  </div>
);

export default function ReportsPage() {
  const [tab, setTab] = useState<"indexation"|"current_rent"|"billing">("indexation");
  const [properties, setProperties] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [cpiRecords, setCpiRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProp, setSelectedProp] = useState("all");
  const [baseMonth, setBaseMonth] = useState({ year: "", month: "" });
  const [startMonth, setStartMonth] = useState({ year: "", month: "" });
  const [endMonth, setEndMonth] = useState({ year: "", month: "" });
  const [results, setResults] = useState<any[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");
  const [billingProp, setBillingProp] = useState("");
  const [billingYear, setBillingYear] = useState(new Date().getFullYear().toString());
  const [billingResults, setBillingResults] = useState<any[]>([]);
  const [billingTotal, setBillingTotal] = useState<any>(null);
  const [billingCalc, setBillingCalc] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("properties").select("id, name, total_rentable_area, annual_insurance_cost, annual_management_budget, annual_waste_cost"),
      supabase.from("contracts").select("*, tenants(name, legal_name), properties(name), units(unit_name, area_m2)").in("status",["active","expiring"]),
      supabase.from("cpi_records").select("*").order("year").order("month"),
    ]).then(([{data:p},{data:c},{data:cpi}]) => {
      setProperties(p??[]); setContracts(c??[]); setCpiRecords(cpi??[]); setLoading(false);
    });
  }, []);

  function getCpiByStr(s: string) {
    if (!s) return null;
    const [y,m] = s.split("-");
    return cpiRecords.find(c => c.year===Number(y) && c.month===Number(m))?.value ?? null;
  }

  function generatePeriods(s: string, e: string, quarterly: boolean) {
    const periods: string[] = []; const d = new Date(s+"-01"); const end = new Date(e+"-01");
    while (d <= end) { periods.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); d.setMonth(d.getMonth()+(quarterly?3:1)); }
    return periods;
  }

  async function calculate() {
    setError(""); setResults([]);
    const startStr = startMonth.year&&startMonth.month ? `${startMonth.year}-${String(startMonth.month).padStart(2,"0")}` : "";
    const endStr = endMonth.year&&endMonth.month ? `${endMonth.year}-${String(endMonth.month).padStart(2,"0")}` : "";
    const baseStr = baseMonth.year&&baseMonth.month ? `${baseMonth.year}-${String(baseMonth.month).padStart(2,"0")}` : "";
    if (!startStr||!endStr||!baseStr) { setError("יש למלא חודש בסיס + טווח"); return; }
    const baseIndexValue = getCpiByStr(baseStr);
    if (!baseIndexValue) { setError(`חסר מדד לחודש ${fmtDate(baseStr)}`); return; }
    setCalculating(true);
    const filtered = contracts.filter(c => (selectedProp==="all"||c.property_id===selectedProp) && c.index_base_value && c.charged_area);
    const allResults = [];
    for (const c of filtered) {
      const periods = generatePeriods(startStr, endStr, c.payment_frequency==="quarterly");
      const vatMult = c.vat_type==="taxable" ? (1+(c.vat_pct??18)/100) : 1;
      const rows = periods.map(p => {
        const actualCpi = getCpiByStr(p);
        if (!actualCpi) return { period:p, missing:true };
        const indexedRent = c.rent_per_sqm*(actualCpi/c.index_base_value)*c.charged_area;
        const originalRent = c.rent_per_sqm*(baseIndexValue/c.index_base_value)*c.charged_area;
        const diff = (indexedRent-originalRent)*vatMult;
        return { period:p, actualCpi, originalRent:originalRent*vatMult, indexedRent:(indexedRent+(c.mgmt_fee_per_sqm??0)*c.charged_area)*vatMult, diff, missing:false };
      });
      allResults.push({ tenantName:c.tenants?.legal_name??c.tenants?.name, propertyName:c.properties?.name, baseIndexValue:c.index_base_value, baseIndexMonth:c.index_base_month, rows, total:rows.filter((r:any)=>!r.missing).reduce((s:number,r:any)=>s+r.diff,0) });
    }
    setResults(allResults); setCalculating(false);
    if (!allResults.length) setError("לא נמצאו חוזים עם נתוני מדד");
  }

  async function calcBilling() {
    if (!billingProp) { alert("בחר נכס"); return; }
    setBillingCalc(true);
    const prop = properties.find(p => p.id===billingProp);
    if (!prop) { setBillingCalc(false); return; }
    const totalArea = prop.total_rentable_area||0;
    const annualInsurance = prop.annual_insurance_cost||0;
    const annualMgmt = prop.annual_management_budget||0;
    const annualWaste = prop.annual_waste_cost||0;
    const propContracts = contracts.filter(c => c.property_id===billingProp);
    const rows = propContracts.map(c => {
      const area = c.charged_area||c.units?.area_m2||0;
      const ratio = totalArea>0 ? area/totalArea : 0;
      return {
        tenant: c.tenants?.legal_name??c.tenants?.name??"—",
        unit: c.units?.unit_name??"—",
        area, ratio:(ratio*100).toFixed(1),
        insuranceMonthly:(annualInsurance*ratio)/12,
        mgmtMonthly:(annualMgmt*ratio)/12,
        wasteMonthly:(annualWaste*ratio)/12,
        monthlyShare:((annualInsurance+annualMgmt+annualWaste)*ratio)/12,
        annualShare:(annualInsurance+annualMgmt+annualWaste)*ratio,
      };
    });
    setBillingResults(rows);
    setBillingTotal({ totalArea, annualInsurance, annualMgmt, annualWaste, totalMonthly:rows.reduce((s,r)=>s+r.monthlyShare,0) });
    setBillingCalc(false);
  }

  return (
    <div dir="rtl" className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">📊 דוחות</h1>
        <p className="text-sm text-slate-500 mt-1">הצמדות, שכ&quot;ד עדכני וחיובי נכס</p>
      </div>
      <div className="flex gap-1 mb-6 rounded-lg bg-slate-100 p-1 w-fit">
        {([["indexation","הפרשי הצמדה 📈"],["current_rent","שכ\"ד עדכני 💰"],["billing","חיובי נכס 🏢"]] as const).map(([t,l]) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-5 py-2 text-sm font-bold transition-colors ${tab===t?"bg-white shadow text-slate-800":"text-slate-500"}`}>{l}</button>
        ))}
      </div>

      {tab==="indexation" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-700 mb-4">הגדרות חישוב</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
                <select value={selectedProp} onChange={e => setSelectedProp(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none">
                  <option value="all">כל הנכסים</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <MonthSelector value={baseMonth} onChange={setBaseMonth} label="חודש בסיס לחיוב" />
              <MonthSelector value={startMonth} onChange={setStartMonth} label="תחילת טווח" />
              <MonthSelector value={endMonth} onChange={setEndMonth} label="סוף טווח" />
            </div>
            <div className="mt-4 flex gap-3">
              <button onClick={calculate} disabled={calculating} className="rounded-lg bg-blue-700 px-6 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">{calculating?"מחשב...":"🧮 חשב הפרשי הצמדה"}</button>
            </div>
            {error && <div className="mt-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          </div>
          {results.map((r,i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b bg-slate-50 flex justify-between">
                <div><span className="font-bold">{r.tenantName}</span><span className="text-slate-500 text-sm mr-2">— {r.propertyName}</span></div>
                <span className={`font-bold text-lg ${r.total>0?"text-green-700":"text-red-600"}`}>₪{fmt(r.total)}</span>
              </div>
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b"><tr><th className="px-4 py-2">תקופה</th><th className="px-4 py-2">מדד</th><th className="px-4 py-2">שכ&quot;ד ששולם</th><th className="px-4 py-2">שכ&quot;ד מוצמד</th><th className="px-4 py-2">הפרש</th></tr></thead>
                <tbody>
                  {r.rows.map((row:any,j:number) => (
                    <tr key={j} className={`border-t ${row.missing?"bg-yellow-50":"hover:bg-slate-50"}`}>
                      <td className="px-4 py-2 font-medium">{fmtDate(row.period)}</td>
                      <td className="px-4 py-2">{row.missing?<span className="text-yellow-600">⚠️ חסר</span>:row.actualCpi}</td>
                      <td className="px-4 py-2">{row.missing?"—":`₪${fmt(row.originalRent)}`}</td>
                      <td className="px-4 py-2 font-medium">{row.missing?"—":`₪${fmt(row.indexedRent)}`}</td>
                      <td className={`px-4 py-2 font-bold ${!row.missing&&row.diff>0?"text-green-700":"text-slate-500"}`}>{row.missing?"—":`₪${fmt(row.diff)}`}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 border-t-2 font-bold"><td colSpan={4} className="px-4 py-2">סה&quot;כ</td><td className={`px-4 py-2 text-lg ${r.total>0?"text-green-700":"text-red-600"}`}>₪{fmt(r.total)}</td></tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab==="current_rent" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b"><h2 className="font-bold text-slate-700">שכ&quot;ד עדכני לכל חוזה</h2></div>
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b"><tr><th className="px-4 py-3">שוכר</th><th className="px-4 py-3">נכס</th><th className="px-4 py-3">מדד בסיס</th><th className="px-4 py-3">מדד עדכני</th><th className="px-4 py-3">שכ&quot;ד חוזה</th><th className="px-4 py-3">שכ&quot;ד מוצמד</th><th className="px-4 py-3">שינוי</th></tr></thead>
            <tbody>
              {loading?<tr><td colSpan={7} className="py-8 text-center text-slate-400">טוען...</td></tr>
              :contracts.filter(c=>c.index_base_value&&c.charged_area).map(c=>{
                const latestCpi=cpiRecords[cpiRecords.length-1];
                const indexed=latestCpi?c.rent_per_sqm*(latestCpi.value/c.index_base_value)*c.charged_area:null;
                const base=c.rent_per_sqm*c.charged_area;
                const pct=indexed?((indexed/base-1)*100):null;
                return(<tr key={c.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{c.tenants?.legal_name??c.tenants?.name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.properties?.name}</td>
                  <td className="px-4 py-3">{c.index_base_value} <span className="text-xs text-slate-400">({fmtDate(c.index_base_month)})</span></td>
                  <td className="px-4 py-3">{latestCpi?latestCpi.value:<span className="text-orange-500 text-xs">חסר</span>}</td>
                  <td className="px-4 py-3">₪{fmt(base)}</td>
                  <td className="px-4 py-3 font-bold text-green-700">{indexed?`₪${fmt(indexed)}`:"—"}</td>
                  <td className="px-4 py-3">{pct!==null&&<span className={`text-xs font-bold ${pct>0?"text-red-500":"text-green-600"}`}>{pct>0?"▲":"▼"}{Math.abs(pct).toFixed(1)}%</span>}</td>
                </tr>);
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab==="billing" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-700 mb-2">חיובי נכס לפי יחס שטח</h2>
            <p className="text-sm text-slate-500 mb-4">חלוקת עלויות ביטוח, ניהול ואשפה בין שוכרים לפי שטח</p>
            <div className="flex gap-4 items-end flex-wrap">
              <div className="flex-1 min-w-48">
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={billingProp} onChange={e => setBillingProp(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none">
                  <option value="">בחר נכס</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
                <input type="number" value={billingYear} onChange={e => setBillingYear(e.target.value)} className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none" />
              </div>
              <button onClick={calcBilling} disabled={billingCalc} className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800 disabled:opacity-50">{billingCalc?"מחשב...":"🧮 חשב חיובים"}</button>
            </div>
          </div>
          {billingTotal && (<>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[{l:"שטח כולל",v:`${billingTotal.totalArea?.toLocaleString()} מ"ר`,c:"bg-slate-50"},{l:"ביטוח שנתי",v:`₪${fmt(billingTotal.annualInsurance)}`,c:"bg-blue-50"},{l:"ניהול שנתי",v:`₪${fmt(billingTotal.annualMgmt)}`,c:"bg-purple-50"},{l:"אשפה שנתי",v:`₪${fmt(billingTotal.annualWaste)}`,c:"bg-green-50"}].map((s,i)=>(
                <div key={i} className={`rounded-xl border border-slate-200 ${s.c} p-4`}><div className="text-xs text-slate-500 mb-1">{s.l}</div><div className="font-bold text-slate-800">{s.v}</div></div>
              ))}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50 flex justify-between">
                <h3 className="font-bold text-slate-700">פירוט לפי שוכר</h3>
                <span className="text-sm text-slate-500">סה&quot;כ חודשי: <strong>₪{fmt(billingTotal.totalMonthly)}</strong></span>
              </div>
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b">
                  <tr><th className="px-4 py-2">שוכר</th><th className="px-4 py-2">יחידה</th><th className="px-4 py-2">שטח</th><th className="px-4 py-2">%</th><th className="px-4 py-2">ביטוח/חודש</th><th className="px-4 py-2">ניהול/חודש</th><th className="px-4 py-2">אשפה/חודש</th><th className="px-4 py-2 font-bold">סה&quot;כ/חודש</th><th className="px-4 py-2">סה&quot;כ/שנה</th></tr>
                </thead>
                <tbody>
                  {billingResults.map((r,i)=>(
                    <tr key={i} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold">{r.tenant}</td>
                      <td className="px-4 py-3 text-slate-500">{r.unit}</td>
                      <td className="px-4 py-3">{r.area?.toLocaleString()}</td>
                      <td className="px-4 py-3"><span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-bold">{r.ratio}%</span></td>
                      <td className="px-4 py-3 text-blue-700">₪{fmt(r.insuranceMonthly)}</td>
                      <td className="px-4 py-3 text-purple-700">₪{fmt(r.mgmtMonthly)}</td>
                      <td className="px-4 py-3 text-green-700">₪{fmt(r.wasteMonthly)}</td>
                      <td className="px-4 py-3 font-bold">₪{fmt(r.monthlyShare)}</td>
                      <td className="px-4 py-3 text-slate-600">₪{fmt(r.annualShare)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-slate-50 font-bold"><td colSpan={7} className="px-4 py-3">סה&quot;כ</td><td className="px-4 py-3 text-lg">₪{fmt(billingTotal.totalMonthly)}</td><td className="px-4 py-3">₪{fmt(billingTotal.totalMonthly*12)}</td></tr>
                </tbody>
              </table>
            </div>
          </>)}
        </div>
      )}
    </div>
  );
}
