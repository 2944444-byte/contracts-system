"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function csvDownload(filename: string, rows: any[][], headers: string[]) {
  const bom  = "\uFEFF";
  const lines = [headers.join(","), ...rows.map(function(r) {
    return r.map(function(v) { return '"' + String(v ?? "").replace(/"/g,'""') + '"'; }).join(",");
  })];
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function CashflowPage() {
  const [year,      setYear]      = useState(new Date().getFullYear());
  const [loading,   setLoading]   = useState(true);
  const [contracts, setContracts] = useState<any[]>([]);
  const [charges,   setCharges]   = useState<any[]>([]);
  const [mgmtFees,  setMgmtFees]  = useState<any[]>([]);

  useEffect(function() { loadAll(); }, [year]);

  async function loadAll() {
    setLoading(true);
    const from = `${year}-01-01`;
    const to   = `${year}-12-31`;
    const [{ data: c }, { data: ch }, { data: m }] = await Promise.all([
      supabase.from("contracts")
        .select("id, status, start_date, end_date, rent_per_sqm, charged_area, investment_addition, vat_type, tenants(name), properties(name)")
        .in("status", ["active","expiring","extended"]),
      supabase.from("charges")
        .select("id, total_amount, base_amount, vat_amount, charge_type, billing_period_start, status, contracts(tenants(name), properties(name))")
        .gte("billing_period_start", from).lte("billing_period_start", to)
        .order("billing_period_start"),
      supabase.from("management_fees")
        .select("id, final_amount, month, status")
        .gte("month", from).lte("month", to)
        .order("month"),
    ]);
    setContracts(c ?? []);
    setCharges(ch ?? []);
    setMgmtFees(m ?? []);
    setLoading(false);
  }

  // חשב הכנסה חודשית צפויה לכל חוזה
  function expectedMonthly(c: any, month: number): number {
    const start = new Date(c.start_date);
    const end   = new Date(c.end_date);
    const d     = new Date(year, month, 1);
    if (d < start || d > end) return 0;
    return (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
  }

  // נתונים לכל חודש
  const monthlyData = Array.from({ length: 12 }, function(_, m) {
    const expected = contracts.reduce(function(s, c) { return s + expectedMonthly(c, m); }, 0);
    const billed   = charges.filter(function(ch) {
      return new Date(ch.billing_period_start).getMonth() === m;
    }).reduce(function(s, ch) { return s + (ch.base_amount ?? 0); }, 0);
    const vatBilled = charges.filter(function(ch) {
      return new Date(ch.billing_period_start).getMonth() === m;
    }).reduce(function(s, ch) { return s + (ch.vat_amount ?? 0); }, 0);
    const paid = charges.filter(function(ch) {
      return new Date(ch.billing_period_start).getMonth() === m && ch.status === "paid";
    }).reduce(function(s, ch) { return s + (ch.base_amount ?? 0); }, 0);
    const mgmt = mgmtFees.filter(function(mf) {
      return new Date(mf.month).getMonth() === m;
    }).reduce(function(s, mf) { return s + (mf.final_amount ?? 0); }, 0);
    const total = billed + mgmt;
    return { month: m, expected, billed, vatBilled, paid, mgmt, total };
  });

  const totalExpected = monthlyData.reduce(function(s, m) { return s + m.expected; }, 0);
  const totalBilled   = monthlyData.reduce(function(s, m) { return s + m.billed; }, 0);
  const totalPaid     = monthlyData.reduce(function(s, m) { return s + m.paid; }, 0);
  const totalMgmt     = monthlyData.reduce(function(s, m) { return s + m.mgmt; }, 0);
  const maxBar        = Math.max(...monthlyData.map(function(m) { return m.expected; }), 1);

  function handleCSV() {
    const rows = monthlyData.map(function(m) {
      return [
        MONTHS_HE[m.month],
        Math.round(m.expected),
        Math.round(m.billed),
        Math.round(m.vatBilled),
        Math.round(m.paid),
        Math.round(m.mgmt),
        Math.round(m.total),
      ];
    });
    csvDownload(`תזרים_${year}.csv`, rows, ["חודש","צפוי","חויב (ללא מעמ)","מעמ","שולם","דמי ניהול","סה\"כ"]);
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">תזרים כספי שנתי</h1>
          <p className="text-sm text-slate-500 mt-1">הכנסות צפויות מול בפועל | שנת {year}</p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={function(){setYear(year-1);}} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50">←</button>
          <span className="font-bold text-slate-800 w-14 text-center">{year}</span>
          <button onClick={function(){setYear(year+1);}} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50">→</button>
          <button onClick={handleCSV} className="rounded-lg bg-slate-700 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800">⬇ CSV</button>
        </div>
      </div>

      {/* KPI שנתי */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "הכנסה צפויה",    value: totalExpected, color: "text-slate-800",   bg: "bg-white",      border: "border-slate-200"  },
          { label: "חויב בפועל",     value: totalBilled,   color: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-100"   },
          { label: "שולם בפועל",     value: totalPaid,     color: "text-green-700",   bg: "bg-green-50",   border: "border-green-100"  },
          { label: "דמי ניהול",      value: totalMgmt,     color: "text-purple-700",  bg: "bg-purple-50",  border: "border-purple-100" },
        ].map(function(k) {
          return (
            <div key={k.label} className={"rounded-xl border p-4 " + k.bg + " " + k.border}>
              <div className={"text-2xl font-black " + k.color}>₪{Math.round(k.value).toLocaleString()}</div>
              <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
              <div className="text-xs text-slate-400">שנת {year}</div>
            </div>
          );
        })}
      </div>

      {/* גרף עמודות */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 mb-5">
        <div className="text-sm font-semibold text-slate-700 mb-4">הכנסה חודשית — צפוי מול חויב</div>
        <div className="flex items-end gap-1.5 h-40">
          {monthlyData.map(function(m) {
            const expectedH = (m.expected / maxBar) * 100;
            const billedH   = (m.billed   / maxBar) * 100;
            const isCurrentMonth = m.month === new Date().getMonth() && year === new Date().getFullYear();
            return (
              <div key={m.month} className={"flex-1 flex flex-col items-center gap-0.5 group " + (isCurrentMonth ? "opacity-100" : "opacity-80 hover:opacity-100")}>
                <div className="w-full flex items-end gap-0.5" style={{ height: "120px" }}>
                  {/* צפוי */}
                  <div className={"flex-1 rounded-t-sm bg-slate-200 transition-all " + (isCurrentMonth ? "bg-blue-200" : "")}
                    style={{ height: expectedH + "%" }} title={`צפוי: ₪${Math.round(m.expected).toLocaleString()}`} />
                  {/* חויב */}
                  <div className={"flex-1 rounded-t-sm bg-blue-500 transition-all " + (isCurrentMonth ? "bg-blue-600" : "")}
                    style={{ height: billedH + "%" }} title={`חויב: ₪${Math.round(m.billed).toLocaleString()}`} />
                </div>
                <div className={"text-[9px] text-slate-500 " + (isCurrentMonth ? "font-bold text-blue-600" : "")}>
                  {MONTHS_HE[m.month].substring(0,3)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-slate-500">
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-slate-200" />צפוי</div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-blue-500" />חויב</div>
        </div>
      </div>

      {/* טבלה חודשית */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center">
          <span className="font-semibold text-slate-700">פירוט חודשי</span>
        </div>
        {loading ? (
          <div className="py-8 text-center text-slate-400">טוען...</div>
        ) : (
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b text-xs">
              <tr>
                <th className="px-4 py-2.5 font-semibold">חודש</th>
                <th className="px-4 py-2.5 font-semibold">צפוי</th>
                <th className="px-4 py-2.5 font-semibold">חויב</th>
                <th className="px-4 py-2.5 font-semibold">מע"מ</th>
                <th className="px-4 py-2.5 font-semibold">שולם</th>
                <th className="px-4 py-2.5 font-semibold">דמי ניהול</th>
                <th className="px-4 py-2.5 font-semibold">סה"כ</th>
                <th className="px-4 py-2.5 font-semibold">גביה %</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map(function(m) {
                const collectionRate = m.billed > 0 ? Math.round(m.paid / m.billed * 100) : 0;
                const isCurrentMonth = m.month === new Date().getMonth() && year === new Date().getFullYear();
                return (
                  <tr key={m.month} className={"border-t border-slate-100 " + (isCurrentMonth ? "bg-blue-50 font-semibold" : "hover:bg-slate-50")}>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{MONTHS_HE[m.month]}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {m.expected > 0 ? "₪" + Math.round(m.expected).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-blue-700 font-semibold">
                      {m.billed > 0 ? "₪" + Math.round(m.billed).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {m.vatBilled > 0 ? "₪" + Math.round(m.vatBilled).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-green-700 font-semibold">
                      {m.paid > 0 ? "₪" + Math.round(m.paid).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-purple-700">
                      {m.mgmt > 0 ? "₪" + Math.round(m.mgmt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-slate-800">
                      {m.total > 0 ? "₪" + Math.round(m.total).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {m.billed > 0 && (
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 bg-slate-100 rounded-full h-1.5">
                            <div className={"h-1.5 rounded-full " + (collectionRate >= 80 ? "bg-green-500" : collectionRate >= 50 ? "bg-yellow-400" : "bg-red-400")}
                              style={{ width: collectionRate + "%" }} />
                          </div>
                          <span className={"text-xs font-semibold " + (collectionRate >= 80 ? "text-green-700" : collectionRate >= 50 ? "text-yellow-600" : "text-red-600")}>
                            {collectionRate}%
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* שורת סיכום */}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-black">
                <td className="px-4 py-2.5 text-slate-800">סה"כ {year}</td>
                <td className="px-4 py-2.5 text-slate-700">₪{Math.round(totalExpected).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-blue-700">₪{Math.round(totalBilled).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-slate-500">₪{Math.round(monthlyData.reduce(function(s,m){return s+m.vatBilled;},0)).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-green-700">₪{Math.round(totalPaid).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-purple-700">₪{Math.round(totalMgmt).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-slate-800">₪{Math.round(totalBilled+totalMgmt).toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  {totalBilled > 0 && (
                    <span className="text-green-700">{Math.round(totalPaid/totalBilled*100)}%</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
