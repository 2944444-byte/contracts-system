"use client";
import { sendEmail, buildLetterEmail } from "../../../lib/email-utils";
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
function hebrewAmount(n: number): string {
  return n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface PaymentRow {
  periodLabel: string;
  paymentDate: string;
  baseRent: number;
  indexedRent: number;
  changePercent: number;
  baseMonth: string;
  determinativeMonth: string;
  mgmtFee: number;
  totalWithVat: number;
  error?: string;
}

function LettersInner() {
  const searchParams = useSearchParams();
  const [contracts, setContracts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [contract, setContract] = useState<any>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [letterType, setLetterType] = useState<"year_start"|"indexation_diff">("year_start");
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [savedLetters, setSavedLetters] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("contracts")
      .select("*, tenants(name, contact_email, contacts), properties(name, address, city)")
      .in("status", ["active","expiring","extended"])
      .then(({ data }) => setContracts(data ?? []));
    loadSavedLetters();
    const pre = searchParams?.get("contract");
    if (pre) setSelectedId(pre);
  }, []);

  useEffect(() => {
    if (!selectedId) { setContract(null); setRows([]); return; }
    const c = contracts.find(x => x.id === selectedId);
    setContract(c ?? null);
    setRows([]);
  }, [selectedId, contracts]);

  async function loadSavedLetters() {
    const { data } = await supabase.from("letters")
      .select("*, contracts(tenant_id, property_id, tenants(name), properties(name))")
      .order("created_at", { ascending: false })
      .limit(10);
    setSavedLetters(data ?? []);
  }

  const baseRent = contract
    ? (contract.rent_per_sqm ?? 0) * (contract.charged_area ?? 0) + (contract.investment_addition ?? 0)
    : 0;

  async function handleCalculate() {
    if (!contract) { setError("בחר חוזה"); return; }
    if (!contract.index_base_month || !contract.index_base_year) {
      setError("החוזה לא מוגדר עם מדד בסיס"); return;
    }
    setLoading(true); setError(""); setRows([]);

    const baseMonthStr = `${pad2(contract.index_base_month)}-${contract.index_base_year}`;
    const freq = contract.payment_frequency ?? "monthly";
    const stepMonths = freq === "quarterly" ? 3 : freq === "annual" ? 12 : 1;
    const vatMult = contract.vat_type === "taxable" ? 1 + (contract.vat_pct ?? 18) / 100 : 1;
    const mgmtFee = (contract.mgmt_fee_per_sqm ?? 0) * (contract.charged_area ?? 0);

    try {
      const payments: PaymentRow[] = [];
      const targetYear = letterType === "year_start" ? year : year - 1;
      const startDate = new Date(targetYear, 0, 1);

      for (let i = 0; i < 12 / stepMonths; i++) {
        const payDate = addMonths(startDate.toISOString().split("T")[0], i * stepMonths);
        const determinativeMonth = getT2Month(payDate);
        const periodLabel = stepMonths === 1
          ? MONTHS_HE[new Date(payDate).getMonth()] + " " + targetYear
          : `רבעון ${i+1} ${targetYear}`;

        try {
          const res = await fetch(`/api/cpi-calc?value=${baseRent}&from=${baseMonthStr}&to=${determinativeMonth}`);
          const data = await res.json();
          if (data.error) throw new Error(data.error);

          const indexedRent = Math.round(data.to_value * 100) / 100;
          const total = Math.round((indexedRent + mgmtFee) * vatMult * 100) / 100;

          payments.push({
            periodLabel, paymentDate: payDate, baseRent,
            indexedRent, changePercent: data.change_percent,
            baseMonth: baseMonthStr, determinativeMonth,
            mgmtFee, totalWithVat: total,
          });
        } catch(e: any) {
          payments.push({
            periodLabel, paymentDate: payDate, baseRent,
            indexedRent: 0, changePercent: 0,
            baseMonth: baseMonthStr, determinativeMonth,
            mgmtFee, totalWithVat: 0,
            error: e.message,
          });
        }
      }
      setRows(payments);
      setPreviewMode(true);
    } finally { setLoading(false); }
  }

  async function handleSaveLetter() {
    if (!contract || rows.length === 0) return;
    setGenerating(true);
    try {
      const { error: e } = await supabase.from("letters").insert({
        contract_id: contract.id,
        letter_type: letterType,
        title: `${letterType === "year_start" ? "תחילת שנה" : "הפרשי הצמדה"} ${year} — ${contract.tenants?.name}`,
        period_start: `${letterType === "year_start" ? year : year-1}-01-01`,
        period_end:   `${letterType === "year_start" ? year : year-1}-12-31`,
        content_json: { rows, contract_id: contract.id, year, letterType },
      });
      if (e) throw e;
      alert("✅ המכתב נשמר!");
      await loadSavedLetters();
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
    } finally { setGenerating(false); }
  }

  async function handlePrint() {
    window.print();
  }

  const totalIndexed = rows.reduce((s, r) => s + r.indexedRent, 0);
  const totalMgmt    = rows.reduce((s, r) => s + r.mgmtFee, 0);
  const totalVat     = rows.reduce((s, r) => s + r.totalWithVat, 0);

  async function handleSendEmail(letterType: string) {
    if (!contract) return;
    const tenantEmail = contract.tenants?.contact_email ?? contract.tenants?.contacts?.[0]?.email;
    if (!tenantEmail) {
      alert("לא נמצא כתובת מייל לשוכר — הוסף בכרטיס השוכר");
      return;
    }
    const printEl = document.getElementById("letter-print-area");
    if (!printEl) { alert("אין תוכן להדפסה"); return; }
    setEmailSending(true);
    try {
      const payload = buildLetterEmail({
        tenantName:   contract.tenants?.name ?? "",
        tenantEmail,
        propertyName: contract.properties?.name ?? "",
        letterType,
        htmlContent:  printEl.innerHTML,
      });
      const result = await sendEmail(payload);
      if (result.ok) {
        setEmailStatus("✅ המכתב נשלח ל-" + tenantEmail);
        setTimeout(function() { setEmailStatus(""); }, 5000);
      } else {
        alert("שגיאה בשליחה: " + result.error);
      }
    } finally { setEmailSending(false); }
  }

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">מכתבים לשוכרים</h1>
        <p className="text-sm text-slate-500 mt-1">הפקת נספח א׳ ונספח ב׳</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* הגדרות */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700 mb-4">הגדרות מכתב</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה</label>
                <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">-- בחר חוזה --</option>
                  {contracts.map(c => (
                    <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג מכתב</label>
                <div className="space-y-1.5">
                  {[
                    { value: "year_start",      label: "📋 נספח א׳ — תחילת שנה",      desc: "שיקים לשנה הקרובה" },
                    { value: "indexation_diff",  label: "📊 נספח ב׳ — הפרשי הצמדה",   desc: "הפרשים על שנה שעברה" },
                  ].map(opt => (
                    <label key={opt.value} className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${letterType === opt.value ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
                      <input type="radio" value={opt.value} checked={letterType === opt.value}
                        onChange={() => setLetterType(opt.value as any)} className="mt-0.5" />
                      <div>
                        <div className="text-sm font-medium text-slate-800">{opt.label}</div>
                        <div className="text-xs text-slate-400">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
                <select value={year} onChange={e => setYear(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm bg-white">
                  {[2023,2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {contract && (
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                  <div><strong>שוכר:</strong> {contract.tenants?.name}</div>
                  <div><strong>נכס:</strong> {contract.properties?.name}</div>
                  <div><strong>שכ"ד בסיס:</strong> ₪{baseRent.toLocaleString()}</div>
                  <div><strong>מדד בסיס:</strong> {MONTHS_HE[(contract.index_base_month ?? 1)-1]} {contract.index_base_year}</div>
                </div>
              )}

              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}

              <button onClick={handleCalculate} disabled={loading || !contract}
                className="w-full rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {loading ? "⟳ מחשב..." : "חשב ✓"}
              </button>
            </div>
          </div>

          {/* מכתבים שמורים */}
          {savedLetters.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">מכתבים אחרונים</h3>
              <div className="space-y-2">
                {savedLetters.map(l => (
                  <div key={l.id} className="text-xs text-slate-600 py-1.5 border-b border-slate-100 last:border-0">
                    <div className="font-medium text-slate-800">{l.title}</div>
                    <div className="text-slate-400">{fmtDate(l.created_at?.split("T")[0])}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* תצוגה מקדימה */}
        <div className="lg:col-span-2">
          {rows.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">📄</div>
              <div className="font-medium">בחר חוזה ולחץ "חשב" להצגת המכתב</div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {/* כותרת */}
              <div className="px-6 py-5 border-b border-slate-100">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-bold text-slate-800 text-lg">
                      {letterType === "year_start" ? `📋 נספח א׳ — שנת ${year}` : `📊 נספח ב׳ — הפרשי ${year-1}`}
                    </h2>
                    <p className="text-sm text-slate-500">{contract?.tenants?.name} | {contract?.properties?.name}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handlePrint}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                      🖨️ הדפס
                    </button>
                    <button onClick={handleSaveLetter} disabled={generating}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50">
                      {generating ? "שומר..." : "💾 שמור מכתב"}
                    </button>
                  </div>
                </div>
              </div>

              {/* גוף המכתב */}
              <div className="p-6" id="letter-content">
                {/* כותרת מכתב */}
                <div className="mb-6 pb-4 border-b border-slate-200">
                  <div className="text-xs text-slate-500 mb-1">תאריך: {fmtDate(new Date().toISOString().split("T")[0])}</div>
                  <div className="font-bold text-slate-800">לכבוד: {contract?.tenants?.name}</div>
                  <div className="text-sm text-slate-600">
                    {letterType === "year_start"
                      ? `הנדון: עדכון שכר דירה ומדד למחצית/שנת ${year}`
                      : `הנדון: הפרשי הצמדה למדד — שנת ${year-1}`}
                  </div>
                </div>

                {/* טבלת שיקים */}
                <div className="overflow-x-auto mb-5">
                  <table className="w-full text-right text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-800 text-white">
                        <th className="px-3 py-2.5 font-semibold text-xs">תקופה</th>
                        <th className="px-3 py-2.5 font-semibold text-xs">תאריך</th>
                        <th className="px-3 py-2.5 font-semibold text-xs">מדד בסיס</th>
                        <th className="px-3 py-2.5 font-semibold text-xs">מדד קובע</th>
                        <th className="px-3 py-2.5 font-semibold text-xs">שכ"ד מוצמד</th>
                        {totalMgmt > 0 && <th className="px-3 py-2.5 font-semibold text-xs">דמי ניהול</th>}
                        <th className="px-3 py-2.5 font-semibold text-xs">סה"כ כולל מע"מ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                          <td className="px-3 py-2 font-medium text-slate-800 border border-slate-100">{r.periodLabel}</td>
                          <td className="px-3 py-2 text-slate-600 border border-slate-100">{fmtDate(r.paymentDate)}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs border border-slate-100">{r.baseMonth}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs border border-slate-100">
                            {r.determinativeMonth}
                            {r.changePercent !== 0 && <span className="text-red-500 mr-1">({r.changePercent > 0 ? "+" : ""}{r.changePercent?.toFixed(1)}%)</span>}
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-800 border border-slate-100">
                            {r.error ? <span className="text-red-500 text-xs">{r.error}</span> : `₪${hebrewAmount(r.indexedRent)}`}
                          </td>
                          {totalMgmt > 0 && <td className="px-3 py-2 text-slate-600 border border-slate-100">₪{hebrewAmount(r.mgmtFee)}</td>}
                          <td className="px-3 py-2 font-bold text-slate-900 border border-slate-100">₪{hebrewAmount(r.totalWithVat)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-blue-700 text-white font-bold">
                        <td colSpan={totalMgmt > 0 ? 4 : 3} className="px-3 py-2.5 text-sm">סה"כ</td>
                        <td className="px-3 py-2.5">₪{hebrewAmount(totalIndexed)}</td>
                        {totalMgmt > 0 && <td className="px-3 py-2.5">₪{hebrewAmount(totalMgmt * rows.length)}</td>}
                        <td className="px-3 py-2.5">₪{hebrewAmount(totalVat)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* הנחיות תשלום */}
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700">
                  <div className="font-bold mb-2">הנחיות תשלום:</div>
                  <div>אנא העבירו את השיקים/התשלומים לפי הפירוט לעיל.</div>
                  <div className="text-xs text-slate-500 mt-1">
                    * כל חישוב ההצמדה מבוסס על מדד המחירים לצרכן — הלשכה המרכזית לסטטיסטיקה (סדרה 120010).
                    מדד קובע מחושב לפי כלל t-2 (המדד הידוע 2 חודשים לפני מועד התשלום).
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LettersPage() {
  return (
    <Suspense fallback={<div dir="rtl" className="p-8 text-center text-slate-400">טוען...</div>}>
      <LettersInner />
              <button onClick={function() { handleSendEmail("annual_start"); }}
                disabled={!contract || emailSending}
                className="bg-green-100 text-green-700 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-green-200 disabled:opacity-40 no-print"
                title="שלח במייל לשוכר">
                {emailSending ? "⏳" : "📧 מייל"}
              </button>
    </Suspense>
  );
}
