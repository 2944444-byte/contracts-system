"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני",
                   "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function pad2(n: number) { return String(n).padStart(2,"0"); }
function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
// t-2: מדד קובע = 2 חודשים לפני תאריך תשלום
function getT2Month(paymentDate: string): string {
  const d = new Date(paymentDate);
  d.setMonth(d.getMonth() - 2);
  return `${pad2(d.getMonth()+1)}-${d.getFullYear()}`;
}
function addMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().split("T")[0];
}

interface CalcResult {
  paymentDate: string;
  periodLabel: string;
  baseRent: number;
  indexedRent: number | null;
  changePercent: number | null;
  determinativeMonth: string;
  baseMonth: string;
  error?: string;
  verificationUrl?: string;
}

function IndexationInner() {
  const searchParams = useSearchParams();
  const [contracts, setContracts] = useState<any[]>([]);
  const [selectedContract, setSelectedContract] = useState("");
  const [contract, setContract] = useState<any>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [mode, setMode] = useState<"annex_a"|"annex_b">("annex_a");
  const [results, setResults] = useState<CalcResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("contracts")
      .select("id, tenants(name), properties(name), start_date, end_date, rent_per_sqm, charged_area, investment_addition, index_base_date, index_base_value, index_base_month, index_base_year, payment_frequency")
      .in("status", ["active","expiring","extended"])
      .order("start_date", { ascending: false })
      .then(({ data }) => setContracts(data ?? []));

    const preselect = searchParams?.get("contract");
    if (preselect) setSelectedContract(preselect);
  }, []);

  useEffect(() => {
    if (!selectedContract) { setContract(null); return; }
    const c = contracts.find(x => x.id === selectedContract);
    setContract(c ?? null);
  }, [selectedContract, contracts]);

  const baseRent = contract
    ? (contract.rent_per_sqm ?? 0) * (contract.charged_area ?? 0) + (contract.investment_addition ?? 0)
    : 0;

  async function calcSingle(value: number, fromMM: string, toMM: string): Promise<{
    to_value: number; change_percent: number; verification_url: string; error?: string;
  }> {
    const res = await fetch(`/api/cpi-calc?value=${value}&from=${fromMM}&to=${toMM}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function handleCalculate() {
    if (!contract) { setError("בחר חוזה"); return; }
    if (!contract.index_base_month || !contract.index_base_year) {
      setError("החוזה לא מוגדר עם מדד בסיס"); return;
    }
    setLoading(true);
    setError("");
    setResults([]);

    const baseMonthStr = `${pad2(contract.index_base_month)}-${contract.index_base_year}`;
    const freq = contract.payment_frequency;
    const stepMonths = freq === "quarterly" ? 3 : freq === "annual" ? 12 : 1;

    try {
      if (mode === "annex_a") {
        // נספח א' — שיקים לשנה הקרובה
        const payments: CalcResult[] = [];
        const startDate = new Date(year, 0, 1); // 1.1.YEAR

        for (let i = 0; i < 12 / stepMonths; i++) {
          const payDate = addMonths(startDate.toISOString().split("T")[0], i * stepMonths);
          const determinativeMonth = getT2Month(payDate);
          const periodLabel = stepMonths === 1
            ? MONTHS_HE[new Date(payDate).getMonth()] + " " + year
            : `רבעון ${i+1} ${year}`;

          try {
            const calc = await calcSingle(baseRent, baseMonthStr, determinativeMonth);
            payments.push({
              paymentDate: payDate,
              periodLabel,
              baseRent,
              indexedRent: Math.round(calc.to_value * 100) / 100,
              changePercent: calc.change_percent,
              determinativeMonth,
              baseMonth: baseMonthStr,
              verificationUrl: calc.verification_url,
            });
          } catch(e: any) {
            payments.push({
              paymentDate: payDate, periodLabel, baseRent,
              indexedRent: null, changePercent: null,
              determinativeMonth, baseMonth: baseMonthStr,
              error: e.message,
            });
          }
        }
        setResults(payments);

      } else {
        // נספח ב' — הפרשי הצמדה על שיקים ששולמו בשנה שעברה
        const payments: CalcResult[] = [];
        const prevYear = year - 1;
        const startDate = new Date(prevYear, 0, 1);

        for (let i = 0; i < 12 / stepMonths; i++) {
          const payDate = addMonths(startDate.toISOString().split("T")[0], i * stepMonths);
          // מדד ידוע ביום כתיבת השיק (t-2 מתחילת הרבעון הקודם)
          const writtenMonth = getT2Month(payDate);
          // מדד קובע ביום פירעון (t-2 מתאריך הפירעון בפועל)
          const paidMonth = getT2Month(payDate);
          const periodLabel = stepMonths === 1
            ? MONTHS_HE[new Date(payDate).getMonth()] + " " + prevYear
            : `רבעון ${i+1} ${prevYear}`;

          try {
            // חישוב מה היה צריך להיות (מבסיס לפירעון)
            const shouldBe = await calcSingle(baseRent, baseMonthStr, paidMonth);
            // חישוב מה שולם בפועל (מבסיס לכתיבה)
            const wasPaid  = await calcSingle(baseRent, baseMonthStr, writtenMonth);
            const diff = (shouldBe.to_value - wasPaid.to_value);

            payments.push({
              paymentDate: payDate, periodLabel, baseRent,
              indexedRent: Math.round(diff * 100) / 100,
              changePercent: shouldBe.change_percent,
              determinativeMonth: paidMonth,
              baseMonth: baseMonthStr,
              verificationUrl: shouldBe.verification_url,
            });
          } catch(e: any) {
            payments.push({
              paymentDate: payDate, periodLabel, baseRent,
              indexedRent: null, changePercent: null,
              determinativeMonth: paidMonth, baseMonth: baseMonthStr,
              error: e.message,
            });
          }
        }
        setResults(payments);
      }
    } finally {
      setLoading(false);
    }
  }

  const totalIndexed  = results.reduce((s, r) => s + (r.indexedRent ?? 0), 0);
  const totalBase     = results.reduce((s, r) => s + r.baseRent, 0);
  const totalDiff     = totalIndexed - (mode === "annex_b" ? 0 : totalBase);

  return (
    <div dir="rtl" className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">חישוב הצמדה למדד</h1>
        <p className="text-sm text-slate-500 mt-1">חישוב חי מול API הלמ"ס — מחשבון רשמי</p>
      </div>

      {/* הגדרות חישוב */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm mb-5">
        <h2 className="text-sm font-bold text-slate-700 mb-4">הגדרות חישוב</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה</label>
            <select value={selectedContract}
              onChange={e => setSelectedContract(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">-- בחר חוזה --</option>
              {contracts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.tenants?.name} — {c.properties?.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              {[2023,2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">סוג חישוב</label>
            <div className="flex rounded-lg border border-slate-300 overflow-hidden">
              <button onClick={() => setMode("annex_a")}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${mode === "annex_a" ? "bg-blue-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                נספח א׳ — שיקים לשנה
              </button>
              <button onClick={() => setMode("annex_b")}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${mode === "annex_b" ? "bg-blue-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                נספח ב׳ — הפרשים
              </button>
            </div>
          </div>
        </div>

        {/* פרטי חוזה נבחר */}
        {contract && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm mb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><span className="text-blue-600 text-xs">שכ"ד בסיס</span><div className="font-bold text-slate-800">₪{baseRent.toLocaleString()}</div></div>
              <div><span className="text-blue-600 text-xs">מדד בסיס</span><div className="font-bold text-slate-800">{MONTHS_HE[(contract.index_base_month ?? 1)-1]} {contract.index_base_year}</div></div>
              <div><span className="text-blue-600 text-xs">תדירות</span><div className="font-bold text-slate-800">
                {contract.payment_frequency === "monthly" ? "חודשי" : contract.payment_frequency === "quarterly" ? "רבעוני" : "שנתי"}
              </div></div>
              <div><span className="text-blue-600 text-xs">תקופה</span><div className="font-bold text-slate-800">{fmtDate(contract.start_date)} — {fmtDate(contract.end_date)}</div></div>
            </div>
          </div>
        )}

        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>}

        <button onClick={handleCalculate} disabled={loading || !contract}
          className="w-full rounded-lg bg-blue-700 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? (
            <><span className="animate-spin">⟳</span> מחשב מול API הלמ"ס...</>
          ) : (
            <>🔢 חשב {mode === "annex_a" ? "נספח א׳" : "נספח ב׳"}</>
          )}
        </button>
      </div>

      {/* תוצאות */}
      {results.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-800">
                {mode === "annex_a" ? `📋 נספח א׳ — שיקים לשנת ${year}` : `📋 נספח ב׳ — הפרשי הצמדה ${year-1}`}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {contract?.tenants?.name} | {contract?.properties?.name} | מדד בסיס: {MONTHS_HE[(contract?.index_base_month ?? 1)-1]} {contract?.index_base_year}
              </p>
            </div>
            <div className="text-left">
              <div className="text-xs text-slate-500">{mode === "annex_a" ? "סה״כ לשנה" : "סה״כ הפרשים"}</div>
              <div className={`text-lg font-bold ${mode === "annex_b" ? (totalIndexed >= 0 ? "text-red-700" : "text-green-700") : "text-green-700"}`}>
                ₪{Math.abs(totalIndexed).toLocaleString()}
                {mode === "annex_b" && <span className="text-sm mr-1">{totalIndexed >= 0 ? "(לחיוב)" : "(לזיכוי)"}</span>}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 font-semibold">תקופה</th>
                  <th className="px-4 py-3 font-semibold">תאריך תשלום</th>
                  <th className="px-4 py-3 font-semibold">מדד בסיס</th>
                  <th className="px-4 py-3 font-semibold">מדד קובע (t-2)</th>
                  <th className="px-4 py-3 font-semibold">שינוי מדד</th>
                  <th className="px-4 py-3 font-semibold">
                    {mode === "annex_a" ? "שכ״ד מוצמד" : "הפרש"}
                  </th>
                  <th className="px-4 py-3 font-semibold">אימות</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={`border-t border-slate-50 ${r.error ? "bg-red-50" : "hover:bg-slate-50"}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.periodLabel}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(r.paymentDate)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.baseMonth}</td>
                    <td className="px-4 py-3 text-slate-600">{r.determinativeMonth}</td>
                    <td className="px-4 py-3">
                      {r.changePercent != null ? (
                        <span className={`font-semibold ${r.changePercent >= 0 ? "text-red-600" : "text-green-600"}`}>
                          {r.changePercent >= 0 ? "+" : ""}{r.changePercent.toFixed(2)}%
                        </span>
                      ) : <span className="text-red-400 text-xs">{r.error ?? "—"}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.indexedRent != null ? (
                        <span className={`font-bold ${mode === "annex_b" ? (r.indexedRent >= 0 ? "text-red-700" : "text-green-700") : "text-slate-900"}`}>
                          ₪{Math.abs(r.indexedRent).toLocaleString()}
                          {mode === "annex_b" && r.indexedRent !== 0 && (
                            <span className="text-xs font-normal mr-1">{r.indexedRent > 0 ? "לחיוב" : "לזיכוי"}</span>
                          )}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {r.verificationUrl && (
                        <a href={r.verificationUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline">
                          אמת ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td colSpan={5} className="px-4 py-3 font-bold text-slate-700 text-left">
                    {mode === "annex_a" ? "סה״כ לשנה" : "סה״כ הפרשים"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-bold text-base ${mode === "annex_b" ? (totalIndexed >= 0 ? "text-red-700" : "text-green-700") : "text-green-700"}`}>
                      ₪{Math.abs(totalIndexed).toLocaleString()}
                    </span>
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* הסבר */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-500">
            <strong>כלל t-2:</strong> המדד הקובע לתשלום בתאריך X הוא המדד המפורסם 2 חודשים לפני — כי הלמ"ס מפרסם ב-15 לחודש את מדד החודש הקודם.
            כל חישוב מבוסס על <strong>API הלמ"ס הרשמי</strong> (מחשבון 120010). לחץ "אמת" לאימות ישיר.
          </div>
        </div>
      )}
    </div>
  );
}

export default function IndexationPage() {
  return (
    <Suspense fallback={<div dir="rtl" className="p-8 text-center text-slate-400">טוען...</div>}>
      <IndexationInner />
    </Suspense>
  );
}
