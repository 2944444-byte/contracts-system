"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { fetchCPI, fetchHighestCPI, calcIndexedRent, getT2Month, formatPeriod } from '@/lib/cpi-utils';

function fmtMoney(n: number) { return "âª" + Math.round(n ?? 0).toLocaleString(); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "â"; }

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
      .select("id, index_base_value, index_base_date, rent_per_sqm, charged_area, investment_addition, index_mechanism, vat_type, tenants(name), properties(name)")
      .in("status", ["active","expiring","extended"])
      .not("index_base_value", "is", null);
    setContracts(data ?? []);
    setLoading(false);
  }

  async function fetchCurrentCPI() {
    setCpiLoading(true);
    try {
      const now = new Date();
      const { year, month } = getT2Month(now);
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
      const { year, month } = getT2Month(date);
      let currentIdx: number | null;

      if (c.index_mechanism === "highest_in_period" && c.index_base_date) {
        const baseDate = new Date(c.index_base_date);
        currentIdx = await fetchHighestCPI(
          baseDate.getFullYear(), baseDate.getMonth()+1, year, month
        );
      } else {
        currentIdx = await fetchCPI(year, month);
      }

      if (!currentIdx) { alert("×× × ××ª× ××©×××£ ××× ××-CBS"); return; }

      const baseRent    = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
      const indexedRent = calcIndexedRent(baseRent, c.index_base_value, currentIdx);
      const change      = ((currentIdx / c.index_base_value) - 1) * 100;
      const vat         = c.vat_type==="taxable" ? indexedRent*0.18 : 0;

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
    } catch(e:any) { alert("×©××××: "+e?.message); }
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
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">××¦××× ××××</h1>
          <p className="text-sm text-slate-500 mt-1">
            {cpiLoading ? "×××¢× ×××..." : currentCPI ? (
              <span>××× × ××××: <strong className="text-blue-700">{currentCPI}</strong> | {cpiPeriod}</span>
            ) : "×× × ××ª× ××©×××£ ×××"}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div>
            <label className="text-xs text-slate-500 block mb-1">×ª××¨×× ×ª×©×××</label>
            <input type="date" value={paymentDate}
              onChange={function(e){setPaymentDate(e.target.value);setResults({});}}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
          </div>
          <button onClick={calcAll} disabled={!!calculating || contracts.length===0}
            className="self-end rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {calculating==="all" ? "â³ ×××©×..." : "â¡ ××©× ×××"}
          </button>
        </div>
      </div>

      {/* CBS Banner */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 mb-5 text-sm flex items-center gap-2">
        <span className="text-xl">ð</span>
        <div>
          <span className="font-semibold text-blue-800">CBS API ××</span>
          <span className="text-blue-600 mr-2">â × ×ª×× ×× ×××× ×××ª ×××× ×××××¨×× ××¦×¨×× ×©× ×××"×¡</span>
        </div>
        {currentCPI && (
          <span className="mr-auto text-blue-700 font-bold">××× {cpiPeriod}: {currentCPI}</span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">×××¢× ×××××...</div>
      ) : contracts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">ð</div>
          <div>××× ××××× ×¢× ××× ××¡××¡</div>
          <div className="text-xs mt-2">××××¨ ××× ××¡××¡ ××××× ××× ×××©× ××¦×××</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">×©×××¨ / × ××¡</th>
                <th className="px-4 py-3 font-semibold text-slate-700">×©×"× ××¡××¡</th>
                <th className="px-4 py-3 font-semibold text-slate-700">××× ××¡××¡</th>
                <th className="px-4 py-3 font-semibold text-slate-700">×©×××</th>
                <th className="px-4 py-3 font-semibold text-slate-700">×©×"× ×××¦××</th>
                <th className="px-4 py-3 font-semibold text-slate-700">×©×× ××</th>
                <th className="px-4 py-3 font-semibold text-slate-700">×¤×¢×××</th>
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
                      <div className="text-xs text-slate-400">{fmtDate(c.index_base_date)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (c.index_mechanism==="highest_in_period"?"bg-purple-100 text-purple-700":"bg-slate-100 text-slate-600")}>
                        {c.index_mechanism==="highest_in_period"?"×××× ××××ª×¨":"t-2"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {res ? (
                        <div>
                          <div className="font-black text-green-700">{fmtMoney(res.indexedRent)}</div>
                          <div className="text-xs text-slate-400">+ ××¢"×: {fmtMoney(res.indexedRent + res.vat)}</div>
                          <div className="text-xs text-slate-400">××× {res.period}: {res.currentIdx}</div>
                        </div>
                      ) : (
                        <span className="text-slate-300">â</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {res ? (
                        <span className={"font-bold text-sm " + (res.change>=0?"text-green-600":"text-red-600")}>
                          {res.change >= 0 ? "+" : ""}{res.change.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-slate-300">â</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={function(){calcForContract(c);}}
                        disabled={isCalc || calculating==="all"}
                        className="rounded-lg bg-blue-600 text-white text-xs px-3 py-1.5 font-semibold hover:bg-blue-700 disabled:opacity-50">
                        {isCalc ? "â³" : "××©×"}
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
