
"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { createContract } from "../../../../lib/db";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function nextDay(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function monthsBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start), e = new Date(end);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
}

function formatDate(d: string) {
  if (!d) return "";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

interface Option {
  id: number;
  durationValue: string;
  durationUnit: "months" | "years";
  noticeType: "non_renewal" | "exercise";
  noticeMonths: string;
  priceType: "fixed" | "percent" | "none";
  priceValue: string;
}

export default function NewContractPage() {
  const router = useRouter();
  const [dbProperties, setDbProperties] = useState<any[]>([]);
  const [dbTenants, setDbTenants] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("properties").select("id, name, address, units(*)").then(({ data }) => setDbProperties(data ?? []));
    supabase.from("tenants").select("id, name").then(({ data }) => setDbTenants(data ?? []));
  }, []);

  // נכס ויחידות
  const [propertyId, setPropertyId] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [tenantId, setTenantId] = useState("");

  // תקופה
  const [startDate, setStartDate] = useState("");
  const [durationValue, setDurationValue] = useState("");
  const [durationUnit, setDurationUnit] = useState<"months"|"years">("months");
  const [endDate, setEndDate] = useState("");

  // אופציות
  const [hasOptions, setHasOptions] = useState(false);
  const [options, setOptions] = useState<Option[]>([{ id: 1, durationValue: "", durationUnit: "months", noticeType: "non_renewal", noticeMonths: "3", priceType: "none", priceValue: "" }]);

  // מחיר
  const [rentPerSqm, setRentPerSqm] = useState("");
  const [investmentAddition, setInvestmentAddition] = useState("0");
  const [paymentFrequency, setPaymentFrequency] = useState("monthly");
  const [hasPriceIncrease, setHasPriceIncrease] = useState(false);
  const [increaseType, setIncreaseType] = useState<"percent"|"fixed">("percent");
  const [increaseValue, setIncreaseValue] = useState("");
  const [increaseFreqMonths, setIncreaseFreqMonths] = useState("12");

  // מדד
  const [indexBaseDate, setIndexBaseDate] = useState("");
  const [indexBaseValue, setIndexBaseValue] = useState("");

  // דמי ניהול
  const [mgmtFeePerSqm, setMgmtFeePerSqm] = useState("");
  const [vatType, setVatType] = useState<"taxable"|"exempt">("taxable"); // מסחרי=חייב, מגורים=פטור
  const [vatPct, setVatPct] = useState("18"); // אחוז מע&quot;מ נוכחי בישראל

  // ערבות
  const [guaranteeType, setGuaranteeType] = useState("");
  const [guaranteeCalcMethod, setGuaranteeCalcMethod] = useState("months");
  const [guaranteeMonths, setGuaranteeMonths] = useState("3");
  const [guaranteeAmount, setGuaranteeAmount] = useState("");
  const [guaranteeExpiry, setGuaranteeExpiry] = useState("");
  const [guaranteeInitialExpiry, setGuaranteeInitialExpiry] = useState("");
  const [guaranteeIncludesMgmt, setGuaranteeIncludesMgmt] = useState(false);

  // PDF
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedProperty = dbProperties.find((p: any) => p.id === propertyId);
  const availableUnits = selectedProperty?.units ?? [];
  const selectedUnits = availableUnits.filter((u: any) => unitIds.includes(u.id));
  const totalArea = selectedUnits.reduce((s: number, u: any) => s + (u.area ?? 0), 0);
  // חישוב ערבות אוטומטי
  const mgmtMonthly = mgmtFeePerSqm && totalArea ? Number(mgmtFeePerSqm) * totalArea : 0;
  const rentMonthly = rentPerSqm && totalArea ? Number(rentPerSqm) * totalArea + Number(investmentAddition) : 0;
  const vatMultiplier = vatType === "taxable" ? (1 + Number(vatPct)/100) : 1;
  const calcGuaranteeAmount = guaranteeCalcMethod === "months" && guaranteeMonths && rentMonthly
    ? Math.round((rentMonthly + (guaranteeIncludesMgmt ? mgmtMonthly : 0)) * Number(guaranteeMonths) * vatMultiplier)
    : null;
  const monthlyRent = rentPerSqm && totalArea ? (Number(rentPerSqm) * totalArea + Number(investmentAddition)) : null;

  function calcEnd(start: string, val: string, unit: "months"|"years") {
    if (!start || !val) return;
    const months = unit === "years" ? Number(val) * 12 : Number(val);
    setEndDate(addMonths(start, months));
  }

  function updateOption(id: number, field: keyof Option, value: string) {
    setOptions(prev => prev.map(o => o.id === id ? { ...o, [field]: value } : o));
  }

  function addOption() {
    setOptions(prev => [...prev, { id: Date.now(), durationValue: "", durationUnit: "months", noticeType: "non_renewal", noticeMonths: "3", priceType: "none", priceValue: "" }]);
  }

  // ציר זמן
  const optionStartDates: string[] = [];
  const optionEndDates: string[] = [];
  options.forEach((o, i) => {
    const prevEnd = i === 0 ? endDate : optionEndDates[i - 1];
    const optStart = prevEnd ? nextDay(prevEnd) : "";
    optionStartDates.push(optStart);
    const months = o.durationUnit === "years" ? Number(o.durationValue) * 12 : Number(o.durationValue);
    optionEndDates.push(optStart && months ? addMonths(optStart, months) : "");
  });

  async function handlePdfUpload(file: File) {
    if (file.size > 20 * 1024 * 1024) { alert("מקסימום 20MB"); return; }
    setExtracting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
      let text = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
        const page = await pdf.getPage(i);
        const c = await page.getTextContent();
        text += c.items.map((item: any) => item.str).join(" ") + "\n";
      }
      const response = await fetch("/api/extract-contract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await response.json();
      if (data.error) { alert("שגיאה: " + data.error); return; }

      let computedEnd = data.end_date ?? "";
      if (!computedEnd && data.start_date && data.duration_months) {
        computedEnd = addMonths(data.start_date, Number(data.duration_months));
      }
      if (data.start_date) setStartDate(data.start_date);
      if (computedEnd) setEndDate(computedEnd);
      if (data.duration_months) { setDurationValue(data.duration_months.toString()); setDurationUnit("months"); }
      if (data.rent_per_sqm) setRentPerSqm(data.rent_per_sqm.toString());
      if (data.investment_addition) setInvestmentAddition(data.investment_addition.toString());
      if (data.option_months) { setHasOptions(true); setOptions([{ id: 1, durationValue: data.option_months.toString(), durationUnit: "months", noticeType: "non_renewal", noticeMonths: "3", priceType: "none", priceValue: "" }]); }
      if (data.guarantee_type) setGuaranteeType(data.guarantee_type);
      if (data.guarantee_amount) setGuaranteeAmount(data.guarantee_amount.toString());
      if (data.guarantee_expiry) setGuaranteeExpiry(data.guarantee_expiry);
      if (data.index_base_value) setIndexBaseValue(data.index_base_value.toString());
      if (data.index_base_date) setIndexBaseDate(data.index_base_date);
      if (data.payment_frequency) setPaymentFrequency(data.payment_frequency);
      if (data.tenant_name) { const t = dbTenants.find((t: any) => t.name === data.tenant_name); if (t) setTenantId(t.id); }

      const ex = [];
      if (data.start_date) ex.push("התחלה: " + data.start_date);
      if (computedEnd) ex.push("סיום: " + computedEnd);
      if (data.duration_months) ex.push("תקופה: " + data.duration_months + " חודשים");
      if (data.tenant_name) ex.push("שוכר: " + data.tenant_name);
      if (data.rent_per_sqm) ex.push("מחיר למ\"ר: ₪" + data.rent_per_sqm);
      if (data.option_months) ex.push("אופציה: " + data.option_months + " חודשים");
      if (data.guarantee_amount) ex.push("ערבות: ₪" + data.guarantee_amount);
      if (data.index_base_value) ex.push("מדד בסיס: " + data.index_base_value);
      alert("חולץ בהצלחה:\n" + (ex.length ? ex.join("\n") : "לא נמצאו נתונים"));
    } catch(e) { alert("שגיאה: " + e); }
    finally { setExtracting(false); }
  }

  async function handleSave() {
    // בדיקת מדדים חסרים
    if (indexBaseDate && indexBaseValue) {
      try {
        const res = await fetch(`/api/cpi-check?from=${indexBaseDate}&base_year=2020`);
        const { missing } = await res.json();
        if (missing?.length > 0) {
          const proceed = confirm(`⚠️ חסרים ${missing.length} מדדים מ-${missing[0]} עד ${missing[missing.length-1]}.\nהמערכת תנסה למשוך אותם אוטומטית. להמשיך?`);
          if (!proceed) return;
          await fetch(`/api/cpi?year=${new Date().getFullYear()}&refresh=true`);
        }
      } catch {}
    }
    if (!propertyId || !tenantId || !startDate || !endDate) { alert("חובה: נכס, שוכר, תאריכים"); return; }
    try {
      await createContract({
        property_id: propertyId, tenant_id: tenantId, unit_ids: unitIds,
        start_date: startDate, end_date: endDate,
        rent_per_sqm: Number(rentPerSqm), charged_area: totalArea,
        investment_addition: Number(investmentAddition), payment_frequency: paymentFrequency,
        index_base_date: indexBaseDate || undefined, index_base_value: indexBaseValue ? Number(indexBaseValue) : undefined,
        option_months: hasOptions && options[0]?.durationValue ? (options[0].durationUnit === "years" ? Number(options[0].durationValue)*12 : Number(options[0].durationValue)) : undefined,
        guarantee_type: guaranteeType || undefined, guarantee_amount: guaranteeAmount ? Number(guaranteeAmount) : undefined, guarantee_expiry: guaranteeExpiry || undefined
      });
      alert("חוזה נשמר!");
      router.push("/contracts");
    } catch(e) { alert("שגיאה: " + e); }
  }

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-700 text-2xl">&larr;</button>
        <h1 className="text-2xl font-bold text-slate-800">חוזה חדש</h1>
      </div>
      <div className="space-y-5">

        {/* PDF */}
        <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 p-4 flex items-center gap-4">
          <div className="text-3xl">📄</div>
          <div className="flex-1">
            <div className="font-bold text-slate-800 mb-0.5">חילוץ נתונים מחוזה קיים</div>
            <div className="text-xs text-slate-500">העלה PDF — ה-AI יחלץ את הנתונים אוטומטית</div>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfUpload(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={extracting} className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap">
            {extracting ? "⏳ מחלץ..." : "העלה PDF"}
          </button>
        </div>

        {/* נכס */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">נכס ויחידות</h2>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
            <select value={propertyId} onChange={e => { setPropertyId(e.target.value); setUnitIds([]); }} className={ic}>
              <option value="">-- בחר נכס --</option>
              {dbProperties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {selectedProperty && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">יחידות *</label>
              <div className="space-y-1.5 rounded-lg border border-slate-200 p-3 bg-slate-50">
                {availableUnits.map((u: any) => (
                  <label key={u.id} className="flex items-center gap-3 cursor-pointer hover:bg-white rounded-lg p-2">
                    <input type="checkbox" checked={unitIds.includes(u.id)} onChange={() => setUnitIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])} className="w-4 h-4" />
                    <span className="text-sm font-medium text-slate-800">{u.name}</span>
                    <span className="text-xs text-slate-400">{u.area} מ"ר</span>
                    <span className={`mr-auto text-xs font-bold px-2 py-0.5 rounded-full ${u.status === "vacant" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                      {u.status === "vacant" ? "פנוי" : "מושכר"}
                    </span>
                  </label>
                ))}
              </div>
              {unitIds.length > 0 && <div className="mt-2 text-xs font-medium text-blue-600">סה"כ שטח: {totalArea} מ"ר</div>}
            </div>
          )}
        </div>

        {/* שוכר */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">שוכר</h2>
          <select value={tenantId} onChange={e => setTenantId(e.target.value)} className={ic}>
            <option value="">-- בחר שוכר --</option>
            {dbTenants.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={() => router.push("/tenants/new")} className="mt-2 text-xs text-blue-600 hover:underline">+ צור שוכר חדש</button>
        </div>

        {/* תקופה */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">תקופת חוזה</h2>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך התחלה *</label>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); calcEnd(e.target.value, durationValue, durationUnit); }} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">משך תקופה</label>
              <div className="flex gap-2">
                <input type="number" value={durationValue} onChange={e => { setDurationValue(e.target.value); calcEnd(startDate, e.target.value, durationUnit); }} placeholder="36" className={ic} />
                <select value={durationUnit} onChange={e => { setDurationUnit(e.target.value as any); calcEnd(startDate, durationValue, e.target.value as any); }} className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-800 bg-white">
                  <option value="months">חודשים</option>
                  <option value="years">שנים</option>
                </select>
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך סיום *</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={ic} />
          </div>
        </div>

        {/* אופציות */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-700">אופציות הארכה</h2>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={!hasOptions} onChange={() => setHasOptions(false)} /> לא
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={hasOptions} onChange={() => setHasOptions(true)} /> כן
              </label>
            </div>
          </div>
          {hasOptions && (
            <div className="space-y-4">
              {options.map((o, i) => {
                const optStart = optionStartDates[i];
                const optEnd = optionEndDates[i];
                return (
                  <div key={o.id} className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-blue-700">אופציה {i+1}</span>
                      {optStart && optEnd && <span className="text-xs text-slate-500">{formatDate(optStart)} — {formatDate(optEnd)}</span>}
                      {options.length > 1 && <button onClick={() => setOptions(prev => prev.filter(x => x.id !== o.id))} className="text-red-400 text-xs hover:text-red-600">הסר</button>}
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">משך האופציה</label>
                        <div className="flex gap-2">
                          <input type="number" value={o.durationValue} onChange={e => updateOption(o.id, "durationValue", e.target.value)} placeholder="24" className={ic} />
                          <select value={o.durationUnit} onChange={e => updateOption(o.id, "durationUnit", e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-800 bg-white">
                            <option value="months">חודשים</option>
                            <option value="years">שנים</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">הודעה מוקדמת (חודשים)</label>
                        <input type="number" value={o.noticeMonths} onChange={e => updateOption(o.id, "noticeMonths", e.target.value)} placeholder="3" className={ic} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">סוג הודעה</label>
                        <select value={o.noticeType} onChange={e => updateOption(o.id, "noticeType", e.target.value)} className={ic}>
                          <option value="non_renewal">הודעה על אי חידוש</option>
                          <option value="exercise">הודעה על מימוש</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">מנגנון מחיר</label>
                        <select value={o.priceType} onChange={e => updateOption(o.id, "priceType", e.target.value)} className={ic}>
                          <option value="none">ללא שינוי מחיר</option>
                          <option value="percent">עלייה באחוזים</option>
                          <option value="fixed">מחיר קבוע חדש</option>
                        </select>
                      </div>
                    </div>
                    {o.priceType !== "none" && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        {o.priceType === "percent" ? "אחוז עלייה" : 'מחיר חדש למ"ר (₪)'}
                      </label>
                      <input type="number" value={o.priceValue} onChange={e => updateOption(o.id, "priceValue", e.target.value)} placeholder={o.priceType === "percent" ? "5" : "0"} className={ic} />
                    </div>
                    )}
                  </div>
                );
              })}
              <button onClick={addOption} className="w-full rounded-lg border border-dashed border-blue-300 py-2 text-sm text-blue-600 hover:bg-blue-50">
                + הוסף אופציה נוספת
              </button>
            </div>
          )}
        </div>

        {/* ציר זמן */}
        {startDate && endDate && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-500">📅 ציר זמן החוזה</h2>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-blue-500 shrink-0"></div>
                <div className="flex-1 text-sm">
                  <span className="font-medium text-slate-700">תקופה ראשית</span>
                  <span className="text-slate-400 mr-2">{formatDate(startDate)} — {formatDate(endDate)}</span>
                  {durationValue && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{durationValue} {durationUnit === "years" ? "שנים" : "חודשים"}</span>}
                </div>
              </div>
              {hasOptions && options.map((o, i) => optionEndDates[i] && (
                <div key={o.id} className="flex items-center gap-3 mr-1.5 border-r-2 border-dashed border-slate-200 pr-4">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0 -mr-5"></div>
                  <div className="flex-1 text-sm mr-2">
                    <span className="font-medium text-slate-600">אופציה {i+1}</span>
                    <span className="text-slate-400 mr-2">{formatDate(optionStartDates[i])} — {formatDate(optionEndDates[i])}</span>
                    {o.durationValue && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{o.durationValue} {o.durationUnit === "years" ? "שנים" : "חודשים"}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* תנאי תשלום */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">תנאי תשלום</h2>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תעריף למ"ר (₪) *</label>
              <input type="number" value={rentPerSqm} onChange={e => setRentPerSqm(e.target.value)} placeholder="0" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעות (₪)</label>
              <input type="number" value={investmentAddition} onChange={e => setInvestmentAddition(e.target.value)} placeholder="0" className={ic} />
            </div>
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות תשלום</label>
            <select value={paymentFrequency} onChange={e => setPaymentFrequency(e.target.value)} className={ic}>
              <option value="monthly">חודשי</option>
              <option value="quarterly">רבעוני</option>
              <option value="other">אחר</option>
            </select>
          </div>
          {monthlyRent && (
            <div className="rounded-lg bg-green-50 border border-green-100 px-4 py-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">שכ"ד חודשי לפני מע&quot;מ</span>
                <span className="text-xl font-bold text-green-700">₪{monthlyRent.toLocaleString()}</span>
              </div>
              {vatType === "taxable" && (
                <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-green-200">
                  <span className="text-sm text-green-600">כולל מע&quot;מ {vatPct}%</span>
                  <span className="text-lg font-bold text-green-800">₪{Math.round(monthlyRent * (1 + Number(vatPct)/100)).toLocaleString()}</span>
                </div>
              )}
              {paymentFrequency === "quarterly" && (
                <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-green-200">
                  <span className="text-sm text-green-600">תשלום רבעוני{vatType === "taxable" ? " כולל מע&quot;מ" : ""}</span>
                  <span className="text-lg font-bold text-green-800">₪{Math.round(monthlyRent * (vatType === "taxable" ? (1 + Number(vatPct)/100) : 1) * 3).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          {/* עליית מחיר */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-medium text-slate-600">מנגנון עליית מחיר במהלך החוזה</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" checked={!hasPriceIncrease} onChange={() => setHasPriceIncrease(false)} /> לא</label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" checked={hasPriceIncrease} onChange={() => setHasPriceIncrease(true)} /> כן</label>
              </div>
            </div>
            {hasPriceIncrease && (
              <div className="rounded-xl bg-slate-50 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">סוג עלייה</label>
                    <select value={increaseType} onChange={e => setIncreaseType(e.target.value as any)} className={ic}>
                      <option value="percent">אחוז מהמחיר הקודם</option>
                      <option value="fixed">סכום קבוע (₪)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">{increaseType === "percent" ? "אחוז עלייה" : "סכום עלייה (₪)"}</label>
                    <input type="number" value={increaseValue} onChange={e => setIncreaseValue(e.target.value)} placeholder={increaseType === "percent" ? "3" : "500"} className={ic} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות (כל כמה חודשים)</label>
                  <select value={increaseFreqMonths} onChange={e => setIncreaseFreqMonths(e.target.value)} className={ic}>
                    <option value="12">כל שנה (12 חודשים)</option>
                    <option value="24">כל שנתיים (24 חודשים)</option>
                    <option value="36">כל 3 שנים (36 חודשים)</option>
                  </select>
                </div>
                {/* סימולציה */}
                {rentPerSqm && totalArea && increaseValue && startDate && endDate && (
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-2">סימולציית מחיר עתידי</div>
                    <div className="space-y-1">
                      {(() => {
                        const rows = [];
                        let current = Number(rentPerSqm);
                        const freq = Number(increaseFreqMonths);
                        const totalMonths = monthsBetween(startDate, endDate);
                        for (let m = 0; m <= totalMonths; m += freq) {
                          const d = addMonths(startDate, m);
                          rows.push({ date: d, rent: current });
                          if (increaseType === "percent") current = current * (1 + Number(increaseValue)/100);
                          else current = current + Number(increaseValue);
                        }
                        return rows.slice(0,6).map((r,i) => (
                          <div key={i} className="flex justify-between text-xs bg-white rounded px-3 py-1.5">
                            <span className="text-slate-500">{formatDate(r.date)}</span>
                            <span className="font-medium text-slate-700">₪{r.rent.toFixed(2)} למ"ר <span className="text-slate-400">({totalArea > 0 ? "₪"+Math.round(r.rent * totalArea).toLocaleString() : "—"} / חודש)</span></span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* מדד */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-700">מדד הצמדה</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">חודש בסיס</label>
              <select value={indexBaseDate ? indexBaseDate.split("-")[1] : ""} onChange={e => { const y = indexBaseDate ? indexBaseDate.split("-")[0] : new Date().getFullYear().toString(); setIndexBaseDate(y + "-" + e.target.value.padStart(2,"0")); }} className={ic}>
                <option value="">חודש</option>
                {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m,i) => <option key={m} value={m}>{["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"][i]}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שנת בסיס</label>
              <input type="number" value={indexBaseDate ? indexBaseDate.split("-")[0] : ""} onChange={e => { const m = indexBaseDate ? indexBaseDate.split("-")[1] : "01"; setIndexBaseDate(e.target.value + "-" + m); }} placeholder="2021" className={ic} min="2000" max="2099" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">ערך מדד בסיס</label>
              <input type="number" step="0.01" value={indexBaseValue} onChange={e => setIndexBaseValue(e.target.value)} placeholder="108.50" className={ic} />
            </div>
          </div>
          {indexBaseDate && indexBaseValue && (
            <div className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              מדד בסיס: <span className="font-bold text-slate-700">{indexBaseValue}</span> — {indexBaseDate.split("-")[1]}/{indexBaseDate.split("-")[0]}
            </div>
          )}
        </div>

        {/* דמי ניהול */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-700">דמי ניהול</h2>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={vatType === "taxable"} onChange={() => setVatType("taxable")} className="w-3.5 h-3.5" />
                <span className="text-slate-700">חייב מע&quot;מ ({vatPct}%)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={vatType === "exempt"} onChange={() => setVatType("exempt")} className="w-3.5 h-3.5" />
                <span className="text-slate-700">פטור ממע&quot;מ</span>
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול למ"ר לחודש (₪)</label>
              <input type="number" step="0.01" value={mgmtFeePerSqm} onChange={e => setMgmtFeePerSqm(e.target.value)} placeholder="0.00" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז מע&quot;מ</label>
              <select value={vatPct} onChange={e => setVatPct(e.target.value)} className={ic}>
                <option value="0">ללא מע&quot;מ (0%)</option>
                <option value="17">17%</option>
                <option value="18">18%</option>
              </select>
            </div>
          </div>
          {mgmtFeePerSqm && totalArea > 0 && (
            <div className="mt-3 rounded-lg bg-slate-50 px-4 py-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">דמי ניהול לפני מע&quot;מ</span>
                <span className="font-bold text-slate-800">₪{(Number(mgmtFeePerSqm) * totalArea).toLocaleString()}</span>
              </div>
              {vatType === "taxable" && (
                <div className="flex justify-between mt-1">
                  <span className="text-slate-500">+ מע&quot;מ {vatPct}%</span>
                  <span className="font-bold text-slate-700">₪{Math.round(Number(mgmtFeePerSqm) * totalArea * (1 + Number(vatPct)/100)).toLocaleString()} כולל מע&quot;מ</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ערבות */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-700">ערבות</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">סוג ערבות</label>
              <select value={guaranteeType} onChange={e => setGuaranteeType(e.target.value)} className={ic}>
                <option value="">-- בחר --</option>
                <option value="bank">ערבות בנקאית</option>
                <option value="check">שיק ביטחון</option>
                <option value="cash">פיקדון מזומן</option>
                <option value="other">אחר</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שיטת חישוב סכום</label>
              <select value={guaranteeCalcMethod} onChange={e => setGuaranteeCalcMethod(e.target.value)} className={ic}>
                <option value="months">לפי חודשי שכירות</option>
                <option value="fixed">סכום קבוע</option>
              </select>
            </div>
          </div>

          {guaranteeCalcMethod === "months" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר חודשים</label>
                  <input type="number" value={guaranteeMonths} onChange={e => setGuaranteeMonths(e.target.value)} placeholder="3" className={ic} />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                    <input type="checkbox" checked={guaranteeIncludesMgmt} onChange={e => setGuaranteeIncludesMgmt(e.target.checked)} className="w-4 h-4" />
                    כולל דמי ניהול
                  </label>
                </div>
              </div>
              {calcGuaranteeAmount && (
                <div className="rounded-lg bg-green-50 border border-green-100 px-4 py-3 flex justify-between items-center">
                  <span className="text-sm text-slate-600">סכום ערבות מחושב ({guaranteeMonths} חודשים{guaranteeIncludesMgmt ? " + ניהול" : ""}{includesVat ? " + מע&quot;מ" : ""})</span>
                  <span className="text-xl font-bold text-green-700">₪{calcGuaranteeAmount.toLocaleString()}</span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">סכום קבוע (₪)</label>
              <input type="number" value={guaranteeAmount} onChange={e => setGuaranteeAmount(e.target.value)} placeholder="0" className={ic} />
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תוקף ערבות קיימת (בחתימה)</label>
              <input type="date" value={guaranteeInitialExpiry} onChange={e => setGuaranteeInitialExpiry(e.target.value)} className={ic} />
              <div className="text-xs text-slate-400 mt-1">תוקף הערבות שהתקבלה בחתימה</div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תוקף מחויב לפי הסכם</label>
              <input type="date" value={guaranteeExpiry} onChange={e => setGuaranteeExpiry(e.target.value)} className={ic} />
              <div className="text-xs text-slate-400 mt-1">בדר"כ 3 חודשים אחרי סיום השכירות</div>
            </div>
          </div>
          {endDate && !guaranteeExpiry && (
            <button onClick={() => { const d = new Date(endDate); d.setMonth(d.getMonth()+3); setGuaranteeExpiry(d.toISOString().split("T")[0]); }} className="mt-2 text-xs text-blue-600 hover:underline">
              ← חשב אוטומטי (3 חודשים אחרי סיום)
            </button>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={() => router.back()} className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">ביטול</button>
          <button onClick={handleSave} className="flex-1 rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800">שמור חוזה</button>
        </div>
      </div>
    </div>
  );
}
