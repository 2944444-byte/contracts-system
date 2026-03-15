"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

function getT2Month(paymentDate: string): { year: number; month: number; label: string } {
  // כלל t-2: מדד קובע = 2 חודשים לפני תאריך התשלום
  const d = new Date(paymentDate);
  d.setMonth(d.getMonth() - 2);
  return {
    year:  d.getFullYear(),
    month: d.getMonth() + 1,
    label: d.toLocaleDateString("he-IL", { year: "numeric", month: "long" }),
  };
}

export default function IndexationPage() {
  const [contracts,    setContracts]    = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [calcLoading,  setCalcLoading]  = useState(false);
  const [result,       setResult]       = useState<any>(null);
  const [cpiError,     setCpiError]     = useState("");

  // טופס חישוב
  const [contractId,   setContractId]   = useState("");
  const [baseRent,     setBaseRent]     = useState("");
  const [area,         setArea]         = useState("");
  const [baseIndex,    setBaseIndex]    = useState("");
  const [baseIndexDate,setBaseIndexDate]= useState("");
  const [paymentDate,  setPaymentDate]  = useState(new Date().toISOString().split("T")[0]);
  const [vatPct,       setVatPct]       = useState("18");
  const [mgmtFee,      setMgmtFee]      = useState("0");

  // היסטוריה
  const [history,      setHistory]      = useState<any[]>([]);

  useEffect(function() { loadContracts(); loadHistory(); }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts")
      .select("id, tenants(name), properties(name), rent_per_sqm, charged_area, base_cpi_value, base_cpi_date, investment_addition")
      .in("status", ["active","expiring","extended"])
      .order("created_at", { ascending: false });
    setContracts(data ?? []);
    setLoading(false);
  }

  async function loadHistory() {
    const { data } = await supabase.from("cpi_records")
      .select("*").order("created_at", { ascending: false }).limit(20);
    setHistory(data ?? []);
  }

  function fillFromContract(id: string) {
    const c = contracts.find(function(x) { return x.id === id; });
    if (!c) return;
    setBaseRent(c.rent_per_sqm?.toString() ?? "");
    setArea(c.charged_area?.toString() ?? "");
    setBaseIndex(c.base_cpi_value?.toString() ?? "");
    setBaseIndexDate(c.base_cpi_date?.split("T")[0] ?? "");
  }

  async function fetchCPI(year: number, month: number): Promise<number | null> {
    // קריאה חיה ל-API של הלמס
    try {
      const url = `https://api.cbs.gov.il/index/data/price?id=120010&startPeriod=${year}-${String(month).padStart(2,"0")}&endPeriod=${year}-${String(month).padStart(2,"0")}&format=json`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("API error " + resp.status);
      const json = await resp.json();
      // מבנה: json.DataSet.Series[0].obs[0].obsValue
      const val = json?.DataSet?.Series?.[0]?.obs?.[0]?.obsValue;
      if (!val) return null;
      return Number(val);
    } catch {
      return null;
    }
  }

  async function handleCalc() {
    if (!baseRent || !area || !baseIndex || !paymentDate) {
      alert("נא למלא: שכר דירה בסיסי, שטח, מדד בסיס, ותאריך תשלום");
      return;
    }
    setCalcLoading(true);
    setCpiError("");
    setResult(null);
    try {
      const t2 = getT2Month(paymentDate);
      const currentIndex = await fetchCPI(t2.year, t2.month);

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
        t2Month:       t2.label,
        paymentDate:   paymentDate,
        vatPct:        Number(vatPct),
      };
      setResult(res);

      // שמור ב-cpi_records אם יש חוזה
      if (contractId) {
        await supabase.from("cpi_records").insert({
          contract_id:      contractId,
          base_index_value: base,
          current_index_value: currentIndex,
          index_ratio:      ratio,
          base_rent_amount: baseAmt,
          indexed_amount:   indexed,
          billing_date:     paymentDate,
          t2_month:         t2.year + "-" + String(t2.month).padStart(2,"0"),
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
        {/* טופס חישוב */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
          <h2 className="font-bold text-slate-800 mb-4 text-lg">🧮 מחשבון הצמדה</h2>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה (אופציונלי — ימלא אוטומטית)</label>
              <select value={contractId} onChange={function(e) { setContractId(e.target.value); fillFromContract(e.target.value); }} className={ic}>
                <option value="">-- חישוב ידני --</option>
                {contracts.map(function(c) { return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>; })}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שכ"ד בסיס (₪/מ"ר)</label>
                <input type="number" value={baseRent} onChange={function(e) { setBaseRent(e.target.value); }} className={ic} placeholder="120" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ"ר)</label>
                <input type="number" value={area} onChange={function(e) { setArea(e.target.value); }} className={ic} placeholder="500" />
              </div>
            </div>

            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 space-y-3">
              <div className="text-xs font-bold text-blue-800">📊 נתוני מדד</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מדד בסיס (נקודות)</label>
                  <input type="number" value={baseIndex} onChange={function(e) { setBaseIndex(e.target.value); }} className={ic} placeholder="100.5" step="0.1" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך מדד בסיס</label>
                  <input type="date" value={baseIndexDate} onChange={function(e) { setBaseIndexDate(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך תשלום</label>
                <input type="date" value={paymentDate} onChange={function(e) { setPaymentDate(e.target.value); }} className={ic} />
                {paymentDate && (
                  <div className="text-xs text-blue-600 mt-1">
                    📅 מדד קובע (t-2): {getT2Month(paymentDate).label}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ %</label>
                <input type="number" value={vatPct} onChange={function(e) { setVatPct(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול (₪/מ"ר)</label>
                <input type="number" value={mgmtFee} onChange={function(e) { setMgmtFee(e.target.value); }} className={ic} placeholder="0" />
              </div>
            </div>

            <button onClick={handleCalc} disabled={calcLoading}
              className="w-full rounded-xl bg-blue-700 py-3 font-bold text-white text-sm hover:bg-blue-800 disabled:opacity-50 transition-colors">
              {calcLoading ? "מחשב..." : "🧮 חשב הצמדה"}
            </button>

            {cpiError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                ⚠️ {cpiError}
              </div>
            )}
          </div>

          {/* תוצאה */}
          {result && (
            <div className="mt-5 rounded-xl bg-green-50 border border-green-200 p-5">
              <div className="font-bold text-green-800 text-base mb-3">✅ תוצאת חישוב</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">מדד בסיס</span>
                  <span className="font-mono">{result.baseIndex.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">מדד נוכחי ({result.t2Month})</span>
                  <span className="font-mono font-bold">{result.currentIndex.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">שינוי מדד</span>
                  <span className={"font-bold " + (result.increase >= 0 ? "text-red-600" : "text-green-600")}>
                    {result.increase >= 0 ? "+" : ""}{result.increase.toFixed(2)}%
                  </span>
                </div>
                <hr className="border-green-200 my-2" />
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
                <hr className="border-green-200 my-2" />
                <div className="flex justify-between text-base font-black text-green-800">
                  <span>סה"כ לתשלום</span>
                  <span>₪{Math.round(result.total).toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* היסטוריה */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-800">📋 היסטוריית חישובים</h2>
          </div>
          {history.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              חישובים שמורים יופיעו כאן
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.map(function(h) {
                const increase = ((h.index_ratio - 1) * 100).toFixed(2);
                return (
                  <div key={h.id} className="px-5 py-3 hover:bg-slate-50">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">
                          {h.contracts?.tenants?.name ?? "חישוב ידני"}
                        </div>
                        <div className="text-xs text-slate-400">{fmtDate(h.billing_date)}</div>
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
                      מדד: {h.base_index_value?.toFixed(2)} → {h.current_index_value?.toFixed(2)}
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
