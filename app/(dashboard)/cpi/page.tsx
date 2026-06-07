"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני",
                   "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export default function CpiPage() {
  const [records,     setRecords]     = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from("cpi_records")
      .select("*")
      .order("year", { ascending: false })
      .order("month", { ascending: false });
    setRecords(data ?? []);
    if (data?.length) {
      const latest = data[0];
      setLastUpdated(`${MONTHS_HE[latest.month-1]} ${latest.year}`);
    }
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const year = new Date().getFullYear();
      const res = await fetch(`/api/cpi?from_year=2015&to_year=${year}&refresh=true`);
      const data = await res.json();
      alert("עודכן — " + (data.inserted ?? 0) + " רשומות חדשות");
      await load();
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
    } finally { setRefreshing(false); }
  }

  const byYear: Record<number, Record<number, number>> = {};
  records.forEach(r => {
    if (!byYear[r.year]) byYear[r.year] = {};
    byYear[r.year][r.month] = r.value;
  });
  const years = Object.keys(byYear).map(Number).sort((a,b) => b-a);

  // חישוב שינויים
  function getChange(year: number, month: number): number | null {
    const current = byYear[year]?.[month];
    if (!current) return null;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;
    const prev = byYear[prevYear]?.[prevMonth];
    if (!prev) return null;
    return ((current - prev) / prev) * 100;
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">מדד המחירים לצרכן</h1>
          <p className="text-sm text-slate-500 mt-1">
            {lastUpdated ? `מדד אחרון: ${lastUpdated}` : "טוען..."} | סדרה 120010 | בסיס 2022=100
          </p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {refreshing ? "⟳ מעדכן..." : "🔄 עדכן מ-API"}
        </button>
      </div>

      {/* הסבר */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 mb-5 text-sm text-blue-800">
        <div className="font-bold mb-1">כלל t-2 — כיצד מחושב המדד הקובע?</div>
        <div className="text-xs space-y-0.5">
          <div>הלמ&quot;ס מפרסם ב-15 לכל חודש את מדד החודש הקודם.</div>
          <div>לכן: תשלום ב-<strong>1 במרץ 2026</strong> → מדד קובע = <strong>ינואר 2026</strong> (שפורסם ב-15.2)</div>
          <div>לחישוב: <a href="https://api.cbs.gov.il/index/data/calculator/120010" target="_blank" rel="noopener noreferrer" className="underline">מחשבון הלמ&quot;ס הרשמי ↗</a></div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : records.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📈</div>
          <div className="mb-3">אין נתוני מדד</div>
          <button onClick={handleRefresh} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">
            משוך מדדים מ-API הלמ&quot;ס
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-800 text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold text-sm">שנה</th>
                  {MONTHS_HE.map(m => (
                    <th key={m} className="px-2 py-3 font-semibold text-center">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map(year => (
                  <tr key={year} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-bold text-slate-800 text-sm">{year}</td>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
                      const val    = byYear[year]?.[m];
                      const change = getChange(year, m);
                      return (
                        <td key={m} className="px-2 py-2 text-center">
                          {val ? (
                            <div>
                              <div className="font-semibold text-slate-800">{val.toFixed(1)}</div>
                              {change !== null && (
                                <div className={`text-xs ${change > 0 ? "text-red-500" : change < 0 ? "text-green-600" : "text-slate-400"}`}>
                                  {change > 0 ? "+" : ""}{change.toFixed(1)}%
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-200">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
            <span>{records.length} רשומות | בסיס 2022=100</span>
            <span>מקור: הלשכה המרכזית לסטטיסטיקה</span>
          </div>
        </div>
      )}
    </div>
  );
}
