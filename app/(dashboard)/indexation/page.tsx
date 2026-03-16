"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function getT2Month(paymentDate: string): { year: number; month: number; label: string } {
  const d = new Date(paymentDate);
  d.setMonth(d.getMonth() - 2);
  return {
    year:  d.getFullYear(),
    month: d.getMonth() + 1,
    label: d.toLocaleDateString("he-IL", { year: "numeric", month: "long" }),
  };
}

async function fetchCPI(year: number, month: number): Promise<number | null> {
  try {
    const url = `https://api.cbs.gov.il/index/data/price?id=120010&startPeriod=${year}-${String(month).padStart(2,"0")}&endPeriod=${year}-${String(month).padStart(2,"0")}&format=json`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const json = await resp.json();
    const val = json?.DataSet?.Series?.[0]?.obs?.[0]?.obsValue;
    return val ? Number(val) : null;
  } catch { return null; }
}

async function fetchCPIRange(fromYear: number, fromMonth: number, toYear: number, toMonth: number): Promise<{year:number;month:number;value:number}[]> {
  try {
    const from = `${fromYear}-${String(fromMonth).padStart(2,"0")}`;
    const to   = `${toYear}-${String(toMonth).padStart(2,"0")}`;
    const url  = `https://api.cbs.gov.il/index/data/price?id=120010&startPeriod=${from}&endPeriod=${to}&format=json`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const json = await resp.json();
    const obs  = json?.DataSet?.Series?.[0]?.obs ?? [];
    return obs.map(function(o: any) {
      const [y, m] = o.timePeriod.split("-").map(Number);
      return { year: y, month: m, value: Number(o.obsValue) };
    });
  } catch { return []; }
}

export default function IndexationPage() {
  const [contracts,   setContracts]   = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [calcLoading, setCalcLoading] = useState(false);
  const [result,      setResult]      = useState<any>(null);
  const [cpiError,    setCpiError]    = useState("");
  const [history,     setHistory]     = useState<any[]>([]);

  // טופס
  const [contractId,    setContractId]    = useState("");
  const [baseRent,      setBaseRent]      = useState("");
  const [area,          setArea]          = useState("");
  const [baseIndex,     setBaseIndex]     = useState("");
  const [baseIndexDate, setBaseIndexDate] = useState("");
  const [paymentDate,   setPaymentDate]   = useState(new Date().toISOString().split("T")[0]);
  const [vatPct,        setVatPct]        = useState("18");
  const [mgmtFee,       setMgmtFee]       = useState("0");
  // מנגנון מדד גבוה ביותר
  const [useHighestIndex, setUseHighestIndex] = useState(false);
  const [highestIndexData, setHighestIndexData] = useState<{value:number; date:string} | null>(null);

  useEffect(function() { loadContracts(); loadHistory(); }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts")
      .select("id, tenants(name), properties(name), rent_per_sqm, charged_area, base_cpi_value, base_cpi_date, investment_addition, indexation_method")
      .in("status", ["active","expiring","extended"])
      .order("created_at", { ascending: false });
    setContracts(data ?? []);
    setLoading(false);
  }

  async function loadHistory() {
    const { data } = await supabase.from("cpi_records")
      .select("*, contracts(tenants(name), properties(name))")
      .order("created_at", { ascending: false }).limit(20);
    setHistory(data ?? []);
  }

  function fillFromContract(id: string) {
    const c = contracts.find(function(x) { return x.id === id; });
    if (!c) return;
    setBaseRent(c.rent_per_sqm?.toString() ?? "");
    setArea(c.charged_area?.toString() ?? "");
    setBaseIndex(c.base_cpi_value?.toString() ?? "");
    setBaseIndexDate(c.base_cpi_date?.split("T")[0] ?? "");
    setUseHighestIndex(c.indexation_method === "highest_in_period");
  }

  async function handleCalc() {
    if (!baseRent || !area || !baseIndex || !paymentDate) {
      alert("נא למלא: שכ\"ד בסיסי, שטח, מדד בסיס, ותאריך תשלום");
      return;
    }
    setCalcLoading(true); setCpiError(""); setResult(null); setHighestIndexData(null);
    try {
      const t2 = getT2Month(paymentDate);
      let currentIndex: number | null = null;
      let indexLabel = t2.label;
      let isHighest = false;
      let allIndices: {year:number;month:number;value:number}[] = [];

      if (useHighestIndex && baseIndexDate) {
        // שלוף את כל המדדים מהמדד הבסיסי עד t-2
        const baseD = new Date(baseIndexDate);
        allIndices = await fetchCPIRange(
          baseD.getFullYear(), baseD.getMonth() + 1,
          t2.year, t2.month
        );
        if (allIndices.length > 0) {
          const highest = allIndices.reduce(function(max, curr) {
            return curr.value > max.value ? curr : max;
          });
          currentIndex = highest.value;
          indexLabel = `${highest.year}/${highest.month} (גבוה ביותר)`;
          isHighest = true;
          setHighestIndexData({
            value: highest.value,
            date: `${highest.month}/${highest.year}`
          });
        }
      } else {
        currentIndex = await fetchCPI(t2.year, t2.month);
      }

      if (!currentIndex) {
        setCpiError("לא הצלחנו לקבל מדד מהלמס ל-" + t2.label + ". נסה מדד ידני.");
        setCalcLoading(false);
        return;
      }

      const base     = Number(baseIndex);
      const ratio    = currentIndex / base;
      const baseAmt  = Number(baseRent) * Number(area);
      const indexed  = baseAmt * ratio;
      const mgmt     = Number(mgmtFee) * Number(area);
      const vat      = (indexed + mgmt) * (Number(vatPct) / 100);
      const total    = indexed + mgmt + vat;

      const res = {
        baseAmount:    baseAmt,
        indexedAmount: indexed,
        mgmtAmount:    mgmt,
        vatAmount:     vat,
        total:         total,
        ratio:         ratio,
        increase:      (ratio - 1) * 100,
        currentIndex:  currentIndex,
        baseIndex:     base,
        t2Month:       indexLabel,
        paymentDate:   paymentDate,
        vatPct:        Number(vatPct),
        isHighest:     isHighest,
        allIndicesCount: allIndices.length,
      };
      setResult(res);

      if (contractId) {
        await supabase.from("cpi_records").insert({
          contract_id:         contractId,
          base_index_value:    base,
          current_index_value: currentIndex,
          index_ratio:         ratio,
          base_rent_amount:    baseAmt,
          indexed_amount:      indexed,
          billing_date:        paymentDate,
          t2_month:            t2.year + "-" + String(t2.month).padStart(2,"0"),
          notes:               isHighest ? "מדד גבוה ביותר בתקופה" : null,
        });
        loadHistory();
      }
    } catch(e: any) {
      setCpiError("שגיאה בחישוב: " + e?.message);
    } finally {
      setCalcLoading(false);
    }
  }

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">הצמדה למדד</h1>
        <p className="text-sm text-slate-500 mt-1">חישוב שכ"ד מוצמד — מדד חי מ-API הלמס | כלל t-2</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* טופס */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
          <h2 className="font-bold text-slate-800 mb-4 text-lg">🧮 מחשבון הצמדה</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה (אופציונלי)</label>
              <select value={contractId} onChange={function(e) { setContractId(e.target.value); fillFromContract(e.target.value); }} className={ic}>
                <option value="">-- חישוב ידני --</option>
                {contracts.map(function(c) { return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>; })}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שכ"ד (₪/מ"ר)</label>
                <input type="number" value={baseRent} onChange={function(e){setBaseRent(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ"ר)</label>
                <input type="number" value={area} onChange={function(e){setArea(e.target.value);}} className={ic} />
              </div>
            </div>

            {/* מדד בסיס */}
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 space-y-3">
              <div className="text-xs font-bold text-blue-800">📊 נתוני מדד</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מדד בסיס</label>
                  <input type="number" value={baseIndex} onChange={function(e){setBaseIndex(e.target.value);}} className={ic} step="0.1" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך מדד בסיס</label>
                  <input type="date" value={baseIndexDate} onChange={function(e){setBaseIndexDate(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך תשלום</label>
                <input type="date" value={paymentDate} onChange={function(e){setPaymentDate(e.target.value);}} className={ic} />
                {paymentDate && (
                  <div className="text-xs text-blue-600 mt-1">
                    📅 מדד קובע (t-2): {getT2Month(paymentDate).label}
                  </div>
                )}
              </div>
            </div>

            {/* מנגנון מדד גבוה ביותר */}
            <div className={"rounded-xl border p-4 transition-all " +
              (useHighestIndex ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-slate-50")}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={useHighestIndex}
                  onChange={function(e) { setUseHighestIndex(e.target.checked); setHighestIndexData(null); }}
                  className="w-5 h-5 accent-orange-600" />
                <div>
                  <div className={"font-semibold text-sm " + (useHighestIndex ? "text-orange-800" : "text-slate-700")}>
                    📈 מדד הגבוה ביותר בתקופה
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    בדוק כל המדדים מהמדד הבסיסי עד t-2 — קח את הגבוה ביותר
                  </div>
                </div>
              </label>
              {useHighestIndex && !baseIndexDate && (
                <div className="text-xs text-orange-600 mt-2">⚠️ נדרש תאריך מדד בסיס לחישוב זה</div>
              )}
              {highestIndexData && (
                <div className="mt-2 rounded-lg bg-orange-100 p-2 text-xs text-orange-800">
                  🏆 המדד הגבוה ביותר: <strong>{highestIndexData.value}</strong> ({highestIndexData.date})
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ %</label>
                <input type="number" value={vatPct} onChange={function(e){setVatPct(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול (₪/מ"ר)</label>
                <input type="number" value={mgmtFee} onChange={function(e){setMgmtFee(e.target.value);}} className={ic} />
              </div>
            </div>

            <button onClick={handleCalc} disabled={calcLoading}
              className={"w-full rounded-xl py-3 font-bold text-white text-sm disabled:opacity-50 transition-colors " +
                (useHighestIndex ? "bg-orange-600 hover:bg-orange-700" : "bg-blue-700 hover:bg-blue-800")}>
              {calcLoading
                ? (useHighestIndex ? "שולף מדדים מהלמס..." : "מחשב — מקבל מדד...")
                : (useHighestIndex ? "📈 חשב לפי מדד גבוה ביותר" : "🧮 חשב הצמדה")}
            </button>

            {cpiError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                ⚠️ {cpiError}
              </div>
            )}

            {/* תוצאה */}
            {result && (
              <div className={"mt-2 rounded-xl border p-5 " +
                (result.isHighest ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200")}>
                <div className={"font-bold text-base mb-3 " + (result.isHighest ? "text-orange-800" : "text-green-800")}>
                  {result.isHighest ? "📈 תוצאה — מדד גבוה ביותר" : "✅ תוצאת חישוב"}
                </div>
                {result.isHighest && (
                  <div className="text-xs text-orange-700 mb-3 bg-orange-100 rounded-lg p-2">
                    נבדקו {result.allIndicesCount} חודשים — נלקח המדד הגבוה ביותר
                  </div>
                )}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">מדד בסיס</span>
                    <span className="font-mono">{result.baseIndex.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">{result.isHighest ? "מדד גבוה ביותר" : "מדד נוכחי"} ({result.t2Month})</span>
                    <span className={"font-mono font-bold " + (result.isHighest ? "text-orange-700" : "")}>
                      {result.currentIndex.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">שינוי מדד</span>
                    <span className={"font-bold " + (result.increase >= 0 ? "text-red-600" : "text-green-600")}>
                      {result.increase >= 0 ? "+" : ""}{result.increase.toFixed(2)}%
                    </span>
                  </div>
                  <hr className={"my-2 " + (result.isHighest ? "border-orange-200" : "border-green-200")} />
                  <div className="flex justify-between">
                    <span className="text-slate-600">שכ"ד בסיס</span>
                    <span>₪{Math.round(result.baseAmount).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">שכ"ד מוצמד</span>
                    <span className="font-bold">₪{Math.round(result.indexedAmount).toLocaleString()}</span>
                  </div>
                  {result.mgmtAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">דמי ניהול</span>
                      <span>₪{Math.round(result.mgmtAmount).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-600">מע"מ ({result.vatPct}%)</span>
                    <span>₪{Math.round(result.vatAmount).toLocaleString()}</span>
                  </div>
                  <hr className={"my-2 " + (result.isHighest ? "border-orange-200" : "border-green-200")} />
                  <div className={"flex justify-between text-base font-black " + (result.isHighest ? "text-orange-800" : "text-green-800")}>
                    <span>סה"כ לתשלום</span>
                    <span>₪{Math.round(result.total).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* היסטוריה */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-800">📋 היסטוריית חישובים</h2>
          </div>
          {history.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">חישובים שמורים יופיעו כאן</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.map(function(h) {
                const increase = ((h.index_ratio - 1) * 100).toFixed(2);
                const isHighest = h.notes?.includes("גבוה");
                return (
                  <div key={h.id} className={"px-5 py-3 hover:bg-slate-50 " + (isHighest ? "border-r-2 border-r-orange-400" : "")}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">
                          {h.contracts?.tenants?.name ?? "חישוב ידני"}
                          {isHighest && <span className="mr-1 text-xs bg-orange-100 text-orange-700 px-1 rounded">📈 גבוה</span>}
                        </div>
                        <div className="text-xs text-slate-400">
                          {h.billing_date ? new Date(h.billing_date).toLocaleDateString("he-IL") : "—"}
                        </div>
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-bold text-slate-800">
                          ₪{Math.round(h.indexed_amount ?? 0).toLocaleString()}
                        </div>
                        <div className={"text-xs font-semibold " + (Number(increase) >= 0 ? "text-red-500" : "text-green-500")}>
                          {Number(increase) >= 0 ? "+" : ""}{increase}%
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {h.base_index_value?.toFixed(2)} → {h.current_index_value?.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
