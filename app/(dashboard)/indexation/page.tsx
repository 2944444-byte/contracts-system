"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { fetchCPI, fetchHighestCPI, calcIndexedRent, calcChainingCoefficient, getKnownIndexMonth, formatPeriod } from '@/lib/cpi-utils';
import { getVatPctForDate } from '@/lib/vat';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';

function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

export default function IndexationPage() {
  const [contracts,    setContracts]    = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [calculating,  setCalculating]  = useState<string | null>(null);
  const [results,      setResults]      = useState<Record<string,any>>({});
  const [currentCPI,   setCurrentCPI]   = useState<number | null>(null);
  const [cpiPeriod,    setCpiPeriod]    = useState("");
  const [cpiLoading,   setCpiLoading]   = useState(false);
  const [paymentDate,  setPaymentDate]  = useState(new Date().toISOString().slice(0,7) + "-01");

  useEffect(function() { loadContracts(); fetchCurrentCPI(); }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts")
      .select("id, property_id, index_base_value, index_base_date, rent_per_sqm, charged_area, investment_addition, index_mechanism, vat_type, tenants(name), properties(name)")
      .in("status", ["active","expiring","extended"])
      .not("index_base_value", "is", null);
    var scope = await getScopeIds();
    setContracts(scopeRows(data ?? [], scope, function(c: any){ return c.property_id; }));
    setLoading(false);
  }

  async function fetchCurrentCPI() {
    setCpiLoading(true);
    try {
      const now = new Date();
      const { year, month } = getKnownIndexMonth(now);
      const val = await fetchCPI(year, month);
      setCurrentCPI(val);
      setCpiPeriod(formatPeriod(year, month) + " (t-2)");
    } catch {}
    finally { setCpiLoading(false); }
  }

  async function calcForContract(c: any) {
    setCalculating(c.id);
    try {
      const date = new Date(paymentDate);
      const { year, month } = getKnownIndexMonth(date);
      let currentIdx: number | null;

      if (c.index_mechanism === "highest_in_period" && c.index_base_date) {
        const baseDate = new Date(c.index_base_date);
        currentIdx = await fetchHighestCPI(
          baseDate.getFullYear(), baseDate.getMonth()+1, year, month
        );
      } else {
        currentIdx = await fetchCPI(year, month);
      }

      if (!currentIdx) { alert("לא ניתן לשלוף מדד מה-CBS"); return; }

      // Get base index record and current index record to determine base years
      const knownBase = getKnownIndexMonth(new Date(c.index_base_date));
      const { data: baseRec } = await supabase.from("cpi_records").select("base_year")
        .eq("year", knownBase.year).eq("month", knownBase.month).single();
      const { data: currentRec } = await supabase.from("cpi_records").select("base_year")
        .eq("year", year).eq("month", month).single();

      // Calculate chaining coefficient between base years
      var chainingCoeff = 1;
      if (baseRec && currentRec) {
        var fromBase = parseInt(String(currentRec.base_year));
        var toBase = parseInt(String(baseRec.base_year));
        if (fromBase !== toBase) {
          const { data: coeffs } = await supabase.from("cpi_link_coefficients")
            .select("from_base_year,to_base_year,coefficient");
          if (coeffs) chainingCoeff = calcChainingCoefficient(fromBase, toBase, coeffs);
        }
      }

      const baseRent    = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
      const indexedRent = calcIndexedRent(baseRent, c.index_base_value, currentIdx, chainingCoeff);
      const change      = ((currentIdx * chainingCoeff / c.index_base_value) - 1) * 100;
      const vatRate     = await getVatPctForDate(date);
      const vat         = c.vat_type==="taxable" ? indexedRent*vatRate : 0;

      setResults(function(prev) {
        return {
          ...prev,
          [c.id]: {
            baseRent, indexedRent, change, currentIdx, vat,
            period: formatPeriod(year, month),
            method: c.index_mechanism,
          }
        };
      });
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setCalculating(null); }
  }

  async function calcAll() {
    setCalculating("all");
    for (const c of contracts) {
      await calcForContract(c);
      await new Promise(function(r){setTimeout(r,400);});
    }
    setCalculating(null);
  }

  return (
    <div dir="rtl">
      <PageHero title="הצמדה למדד" icon="📈" tone="blue"
        subtitle={cpiLoading ? "טוען מדד..." : currentCPI ? (
          <span>מדד נוכחי: <strong className="text-white">{currentCPI}</strong> | {cpiPeriod}</span>
        ) : "לא ניתן לשלוף מדד"} />
      <div className="mb-5 flex gap-2 items-end flex-wrap">
        <div>
          <label className="text-xs text-slate-500 block mb-1">תאריך תשלום</label>
          <input type="date" value={paymentDate}
            onChange={function(e){setPaymentDate(e.target.value);setResults({});}}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
        </div>
        <button onClick={calcAll} disabled={!!calculating || contracts.length===0}
          className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {calculating==="all" ? "⏳ מחשב..." : "⚡ חשב הכל"}
        </button>
      </div>

      {/* CBS Banner */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 mb-5 text-sm flex items-center gap-2">
        <span className="text-xl">📊</span>
        <div>
          <span className="font-semibold text-blue-800">CBS API חי</span>
          <span className="text-blue-600 mr-2">— נתונים בזמן אמת ממדד המחירים לצרכן של הלמ"ס</span>
        </div>
        {currentCPI && (
          <span className="mr-auto text-blue-700 font-bold">מדד {cpiPeriod}: {currentCPI}</span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען חוזים...</div>
      ) : contracts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📈</div>
          <div>אין חוזים עם מדד בסיס</div>
          <div className="text-xs mt-2">הגדר מדד בסיס בחוזה כדי לחשב הצמדה</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-right text-sm min-w-[640px]">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">שכ"ד בסיס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">מדד בסיס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">שיטה</th>
                <th className="px-4 py-3 font-semibold text-slate-700">שכ"ד מוצמד</th>
                <th className="px-4 py-3 font-semibold text-slate-700">שינוי</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(function(c) {
                const baseRent = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
                const res = results[c.id];
                const isCalc = calculating === c.id;
                return (
                  <tr key={c.id} className={"border-t border-slate-100 " + (res?"bg-green-50":"hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{c.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{c.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{fmtMoney(baseRent)}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-700">{c.index_base_value}</div>
                      <div className="text-xs text-blue-600 font-semibold">📊 מדד {c.index_base_date ? formatPeriod(new Date(c.index_base_date).getFullYear(), new Date(c.index_base_date).getMonth()+1) : ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (c.index_mechanism==="highest_in_period"?"bg-purple-100 text-purple-700":"bg-slate-100 text-slate-600")}>
                        {c.index_mechanism==="highest_in_period"?"גבוה ביותר":"t-2"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {res ? (
                        <div>
                          <div className="font-black text-green-700">{fmtMoney(res.indexedRent)}</div>
                          <div className="text-xs text-slate-400">+ מע"מ: {fmtMoney(res.indexedRent + res.vat)}</div>
                          <div className="text-xs text-blue-600 font-semibold">📊 מדד {res.period} = {res.currentIdx}</div>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {res ? (
                        <span className={"font-bold text-sm " + (res.change>=0?"text-green-600":"text-red-600")}>
                          {res.change >= 0 ? "+" : ""}{res.change.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={function(){calcForContract(c);}}
                        disabled={isCalc || calculating==="all"}
                        className="rounded-lg bg-blue-600 text-white text-xs px-3 py-1.5 font-semibold hover:bg-blue-700 disabled:opacity-50">
                        {isCalc ? "⏳" : "חשב"}
                      </button>
                    </td>
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
