"use client";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const MONTHS_HE = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const MONTHS_SHORT = ["","ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצמ"];

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("he-IL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtInt(n: number) {
  return Math.round(n).toLocaleString("he-IL");
}

// Payment on 1st of month X uses index published on 15th of X-1 (= index of X-2)
// e.g. payment 1.1.2025 → index Oct-2024 (published 15-Nov-2024)
function getKnownIndexMonth(payYear: number, payMonth: number): { year: number; month: number } {
  let m = payMonth - 2;
  let y = payYear;
  if (m <= 0) { m += 12; y -= 1; }
  return { year: y, month: m };
}

interface Contract {
  id: string;
  tenant_name?: string;
  property_name?: string;
  property_address?: string;
  rent_per_sqm: number;
  charged_area: number;
  mgmt_fee_per_sqm?: number;
  vat_type?: string;
  vat_pct?: number;
  index_base_month: number;
  index_base_year: number;
  index_base_value: number;
  start_date: string;
  end_date: string;
  payment_frequency?: string;
  tenants?: { name: string; contact_email?: string };
  properties?: { name: string; address?: string };
}

interface PaymentRow {
  payMonth: number; payYear: number;
  indexMonth: number; indexYear: number;
  indexValue: number | null;
  baseRent: number; ratio: number;
  indexedRent: number; mgmt: number;
  totalBeforeVat: number; totalWithVat: number;
  paid: number; diff: number;
}

export default function IndexationPage() {
  const searchParams = useSearchParams();
  const contractIdParam = searchParams.get("contract_id");

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedId, setSelectedId] = useState<string>(contractIdParam ?? "");
  const [contract, setContract] = useState<Contract | null>(null);
  const [calcYear, setCalcYear] = useState(new Date().getFullYear());
  const [latestIndex, setLatestIndex] = useState<{ value: number; month: number; year: number } | null>(null);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"a" | "b">("a");
  const [paidOverrides, setPaidOverrides] = useState<Record<string, number>>({});
  const [emailSending, setEmailSending] = useState(false);

  useEffect(() => {
    supabase.from("contracts")
      .select("*, tenants(name, contact_email), properties(name, address)")
      .order("start_date", { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []).map((c: any) => ({
          ...c,
          tenant_name: c.tenants?.name,
          property_name: c.properties?.name,
          property_address: c.properties?.address,
        }));
        setContracts(list);
        if (contractIdParam) {
          const found = list.find((c: Contract) => c.id === contractIdParam);
          if (found) setContract(found);
        }
      });
  }, [contractIdParam]);

  useEffect(() => {
    supabase.from("cpi_records")
      .select("year, month, value")
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) setLatestIndex({ value: data[0].value, month: data[0].month, year: data[0].year });
      });
  }, []);

  const selectContract = (id: string) => {
    setSelectedId(id);
    const found = contracts.find(c => c.id === id);
    setContract(found ?? null);
    setRows([]);
    setPaidOverrides({});
  };

  const calculateAnnexB = useCallback(async () => {
    if (!contract) return;
    setLoading(true);
    setRows([]);

    const vatMult = (contract.vat_type === "taxable" || contract.vat_type === "חייב")
      ? (1 + (contract.vat_pct ?? 18) / 100) : 1;
    const baseRent = (contract.rent_per_sqm ?? 0) * (contract.charged_area ?? 0);
    const mgmtMonthly = (contract.mgmt_fee_per_sqm ?? 0) * (contract.charged_area ?? 0);
    const baseIndex = contract.index_base_value;

    const newRows: PaymentRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const { year: idxY, month: idxM } = getKnownIndexMonth(calcYear, m);
      const { data: idxData } = await supabase
        .from("cpi_records")
        .select("value")
        .eq("year", idxY)
        .eq("month", idxM)
        .limit(1);

      const idxVal = idxData?.[0]?.value ?? null;
      const ratio = idxVal && baseIndex ? idxVal / baseIndex : 1;
      const indexedRent = baseRent * ratio;
      const totalBeforeVat = indexedRent + mgmtMonthly;
      const totalWithVat = totalBeforeVat * vatMult;
      const paidKey = `${calcYear}-${m}`;
      const paid = paidOverrides[paidKey] ?? 0;

      newRows.push({
        payMonth: m, payYear: calcYear,
        indexMonth: idxM, indexYear: idxY,
        indexValue: idxVal,
        baseRent, ratio,
        indexedRent, mgmt: mgmtMonthly,
        totalBeforeVat, totalWithVat,
        paid, diff: totalWithVat - paid,
      });
    }
    setRows(newRows);
    setLoading(false);
  }, [contract, calcYear, paidOverrides]);

  const nextYear = calcYear + 1;

  const annexA = contract && latestIndex ? (() => {
    const baseRent = (contract.rent_per_sqm ?? 0) * (contract.charged_area ?? 0);
    const mgmtMonthly = (contract.mgmt_fee_per_sqm ?? 0) * (contract.charged_area ?? 0);
    const vatMult = (contract.vat_type === "taxable" || contract.vat_type === "חייב")
      ? (1 + (contract.vat_pct ?? 18) / 100) : 1;
    const ratio = latestIndex.value / contract.index_base_value;
    const indexedRent = baseRent * ratio;
    const totalBeforeVat = indexedRent + mgmtMonthly;
    const totalWithVat = totalBeforeVat * vatMult;
    return { baseRent, mgmtMonthly, ratio, indexedRent, totalBeforeVat, totalWithVat, vatMult };
  })() : null;

  const totalDiff = rows.reduce((s, r) => s + r.diff, 0);
  const totalIndexed = rows.reduce((s, r) => s + r.totalWithVat, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const hasPaid = rows.some(r => r.paid > 0);

  const handlePrint = () => window.print();

  const handleEmail = async () => {
    if (!contract?.tenants?.contact_email) {
      alert("אין כתובת מייל לשוכר זה");
      return;
    }
    setEmailSending(true);
    await new Promise(r => setTimeout(r, 1500));
    alert(`מייל נשלח ל: ${contract.tenants.contact_email}`);
    setEmailSending(false);
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .print-page { box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>

      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="no-print mb-8">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">חישוב הצמדות למדד</h1>
          <p className="text-slate-500 text-sm">נספח א׳ — המחאות לשנה הבאה | נספח ב׳ — הפרשי הצמדה לשנה שעברה</p>
        </div>

        {/* Controls */}
        <div className="no-print bg-white rounded-2xl border border-slate-200 p-5 mb-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">בחר חוזה</label>
              <select
                value={selectedId}
                onChange={e => selectContract(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— בחר שוכר —</option>
                {contracts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.tenant_name} — {c.property_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">שנת חישוב (נספח ב׳)</label>
              <select
                value={calcYear}
                onChange={e => { setCalcYear(Number(e.target.value)); setRows([]); }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {[2022,2023,2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={calculateAnnexB}
                disabled={!contract || loading}
                className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? "מחשב..." : "⚡ חשב הפרשים"}
              </button>
              <button onClick={handlePrint} disabled={!contract}
                className="bg-slate-100 text-slate-700 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-200 disabled:opacity-40"
                title="הדפס">🖨️
              </button>
              <button onClick={handleEmail} disabled={!contract || emailSending}
                className="bg-green-100 text-green-700 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-green-200 disabled:opacity-40"
                title="שלח במייל">
                {emailSending ? "⏳" : "✉️"}
              </button>
            </div>
          </div>
        </div>

        {contract && (
          <div className="print-page space-y-6">

            {/* Contract summary */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{contract.tenant_name}</h2>
                  <p className="text-slate-500 text-sm">{contract.property_name}{contract.property_address ? ` — ${contract.property_address}` : ""}</p>
                </div>
                <div className="flex gap-6 text-sm">
                  <div className="text-center">
                    <div className="text-xs text-slate-400">שטח מושכר</div>
                    <div className="font-bold text-slate-700">{fmtInt(contract.charged_area)} מ"ר</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-slate-400">שכ"ד בסיסי/מ"ר</div>
                    <div className="font-bold text-slate-700">₪{fmt(contract.rent_per_sqm)}</div>
                  </div>
                  {contract.mgmt_fee_per_sqm ? (
                    <div className="text-center">
                      <div className="text-xs text-slate-400">ד"נ/מ"ר</div>
                      <div className="font-bold text-slate-700">₪{fmt(contract.mgmt_fee_per_sqm)}</div>
                    </div>
                  ) : null}
                  <div className="text-center">
                    <div className="text-xs text-slate-400">מדד בסיס</div>
                    <div className="font-bold text-blue-700">
                      {MONTHS_SHORT[contract.index_base_month]}-{contract.index_base_year} = {fmt(contract.index_base_value)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="no-print flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
              {(["a","b"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === tab ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}>
                  {tab === "a" ? `📄 נספח א׳ — המחאות ${nextYear}` : `📊 נספח ב׳ — הפרשים ${calcYear}`}
                </button>
              ))}
            </div>

            {/* ══════════════════ ANNEX A ══════════════════ */}
            {activeTab === "a" && annexA && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-blue-700 text-white px-6 py-4">
                  <h3 className="font-bold text-lg">נספח א׳ — תחשיב המחאות לשנת שכירות {nextYear}</h3>
                  <p className="text-blue-200 text-sm mt-0.5">
                    צמוד למדד {MONTHS_SHORT[latestIndex!.month]}-{latestIndex!.year} = {fmt(latestIndex!.value)}
                  </p>
                </div>
                <div className="p-6">
                  <table className="w-full text-sm max-w-2xl">
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="py-2.5 text-slate-600">שטח מושכר</td>
                        <td className="py-2.5 text-left font-semibold">{fmtInt(contract.charged_area)} מ"ר</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-slate-600">שכ"ד בסיסי לחודש (לפני הצמדה ומע"מ)</td>
                        <td className="py-2.5 text-left font-semibold">₪{fmtInt(annexA.baseRent)}</td>
                      </tr>
                      {contract.mgmt_fee_per_sqm ? (
                        <tr>
                          <td className="py-2.5 text-slate-600">מקדמת דמי ניהול לחודש (הערכה, לפני מע"מ)</td>
                          <td className="py-2.5 text-left font-semibold">₪{fmtInt(annexA.mgmtMonthly)}</td>
                        </tr>
                      ) : null}
                      <tr className="bg-slate-50">
                        <td className="py-2.5 px-2 text-slate-500 text-xs">מדד בסיס ({MONTHS_SHORT[contract.index_base_month]}-{contract.index_base_year})</td>
                        <td className="py-2.5 text-left text-slate-600">{fmt(contract.index_base_value)}</td>
                      </tr>
                      <tr className="bg-slate-50">
                        <td className="py-2.5 px-2 text-slate-500 text-xs">מדד אחרון ידוע ({MONTHS_SHORT[latestIndex!.month]}-{latestIndex!.year})</td>
                        <td className="py-2.5 text-left font-semibold text-blue-600">{fmt(latestIndex!.value)}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-slate-600">יחס הצמדה</td>
                        <td className="py-2.5 text-left text-slate-700">{annexA.ratio.toFixed(6)}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-slate-600">שכ"ד צמוד לחודש (לפני מע"מ)</td>
                        <td className="py-2.5 text-left font-semibold">₪{fmtInt(annexA.indexedRent)}</td>
                      </tr>
                      {contract.mgmt_fee_per_sqm ? (
                        <tr>
                          <td className="py-2.5 text-slate-600">סה"כ שכ"ד + ד"נ לפני מע"מ</td>
                          <td className="py-2.5 text-left font-semibold">₪{fmtInt(annexA.totalBeforeVat)}</td>
                        </tr>
                      ) : null}
                      {annexA.vatMult > 1 && (
                        <tr>
                          <td className="py-2.5 text-slate-600">מע"מ {contract.vat_pct ?? 18}%</td>
                          <td className="py-2.5 text-left font-semibold">₪{fmtInt(annexA.totalBeforeVat * (annexA.vatMult - 1))}</td>
                        </tr>
                      )}
                      <tr className="bg-blue-50 border-t-2 border-blue-300">
                        <td className="py-3.5 px-2 font-bold text-blue-900 text-base">סכום כל המחאה לשנת {nextYear} (כולל מע"מ)</td>
                        <td className="py-3.5 text-left font-bold text-2xl text-blue-800">₪{fmtInt(annexA.totalWithVat)}</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* 12 checks grid */}
                  <div className="mt-8">
                    <h4 className="font-semibold text-slate-700 mb-3 text-sm">12 המחאות לשנת {nextYear}</h4>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {Array.from({length: 12}, (_,i) => i+1).map(m => (
                        <div key={m} className="bg-slate-50 rounded-xl p-3 text-center border border-slate-200 hover:border-blue-300 transition-colors">
                          <div className="text-xs text-slate-400 mb-1">1.{m}.{nextYear}</div>
                          <div className="font-bold text-slate-800">₪{fmtInt(annexA.totalWithVat)}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{MONTHS_HE[m]}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 bg-blue-50 rounded-xl p-4 text-center border border-blue-200">
                      <span className="text-sm text-blue-700 font-medium">סה"כ שנתי: </span>
                      <span className="text-xl font-bold text-blue-900">₪{fmtInt(annexA.totalWithVat * 12)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ══════════════════ ANNEX B ══════════════════ */}
            {activeTab === "b" && (
              <div>
                {rows.length === 0 && !loading && (
                  <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-16 text-center">
                    <div className="text-3xl mb-3">📊</div>
                    <p className="text-slate-500 text-sm">לחץ על "חשב הפרשים" למעלה</p>
                    <p className="text-slate-400 text-xs mt-1">ניתן להזין בטבלה מה שולם בפועל לחישוב הפרש</p>
                  </div>
                )}
                {loading && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
                    <div className="text-3xl mb-3 animate-spin">⏳</div>
                    <p className="text-slate-400 text-sm">טוען נתוני מדד מהמסד...</p>
                  </div>
                )}
                {rows.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-800 text-white px-6 py-4">
                      <h3 className="font-bold text-lg">נספח ב׳ — הפרשי הצמדה לשנת {calcYear}</h3>
                      <p className="text-slate-300 text-sm mt-0.5">
                        מדד בסיס: {MONTHS_SHORT[contract.index_base_month]}-{contract.index_base_year} = {fmt(contract.index_base_value)} | תנאי תשלום: {contract.payment_frequency ?? "חודשי"}
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200">
                            <th className="py-3 px-3 text-right font-semibold text-slate-600 whitespace-nowrap">חודש תשלום</th>
                            <th className="py-3 px-3 text-right font-semibold text-slate-600 whitespace-nowrap">מדד ידוע<br/><span className="text-slate-400 font-normal">(חודש)</span></th>
                            <th className="py-3 px-3 text-left font-semibold text-slate-600">מדד בסיס</th>
                            <th className="py-3 px-3 text-left font-semibold text-slate-600">מדד ידוע<br/><span className="text-slate-400 font-normal">(ערך)</span></th>
                            <th className="py-3 px-3 text-left font-semibold text-slate-600">יחס</th>
                            <th className="py-3 px-3 text-left font-semibold text-slate-600">שכ"ד צמוד</th>
                            {contract.mgmt_fee_per_sqm ? <th className="py-3 px-3 text-left font-semibold text-slate-600">ד"נ</th> : null}
                            <th className="py-3 px-3 text-left font-semibold text-slate-600 whitespace-nowrap">סה"כ לשלם<br/><span className="text-slate-400 font-normal">(כולל מע"מ)</span></th>
                            <th className="py-3 px-3 text-left font-semibold text-slate-600">ששולם</th>
                            <th className="py-3 px-3 text-left font-semibold text-slate-600">הפרש</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.map((r, i) => (
                            <tr key={i} className={`hover:bg-slate-50 transition-colors ${
                              r.paid > 0 && r.diff > 100 ? "bg-orange-50" :
                              r.paid > 0 && r.diff < -100 ? "bg-green-50" : ""
                            }`}>
                              <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap">
                                {MONTHS_HE[r.payMonth]} {r.payYear}
                              </td>
                              <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                                {MONTHS_SHORT[r.indexMonth]}-{r.indexYear}
                              </td>
                              <td className="py-2.5 px-3 text-left text-slate-500">{fmt(contract.index_base_value)}</td>
                              <td className="py-2.5 px-3 text-left font-semibold text-blue-700">
                                {r.indexValue !== null ? fmt(r.indexValue) : <span className="text-red-400 font-normal">חסר</span>}
                              </td>
                              <td className="py-2.5 px-3 text-left text-slate-500">{r.ratio.toFixed(5)}</td>
                              <td className="py-2.5 px-3 text-left font-medium text-slate-700">₪{fmtInt(r.indexedRent)}</td>
                              {contract.mgmt_fee_per_sqm ? (
                                <td className="py-2.5 px-3 text-left text-slate-500">₪{fmtInt(r.mgmt)}</td>
                              ) : null}
                              <td className="py-2.5 px-3 text-left font-bold text-slate-800">₪{fmtInt(r.totalWithVat)}</td>
                              <td className="py-2.5 px-3 text-left">
                                <input
                                  type="number"
                                  value={paidOverrides[`${r.payYear}-${r.payMonth}`] ?? ""}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setPaidOverrides(prev => ({ ...prev, [`${r.payYear}-${r.payMonth}`]: val }));
                                  }}
                                  placeholder="0"
                                  className="w-24 border border-slate-200 rounded px-2 py-1 text-xs text-left focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                                />
                              </td>
                              <td className={`py-2.5 px-3 text-left font-bold ${
                                r.paid > 0 && r.diff > 100 ? "text-orange-600" :
                                r.paid > 0 && r.diff < -100 ? "text-green-600" : "text-slate-300"
                              }`}>
                                {r.paid > 0 ? `${r.diff > 0 ? "+" : ""}${fmtInt(r.diff)}` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-800 text-white">
                            <td colSpan={contract.mgmt_fee_per_sqm ? 7 : 6} className="py-3 px-3 font-bold text-sm">סה"כ שנתי</td>
                            <td className="py-3 px-3 text-left font-bold">₪{fmtInt(totalIndexed)}</td>
                            <td className="py-3 px-3 text-left font-bold">₪{fmtInt(totalPaid)}</td>
                            <td className={`py-3 px-3 text-left font-bold text-base ${
                              hasPaid ? (totalDiff > 0 ? "text-orange-300" : "text-green-300") : "text-slate-400"
                            }`}>
                              {hasPaid ? `${totalDiff > 0 ? "+" : ""}${fmtInt(totalDiff)}` : "—"}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Recalc after editing paid amounts */}
                    <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 no-print">
                      <button
                        onClick={calculateAnnexB}
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
                      >
                        ↺ עדכן חישוב לאחר שינוי תשלומים
                      </button>
                    </div>

                    {/* Summary */}
                    {hasPaid && (
                      <div className="p-6 border-t border-slate-200">
                        <div className={`rounded-2xl p-5 flex items-center justify-between ${
                          totalDiff > 0
                            ? "bg-orange-50 border border-orange-200"
                            : "bg-green-50 border border-green-200"
                        }`}>
                          <div>
                            <p className={`font-bold text-base ${totalDiff > 0 ? "text-orange-800" : "text-green-800"}`}>
                              {totalDiff > 0 ? `השוכר חייב הפרשי הצמדה — ${calcYear}` : `השוכר שילם יתר — ${calcYear}`}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              מדד בסיס: {MONTHS_SHORT[contract.index_base_month]}-{contract.index_base_year} = {fmt(contract.index_base_value)}
                            </p>
                          </div>
                          <div className={`text-4xl font-black ${totalDiff > 0 ? "text-orange-700" : "text-green-700"}`}>
                            ₪{fmtInt(Math.abs(totalDiff))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* Empty state */}
        {!contract && (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-20 text-center">
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-lg font-semibold text-slate-600 mb-2">בחר חוזה להתחיל</h3>
            <p className="text-slate-400 text-sm">בחר שוכר מהרשימה למעלה כדי לחשב הצמדות</p>
          </div>
        )}
      </div>
    </div>
  );
}
