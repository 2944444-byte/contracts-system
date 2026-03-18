"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

function fmtMoney(n: number) { return "₪" + Math.round(n ?? 0).toLocaleString(); }

const MONTHS_HE = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export default function CashflowPage() {
  const [year,       setYear]       = useState(new Date().getFullYear());
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [charges,    setCharges]    = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(function() { loadAll(); }, [year]);

  async function loadAll() {
    setLoading(true);
    const [{ data: c }, { data: ch }] = await Promise.all([
      supabase.from("contracts")
        .select("id, rent_per_sqm, charged_area, investment_addition, vat_type, status, start_date, end_date, tenants(name), properties(name)")
        .in("status",["active","expiring","extended","upcoming"]),
      supabase.from("charges")
        .select("id, billing_period_start, total_amount, status, charge_type")
        .gte("billing_period_start", year+"-01-01")
        .lte("billing_period_start", year+"-12-31"),
    ]);
    setContracts(c ?? []);
    setCharges(ch ?? []);
    setLoading(false);
  }

  // חשב הכנסה חודשית לכל חוזה
  function contractMonthly(c: any) {
    const base = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
    const vat  = c.vat_type==="taxable" ? base*0.18 : 0;
    return { base, withVat: base+vat };
  }

  // בנה נתוני חודש
  function monthData(month: number) {
    const from = new Date(year, month-1, 1);
    const to   = new Date(year, month, 0);

    // חוזים פעילים בחודש זה
    const active = contracts.filter(function(c) {
      if (!c.start_date || !c.end_date) return c.status==="active";
      const cs = new Date(c.start_date);
      const ce = new Date(c.end_date);
      return cs <= to && ce >= from;
    });

    const potential = active.reduce(function(s,c) { return s+contractMonthly(c).withVat; },0);

    // חיובים ששולמו
    const paid = charges
      .filter(function(ch) { return ch.billing_period_start?.startsWith(year+"-"+String(month).padStart(2,"0")); })
      .filter(function(ch) { return ch.status==="paid"; })
      .reduce(function(s,ch) { return s+(ch.total_amount??0); }, 0);

    const pct = potential > 0 ? Math.round(paid/potential*100) : 0;
    return { potential, paid, pct, activeCount: active.length };
  }

  const months = Array.from({length:12},function(_,i){return i+1;});
  const monthlyData = months.map(function(m) { return { month:m, ...monthData(m) }; });

  const totalPotential = monthlyData.reduce(function(s,m){return s+m.potential;},0);
  const totalPaid      = monthlyData.reduce(function(s,m){return s+m.paid;},0);
  const avgPct         = totalPotential>0 ? Math.round(totalPaid/totalPotential*100) : 0;
  const maxVal         = Math.max(...monthlyData.map(function(m){return m.potential;}), 1);

  // CSV Export
  function exportCSV() {
    const bom   = "\uFEFF";
    const header = "חודש,הכנסה פוטנציאלית,גבייה בפועל,% גבייה,חוזים פעילים";
    const rows   = monthlyData.map(function(m) {
      return [MONTHS_HE[m.month]+" "+year, Math.round(m.potential), Math.round(m.paid), m.pct+"%", m.activeCount].join(",");
    });
    const csv = bom + [header, ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const a = document.createElement("a"); a.href=url; a.download=`תזרים_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">תזרים שנתי</h1>
          <p className="text-sm text-slate-500 mt-1">
            פוטנציאל: {fmtMoney(totalPotential)} | גבייה: {fmtMoney(totalPaid)} | ממוצע גבייה: <strong className={avgPct>=90?"text-green-600":avgPct>=70?"text-yellow-600":"text-red-600"}>{avgPct}%</strong>
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={function(){setYear(year-1);}} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-600 hover:bg-slate-50">←</button>
          <span className="text-lg font-bold text-slate-700 w-16 text-center">{year}</span>
          <button onClick={function(){setYear(year+1);}} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-600 hover:bg-slate-50">→</button>
          <button onClick={exportCSV} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">⬇ CSV</button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          {label:"הכנסה שנתית פוטנציאלית", value:fmtMoney(totalPotential), color:"text-slate-800"},
          {label:"גבייה בפועל",            value:fmtMoney(totalPaid),      color:"text-green-700"},
          {label:"ממוצע גבייה שנתי",       value:avgPct+"%",               color:avgPct>=90?"text-green-700":avgPct>=70?"text-yellow-600":"text-red-600"},
        ].map(function(k) {
          return (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{k.label}</div>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <>
          {/* גרף עמודות */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 mb-4">
            <div className="text-xs font-semibold text-slate-500 mb-4">הכנסה חודשית (₪)</div>
            <div className="flex items-end gap-1 h-48">
              {monthlyData.map(function(m) {
                const h  = maxVal > 0 ? Math.round((m.potential/maxVal)*100) : 0;
                const hp = maxVal > 0 ? Math.round((m.paid/maxVal)*100) : 0;
                const isNow = m.month === new Date().getMonth()+1 && year === new Date().getFullYear();
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-slate-800 text-white text-xs rounded-lg p-2 whitespace-nowrap text-right">
                      <div>{MONTHS_HE[m.month]}</div>
                      <div>פוטנציאל: {fmtMoney(m.potential)}</div>
                      <div>גבייה: {fmtMoney(m.paid)}</div>
                      <div>% גבייה: {m.pct}%</div>
                    </div>
                    {/* עמודת גבייה */}
                    <div className="w-full flex items-end gap-0.5 h-40">
                      <div className={"flex-1 rounded-t transition-all " + (isNow?"bg-blue-600":"bg-blue-200")}
                        style={{height: h+"%", minHeight: m.potential>0?"4px":"0"}} />
                      <div className={"flex-1 rounded-t transition-all " + (isNow?"bg-green-500":"bg-green-300")}
                        style={{height: hp+"%", minHeight: m.paid>0?"4px":"0"}} />
                    </div>
                    <div className={"text-xs text-center truncate w-full " + (isNow?"font-bold text-blue-700":"text-slate-400")}>
                      {MONTHS_HE[m.month].substring(0,3)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-200 inline-block" /> פוטנציאל</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-300 inline-block" /> גבייה</span>
            </div>
          </div>

          {/* טבלה */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-700">חודש</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">חוזים פעילים</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">פוטנציאל</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">גבייה</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">% גבייה</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData.map(function(m) {
                  const isNow = m.month === new Date().getMonth()+1 && year === new Date().getFullYear();
                  return (
                    <tr key={m.month} className={"border-t border-slate-100 " + (isNow?"bg-blue-50":"hover:bg-slate-50")}>
                      <td className={"px-4 py-2.5 font-semibold " + (isNow?"text-blue-700":"text-slate-800")}>
                        {MONTHS_HE[m.month]} {year}
                        {isNow && <span className="mr-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">נוכחי</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{m.activeCount}</td>
                      <td className="px-4 py-2.5 text-slate-700">{fmtMoney(m.potential)}</td>
                      <td className="px-4 py-2.5 font-semibold text-green-700">{fmtMoney(m.paid)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-2 max-w-20">
                            <div className={"h-2 rounded-full " + (m.pct>=90?"bg-green-500":m.pct>=70?"bg-yellow-400":"bg-red-400")}
                              style={{width:m.pct+"%"}} />
                          </div>
                          <span className={"font-bold text-xs " + (m.pct>=90?"text-green-700":m.pct>=70?"text-yellow-700":"text-red-600")}>
                            {m.pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
