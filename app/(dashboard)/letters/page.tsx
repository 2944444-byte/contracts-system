"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "../../../lib/supabase";

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const MONTHS_SHORT = ["ינו","פב","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצמ"];

function fmt(n: number, d = 2) {
  return n.toLocaleString("he-IL", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtInt(n: number) {
  return Math.round(n).toLocaleString("he-IL");
}
function fmtMonthYear(year: number, month: number) {
  return `${MONTHS_SHORT[month - 1]}-${String(year).slice(2)}`;
}
function fmtMonthLong(year: number, month: number) {
  return `${MONTHS_HE[month - 1]} ${year}`;
}
function fmtDateFull(s: string) {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getDate()} ב${MONTHS_HE[d.getMonth()]} ${d.getFullYear()}`;
}

// Get CPI for specific year+month
function getCpi(records: any[], year: number, month: number): number | null {
  return records.find(r => r.year === year && r.month === month)?.value ?? null;
}

// Get highest CPI from base date up to (and including) given date — "ruling index" per clause 9.4.1
function getHighestCpi(records: any[], baseYear: number, baseMonth: number, upToYear: number, upToMonth: number) {
  const relevant = records.filter(r => {
    const afterBase = r.year > baseYear || (r.year === baseYear && r.month >= baseMonth);
    const beforeEnd = r.year < upToYear || (r.year === upToYear && r.month <= upToMonth);
    return afterBase && beforeEnd && r.value != null;
  });
  if (!relevant.length) return null;
  return relevant.reduce((max: any, r: any) => (r.value > max.value ? r : max), relevant[0]);
}

export default function LettersPage() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [cpiRecords, setCpiRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Steps: select → config → preview
  const [step, setStep] = useState<"select" | "config" | "preview">("select");
  const [sel, setSel] = useState<any>(null); // selected contract

  // Config fields
  const [targetYear, setTargetYear] = useState(new Date().getFullYear() + 1);
  const [letterDate, setLetterDate] = useState(new Date().toISOString().slice(0, 10));
  const [payDay, setPayDay] = useState(1);
  const [mgmtFeeNew, setMgmtFeeNew] = useState(0);   // ד"נ למ"ר לשנה הבאה
  const [mgmtFeeOld, setMgmtFeeOld] = useState(0);   // ד"נ למ"ר שנה שעברה
  const [indexRule, setIndexRule] = useState<"highest" | "2months">("highest");
  const [amountPaidMonthly, setAmountPaidMonthly] = useState<number | "">("");  // מה שולם בפועל בחודש שנה שעברה
  const [addGuaranteeRequest, setAddGuaranteeRequest] = useState(true);
  const [bankAccount, setBankAccount] = useState("");
  const [signerName, setSignerName] = useState("");

  const [result, setResult] = useState<any>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      supabase
        .from("contracts")
        .select("*, tenants(name, legal_name, company_name), properties(name, address), units(unit_name, area_m2)")
        .in("status", ["active", "expiring", "upcoming"]),
      supabase.from("cpi_records").select("*").order("year").order("month"),
    ]).then(([{ data: c }, { data: cpi }]) => {
      setContracts(c ?? []);
      setCpiRecords(cpi ?? []);
      setLoading(false);
    });
  }, []);

  function selectContract(c: any) {
    setSel(c);
    setMgmtFeeNew(c.mgmt_fee_per_sqm || 0);
    setMgmtFeeOld(c.mgmt_fee_per_sqm || 0);
    setPayDay(c.payment_day || 1);
    setStep("config");
  }

  // ============================================================
  // CORE CALCULATION
  // ============================================================
  function calculate() {
    if (!sel) return;

    const prevYear = targetYear - 1;
    const area = sel.charged_area || sel.units?.area_m2 || 0;
    const rentPerSqm = sel.rent_per_sqm || 0;
    const baseIndex = sel.index_base_value;
    const baseIndexMonth: string = sel.index_base_month || "2020-01"; // "YYYY-MM"
    const [baseY, baseM] = baseIndexMonth.split("-").map(Number);
    const hasVat = sel.vat_type === "taxable";
    const vatRate = (sel.vat_pct ?? 18) / 100;
    const vatMult = hasVat ? 1 + vatRate : 1;
    const isQuarterly = sel.payment_frequency === "quarterly";

    // ── Latest known CPI (for annex A - next year checks) ──
    const latestCpi = [...cpiRecords]
      .filter(r => r.value != null)
      .sort((a, b) => b.year - a.year || b.month - a.month)[0];

    if (!latestCpi || !baseIndex) return;

    // ── ANNEX A: Next-year check amount ──
    const indexFactorA = latestCpi.value / baseIndex;
    const monthlyRentIndexed = rentPerSqm * area * indexFactorA;      // שכ"ד צמוד לפני מע"מ
    const monthlyMgmtNew = mgmtFeeNew * area;                         // ד"נ לפני מע"מ
    const monthlyTotalBeforeVat = monthlyRentIndexed + monthlyMgmtNew;
    const checkAmount = monthlyTotalBeforeVat * vatMult;

    const paymentMonths = isQuarterly ? [1, 4, 7, 10] : [1,2,3,4,5,6,7,8,9,10,11,12];

    const checks = paymentMonths.map((month, i) => ({
      num: i + 1,
      month,
      date: `${String(payDay).padStart(2,"0")}.${String(month).padStart(2,"0")}.${targetYear}`,
      amount: checkAmount,
    }));

    // ── ANNEX B: Indexation differences for prev year ──
    // "amount paid in practice" = what was charged monthly last year
    // The user enters this OR we try to compute it from the contract data
    const paidMonthly =
      typeof amountPaidMonthly === "number" && amountPaidMonthly > 0
        ? amountPaidMonthly
        : null; // will show warning if null

    const diffRows = paymentMonths.map((payMonth) => {
      const numMonths = isQuarterly ? 3 : 1;

      // The CPI known at time of payment:
      // Payment on day X of payMonth of prevYear.
      // Per CBS publication lag, the "known" index is 2 months before payment date.
      // e.g. payment Jan → index Oct of prev year (payMonth - 3 relative to prev year)
      let knownYear = prevYear;
      let knownMonth = payMonth - 2;
      if (knownMonth <= 0) { knownMonth += 12; knownYear -= 1; }

      // Ruling index: highest CPI from base date up to knownDate
      let rulingCpiRecord: any = null;
      if (indexRule === "highest") {
        rulingCpiRecord = getHighestCpi(cpiRecords, baseY, baseM, knownYear, knownMonth);
      } else {
        const v = getCpi(cpiRecords, knownYear, knownMonth);
        if (v != null) rulingCpiRecord = { value: v, year: knownYear, month: knownMonth };
      }

      if (!rulingCpiRecord) {
        return { payMonth, numMonths, missing: true, diff: 0, paidMonthly: paidMonthly ?? 0, rulingCpiRecord: null };
      }

      // Required amount (what SHOULD have been paid per month)
      const reqFactor = rulingCpiRecord.value / baseIndex;
      const reqRent = rentPerSqm * area * reqFactor;
      const reqMgmt = mgmtFeeOld * area;
      const reqTotal = (reqRent + reqMgmt) * vatMult * numMonths;

      // Actually paid
      const actualPaid = (paidMonthly ?? 0) * numMonths;

      const diff = reqTotal - actualPaid;

      return {
        payMonth,
        numMonths,
        missing: false,
        rulingCpiRecord,
        reqRent: reqRent * numMonths,
        reqMgmt: reqMgmt * numMonths,
        reqTotal,
        actualPaid,
        diff,
      };
    });

    const totalDiff = diffRows.filter((r) => !r.missing).reduce((s, r) => s + r.diff, 0);

    setResult({
      // Contract info
      tenantName: sel.tenants?.legal_name ?? sel.tenants?.company_name ?? sel.tenants?.name,
      propertyName: sel.properties?.name,
      unitName: sel.units?.unit_name,
      area, rentPerSqm, baseIndex, baseIndexMonth, baseY, baseM,
      hasVat, vatRate, vatMult, isQuarterly,
      // Annex A
      latestCpi, indexFactorA,
      monthlyRentIndexed, monthlyMgmtNew, monthlyTotalBeforeVat, checkAmount,
      mgmtFeeNew, mgmtFeeOld,
      checks,
      // Annex B
      prevYear, targetYear,
      paidMonthly,
      diffRows, totalDiff,
    });
    setStep("preview");
  }

  function printLetter() {
    const el = printRef.current;
    if (!el) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>מכתב שכירות</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Arial', sans-serif; direction: rtl; padding: 30px 40px; font-size: 12px; color: #111; line-height: 1.5; }
  .letter-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .company { font-size: 18px; font-weight: 900; }
  .date-block { text-align: left; font-size: 11px; color: #444; }
  h1.subject { font-size: 13px; font-weight: bold; text-decoration: underline; margin: 16px 0 12px; }
  p { margin-bottom: 10px; }
  .bold { font-weight: bold; }
  .underline { text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 11px; }
  th { background: #e0e0e0; border: 1px solid #999; padding: 5px 8px; text-align: right; font-weight: bold; }
  td { border: 1px solid #ccc; padding: 4px 8px; text-align: right; }
  tr:nth-child(even) td { background: #f7f7f7; }
  .total-row td { background: #e0e0e0 !important; font-weight: bold; font-size: 12px; }
  .annex-title { font-size: 13px; font-weight: bold; text-decoration: underline; margin: 24px 0 12px; border-bottom: 2px solid #333; padding-bottom: 4px; }
  .params-table td:first-child { color: #444; width: 65%; }
  .params-table td:last-child { font-weight: bold; }
  .page-break { page-break-before: always; }
  .note { font-size: 10px; color: #555; margin-top: 6px; }
  .signature { margin-top: 48px; }
  @media print { body { padding: 15px 20px; } }
</style>
</head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  const filtered = contracts.filter((c) => {
    if (!search) return true;
    const n = (c.tenants?.legal_name ?? c.tenants?.company_name ?? c.tenants?.name ?? "").toLowerCase();
    const p = (c.properties?.name ?? "").toLowerCase();
    return n.includes(search.toLowerCase()) || p.includes(search.toLowerCase());
  });

  // ────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" className="p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">✉️ מכתבים שנתיים לשוכרים</h1>
          <p className="text-sm text-slate-500 mt-1">
            נספח א׳ — המחאות לשנה הבאה &nbsp;·&nbsp; נספח ב׳ — הפרשי הצמדה
          </p>
        </div>
        {step !== "select" && (
          <button
            onClick={() => { setStep("select"); setResult(null); }}
            className="text-sm text-blue-600 hover:underline"
          >
            ← חזור לבחירת חוזה
          </button>
        )}
      </div>

      {/* ─── STEP 1: SELECT CONTRACT ─── */}
      {step === "select" && (
        <div className="space-y-4">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 חיפוש שוכר או נכס..."
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {loading ? (
            <div className="py-12 text-center text-slate-400">טוען חוזים...</div>
          ) : (
            <div className="grid gap-3">
              {filtered.map((c) => {
                const name = c.tenants?.legal_name ?? c.tenants?.company_name ?? c.tenants?.name;
                const freq = c.payment_frequency === "quarterly" ? "רבעוני" : "חודשי";
                const hasMdIndex = !!c.index_base_value;
                return (
                  <button
                    key={c.id}
                    onClick={() => selectContract(c)}
                    className="w-full text-right rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-400 hover:shadow-md transition-all"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-slate-800 text-base">{name}</div>
                        <div className="text-sm text-slate-500 mt-0.5">
                          {c.properties?.name}{c.units?.unit_name ? ` · ${c.units.unit_name}` : ""}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 flex gap-3">
                          <span>{c.charged_area} מ"ר</span>
                          <span>₪{(c.rent_per_sqm || 0).toFixed(2)}/מ"ר</span>
                          <span>{freq}</span>
                          {c.index_base_value && <span>מדד בסיס: {c.index_base_value}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          c.status === "active" ? "bg-green-100 text-green-700" :
                          c.status === "expiring" ? "bg-yellow-100 text-yellow-700" :
                          "bg-blue-100 text-blue-700"
                        }`}>
                          {c.status === "active" ? "פעיל" : c.status === "expiring" ? "פג בקרוב" : "עתידי"}
                        </span>
                        {!hasMdIndex && (
                          <span className="text-[10px] text-red-500">⚠️ חסר מדד בסיס</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="py-12 text-center text-slate-400">לא נמצאו חוזים</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── STEP 2: CONFIG ─── */}
      {step === "config" && sel && (
        <div className="max-w-2xl space-y-5">
          {/* Contract summary */}
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="font-bold text-blue-800 text-base">
              {sel.tenants?.legal_name ?? sel.tenants?.company_name ?? sel.tenants?.name}
            </div>
            <div className="text-sm text-blue-600 mt-0.5">
              {sel.properties?.name} · {sel.charged_area} מ"ר · ₪{sel.rent_per_sqm}/מ"ר ·{" "}
              {sel.payment_frequency === "quarterly" ? "רבעוני" : "חודשי"} · מדד בסיס {sel.index_base_value}
            </div>
          </div>

          {/* Config card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-700 mb-4 text-base">הגדרות המכתב</h2>

            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              {/* Target year */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">שנת שכירות לדרישה</label>
                <input type="number" value={targetYear} onChange={e => setTargetYear(+e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              {/* Letter date */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">תאריך המכתב</label>
                <input type="date" value={letterDate} onChange={e => setLetterDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none" />
              </div>
              {/* Pay day */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">יום תשלום בחודש</label>
                <input type="number" value={payDay} onChange={e => setPayDay(+e.target.value)} min={1} max={28}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none" />
              </div>
              {/* Mgmt fee next year */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  מקדמת ד"נ למ"ר — {targetYear} (₪)
                </label>
                <input type="number" value={mgmtFeeNew} onChange={e => setMgmtFeeNew(+e.target.value)} min={0} step={0.5}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none" />
                <div className="text-xs text-slate-400 mt-0.5">0 = אין דמי ניהול</div>
              </div>
              {/* Mgmt fee prev year */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  מקדמת ד"נ למ"ר — {targetYear - 1} (₪)
                </label>
                <input type="number" value={mgmtFeeOld} onChange={e => setMgmtFeeOld(+e.target.value)} min={0} step={0.5}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none" />
                <div className="text-xs text-slate-400 mt-0.5">לחישוב הפרשי הצמדה</div>
              </div>
              {/* Amount paid last year */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  סכום ששולם בפועל לחודש ב-{targetYear - 1} (₪ כולל מע"מ)
                </label>
                <input
                  type="number"
                  value={amountPaidMonthly}
                  onChange={e => setAmountPaidMonthly(e.target.value === "" ? "" : +e.target.value)}
                  placeholder="הכנס סכום מהמכתב הקודם..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <div className="text-xs text-slate-400 mt-0.5">מהמכתב שנשלח לשוכר ב-{targetYear - 1}</div>
              </div>
            </div>

            {/* Index rule */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                כלל מדד קובע לנספח ב׳
              </label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" value="highest" checked={indexRule === "highest"} onChange={() => setIndexRule("highest")} className="accent-blue-600" />
                  <span className="font-medium">המדד הגבוה ביותר</span>
                  <span className="text-xs text-slate-400">מתחילת חוזה עד מועד התשלום (סע׳ 9.4.1)</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" value="2months" checked={indexRule === "2months"} onChange={() => setIndexRule("2months")} className="accent-blue-600" />
                  <span className="font-medium">מדד 2 חודשים לפני</span>
                </label>
              </div>
            </div>

            {/* Extra options */}
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={addGuaranteeRequest} onChange={e => setAddGuaranteeRequest(e.target.checked)} className="accent-blue-600" />
                <span>הוסף בקשה לחידוש ערבות בנקאית</span>
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">פרטי חשבון בנק (אופציונלי)</label>
                  <input value={bankAccount} onChange={e => setBankAccount(e.target.value)}
                    placeholder="חשבון X סניף Y בנק Z"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">שם חותם המכתב</label>
                  <input value={signerName} onChange={e => setSignerName(e.target.value)}
                    placeholder="גיא כהן"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none" />
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={calculate}
            disabled={!sel.index_base_value}
            className="w-full rounded-xl bg-blue-700 py-3.5 font-bold text-white hover:bg-blue-800 disabled:opacity-40 text-base"
          >
            🧮 חשב והפק מכתב
          </button>
          {!sel.index_base_value && (
            <p className="text-sm text-red-600 text-center">⚠️ חסר מדד בסיס בחוזה — נא לעדכן בדף החוזים</p>
          )}
        </div>
      )}

      {/* ─── STEP 3: PREVIEW ─── */}
      {step === "preview" && result && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                ✅ המכתב מוכן
              </span>
              {!result.paidMonthly && (
                <span className="text-sm text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                  ⚠️ לא הוזן סכום ששולם — הפרשי ההצמדה יחושבו כ-0
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("config")} className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                ✏️ ערוך
              </button>
              <button onClick={printLetter} className="rounded-xl bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800 flex items-center gap-2">
                🖨️ הדפס / PDF
              </button>
            </div>
          </div>

          {/* ── PRINTABLE LETTER ── */}
          <div
            ref={printRef}
            className="bg-white border border-slate-200 rounded-xl shadow-sm p-10 max-w-4xl"
            style={{ fontFamily: "Arial, sans-serif", direction: "rtl", fontSize: "12px", lineHeight: "1.6" }}
          >
            {/* Header */}
            <div className="letter-header" style={{ display:"flex", justifyContent:"space-between", marginBottom:"28px" }}>
              <div className="company" style={{ fontSize:"19px", fontWeight:"900" }}>
                {result.propertyName}
              </div>
              <div className="date-block" style={{ textAlign:"left" as any, fontSize:"11px", color:"#444" }}>
                {fmtDateFull(letterDate)}
              </div>
            </div>

            <p>לכבוד</p>
            <p style={{ fontWeight:"bold", fontSize:"14px", textDecoration:"underline", margin:"4px 0 16px" }}>
              {result.tenantName}
            </p>
            <p>א.נ.</p>

            <h1 className="subject" style={{ fontSize:"13px", fontWeight:"bold", textDecoration:"underline", margin:"14px 0 10px" }}>
              הנדון: המחאות עבור שנת שכירות {result.targetYear} ותשלום הפרשים בגין תשלומי {result.prevYear}
            </h1>

            <p>בהתאם להסכם השכירות ביננו נבקשך להעביר אלינו:</p>

            {/* ── Request 1: checks ── */}
            <p style={{ fontWeight:"bold", marginTop:"12px" }}>
              .1 &nbsp; {result.checks.length} המחאות עבור שנת שכירות {result.targetYear}, כמפורט להלן:
            </p>

            <table style={{ width:"55%", borderCollapse:"collapse" as any, margin:"8px 0 10px", fontSize:"11px" }}>
              <thead>
                <tr>
                  <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 10px", textAlign:"right" as any }}>המחאה</th>
                  <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 10px", textAlign:"right" as any }}>לתאריך</th>
                  <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 10px", textAlign:"right" as any }}>בסכום בש"ח</th>
                </tr>
              </thead>
              <tbody>
                {result.checks.map((ch: any) => (
                  <tr key={ch.num}>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", background: ch.num % 2 === 0 ? "#f7f7f7" : "white" }}>{ch.num}</td>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", background: ch.num % 2 === 0 ? "#f7f7f7" : "white" }}>{ch.date}</td>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight: ch.num === 1 ? "bold" : "normal", background: ch.num % 2 === 0 ? "#f7f7f7" : "white" }}>
                      {fmtInt(ch.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontSize:"11px", marginBottom:"12px" }}>
              תחשיב סכום כל המחאה מפורט בנספח א&apos;.
            </p>

            {/* ── Request 2: indexation diff ── */}
            {Math.abs(result.totalDiff) > 0.5 && (
              <>
                <p style={{ fontWeight:"bold" }}>
                  .2 &nbsp; המחאה בסך{" "}
                  <strong>{fmtInt(Math.abs(result.totalDiff))} ₪</strong>{" "}
                  {result.totalDiff < 0 ? "זיכוי" : "מזומן"} עבור הפרשי תשלומי שכ"ד ועבור הפרשי הצמדה בגין התשלומים שבוצעו ב-{result.prevYear}.
                </p>
                <p style={{ fontSize:"11px", marginBottom:"12px" }}>
                  תחשיב סכום הפרשי התשלומים שבוצעו מפורט בנספח ב&apos;.
                </p>
              </>
            )}

            {/* ── Request 3: bank account ── */}
            {bankAccount && (
              <p style={{ marginBottom:"10px" }}>
                את ההמחאות יש לרשום לפקודת {result.propertyName}{" "}
                {bankAccount && <span>חשבון {bankAccount}</span>}.
              </p>
            )}

            {/* ── Request: guarantee renewal ── */}
            {addGuaranteeRequest && (
              <p style={{ fontWeight:"bold", marginBottom:"10px" }}>
                .{Math.abs(result.totalDiff) > 0.5 ? "3" : "2"} &nbsp;
                בנוסף, מאחר והערבות הבנקאית שהעמדת להבטחת התחייבויותיך על פי ההסכם פוקעת, נבקשך להאריך את תוקף הערבות הבנקאית ולהעביר אלינו את הערבות המוארכת בהקדם.
              </p>
            )}

            <div style={{ marginTop:"44px" }}>
              <p>בכבוד רב ובברכה,</p>
              <p style={{ fontWeight:"bold", marginTop:"8px" }}>
                {signerName || result.propertyName}
              </p>
            </div>

            {/* ══════════════ ANNEX A ══════════════ */}
            <div className="page-break" style={{ pageBreakBefore:"always" as any, marginTop:"48px" }}>
              <div className="annex-title" style={{ fontSize:"13px", fontWeight:"bold", textDecoration:"underline", borderBottom:"2px solid #333", paddingBottom:"4px", marginBottom:"14px" }}>
                {result.tenantName} - נספח א&apos; - תחשיב המחאות בגין תשלומים {result.isQuarterly ? "רבעוניים" : "חודשיים"} לשנת שכירות {result.targetYear}
              </div>

              <table className="params-table" style={{ width:"65%", borderCollapse:"collapse" as any, fontSize:"11px" }}>
                <tbody>
                  <tr>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>דמי שכירות בסיסיים לחודש למ"ר בשנת {result.targetYear}</td>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>{result.rentPerSqm}</td>
                  </tr>
                  {result.mgmtFeeNew > 0 && (
                    <tr>
                      <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>מקדמת דמי ניהול חודשי למ"ר (הערכה) בש"ח לשנת {result.targetYear}</td>
                      <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>{result.mgmtFeeNew}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>שטח מושכר במ"ר</td>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>{result.area}</td>
                  </tr>
                  <tr><td colSpan={2} style={{ border:"none", height:"6px" }} /></tr>
                  <tr>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>מדד בסיס</td>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>
                      {fmtMonthYear(result.baseY, result.baseM)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>מדד בסיס בנקודות</td>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>{result.baseIndex}</td>
                  </tr>
                  <tr>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>
                      מדד קובע אחרון {fmtMonthYear(result.latestCpi.year, result.latestCpi.month)}
                    </td>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>
                      {result.latestCpi.value}
                    </td>
                  </tr>
                  <tr><td colSpan={2} style={{ border:"none", height:"6px" }} /></tr>
                  <tr>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>
                      דמי שכירות (צמוד למדד {fmtMonthYear(result.latestCpi.year, result.latestCpi.month)}) לחודש לפני מע"מ
                    </td>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>
                      {fmt(result.monthlyRentIndexed)}
                    </td>
                  </tr>
                  {result.mgmtFeeNew > 0 && (
                    <tr>
                      <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>מקדמת דמי ניהול (הערכה) לחודש לפני מע"מ</td>
                      <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>{fmt(result.monthlyMgmtNew)}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>תנאי תשלום שכירות ודמי ניהול על פי ההסכם</td>
                    <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>{result.isQuarterly ? "רבעוני" : "חודשי"}</td>
                  </tr>
                  {result.hasVat && (
                    <tr>
                      <td style={{ border:"1px solid #ccc", padding:"4px 10px", color:"#444" }}>מע"מ בשנת {result.targetYear}</td>
                      <td style={{ border:"1px solid #ccc", padding:"4px 10px", fontWeight:"bold" }}>{(result.vatRate * 100).toFixed(0)}%</td>
                    </tr>
                  )}
                  <tr style={{ background:"#ddd" }}>
                    <td style={{ border:"1px solid #999", padding:"6px 10px", fontWeight:"bold", fontSize:"12px" }}>
                      סכום כל המחאה {result.hasVat ? "(כולל מע\"מ)" : ""} לכל {result.isQuarterly ? "רבעון" : "חודש"} ל-{result.targetYear}
                    </td>
                    <td style={{ border:"1px solid #999", padding:"6px 10px", fontWeight:"bold", fontSize:"14px" }}>
                      {fmtInt(result.checkAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ══════════════ ANNEX B ══════════════ */}
            <div style={{ marginTop:"36px" }}>
              <div className="annex-title" style={{ fontSize:"13px", fontWeight:"bold", textDecoration:"underline", borderBottom:"2px solid #333", paddingBottom:"4px", marginBottom:"14px" }}>
                {result.tenantName} - נספח ב&apos; – תחשיב הפרשי הצמדה בגין תשלומי שכ"ד ששולמו ב-{result.prevYear}
              </div>

              {/* Header params */}
              <div style={{ fontSize:"11px", marginBottom:"10px", lineHeight:"1.8" }}>
                <span style={{ marginLeft:"24px" }}>שטח מושכר: <strong>{result.area} מ"ר</strong></span>
                <span style={{ marginLeft:"24px" }}>שכ"ד בסיסי למ"ר: <strong>₪{result.rentPerSqm}</strong></span>
                {result.mgmtFeeOld > 0 && (
                  <span style={{ marginLeft:"24px" }}>מקדמת ד"נ למ"ר: <strong>₪{result.mgmtFeeOld}</strong></span>
                )}
                <span style={{ marginLeft:"24px" }}>תשלום: <strong>{result.isQuarterly ? "רבעוני" : "חודשי"}</strong></span>
                {result.hasVat && <span>מע"מ: <strong>{(result.vatRate * 100).toFixed(0)}%</strong></span>}
              </div>

              <table style={{ width:"100%", borderCollapse:"collapse" as any, fontSize:"10.5px" }}>
                <thead>
                  <tr>
                    <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 6px", textAlign:"right" as any }}>מועד התשלום</th>
                    <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 6px", textAlign:"right" as any }}>מדד בסיס</th>
                    <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 6px", textAlign:"right" as any }}>מדד קובע</th>
                    <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 6px", textAlign:"right" as any }}>מדד קובע בנקודות</th>
                    <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 6px", textAlign:"right" as any }}>
                      שכ"ד צמוד למדד {result.hasVat ? "(כולל מע\"מ)" : ""}
                    </th>
                    <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 6px", textAlign:"right" as any }}>הסכום ששולם</th>
                    <th style={{ background:"#ddd", border:"1px solid #999", padding:"5px 6px", textAlign:"right" as any }}>הפרש</th>
                  </tr>
                </thead>
                <tbody>
                  {result.diffRows.map((row: any, i: number) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#f7f7f7" : "white" }}>
                      <td style={{ border:"1px solid #ccc", padding:"4px 6px" }}>
                        {String(payDay).padStart(2,"0")}.{String(row.payMonth).padStart(2,"0")}.{result.prevYear}
                      </td>
                      <td style={{ border:"1px solid #ccc", padding:"4px 6px" }}>
                        {result.baseIndex} ({fmtMonthYear(result.baseY, result.baseM)})
                      </td>
                      <td style={{ border:"1px solid #ccc", padding:"4px 6px" }}>
                        {row.missing ? <span style={{ color:"orange" }}>⚠️ חסר</span> : fmtMonthYear(row.rulingCpiRecord.year, row.rulingCpiRecord.month)}
                      </td>
                      <td style={{ border:"1px solid #ccc", padding:"4px 6px" }}>
                        {row.missing ? "—" : row.rulingCpiRecord.value}
                      </td>
                      <td style={{ border:"1px solid #ccc", padding:"4px 6px" }}>
                        {row.missing ? "—" : fmtInt(row.reqTotal)}
                      </td>
                      <td style={{ border:"1px solid #ccc", padding:"4px 6px" }}>
                        {row.missing ? "—" : fmtInt(row.actualPaid)}
                      </td>
                      <td style={{ border:"1px solid #ccc", padding:"4px 6px", fontWeight:"bold",
                        color: !row.missing && row.diff > 0 ? "#166534" : !row.missing && row.diff < 0 ? "#991b1b" : "inherit"
                      }}>
                        {row.missing ? "—" : fmtInt(row.diff)}
                      </td>
                    </tr>
                  ))}
                  <tr className="total-row" style={{ background:"#ddd", fontWeight:"bold" }}>
                    <td colSpan={6} style={{ border:"1px solid #999", padding:"6px", textAlign:"right" as any }}>
                      סך תשלום עבור השלמת הפרשי הצמדה בגין תשלומי שכר דירה שבוצעו ב-{result.prevYear}
                    </td>
                    <td style={{ border:"1px solid #999", padding:"6px", fontWeight:"bold", fontSize:"13px",
                      color: result.totalDiff > 0 ? "#166534" : result.totalDiff < 0 ? "#991b1b" : "inherit"
                    }}>
                      {fmtInt(result.totalDiff)}
                    </td>
                  </tr>
                </tbody>
              </table>

              <p style={{ fontSize:"10px", marginTop:"6px", color:"#555" }}>
                * המדד הקובע = המדד ה{indexRule === "highest" ? "גבוה לאורך תקופת השכירות" : "ידוע בחודשיים לפני מועד התשלום"}
                {indexRule === "highest" && " (סע׳ 9.4.1 להסכם)"}
              </p>
              {result.isQuarterly && (
                <p style={{ fontSize:"10px", color:"#555", marginTop:"2px" }}>
                  ** תשלום רבעוני — כל שורה מייצגת תשלום של 3 חודשים
                </p>
              )}
            </div>
          </div>
          {/* end printRef */}
        </div>
      )}
    </div>
  );
}
