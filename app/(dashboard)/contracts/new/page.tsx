"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { createContract } from "../../../../lib/db";
import { ContractSpacesSelector, SpaceCharge } from "../../../../components/ContractSpacesSelector";

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
  noticeType: string;
  noticeMonths: string;
  priceType: string;
  priceValue: string;
}

export default function NewContractPage() {
  const router = useRouter();
  const [dbProperties, setDbProperties] = useState<any[]>([]);
  const [dbTenants, setDbTenants]       = useState<any[]>([]);

  useEffect(() => {
    supabase.from("properties").select("id, name, address, spaces(*), units(*)").then(function({ data }) { setDbProperties(data ?? []); });
    supabase.from("tenants").select("id, name").then(function({ data }) { setDbTenants(data ?? []); });
    try {
      const draft = sessionStorage.getItem("contract_draft");
      if (draft) {
        const d = JSON.parse(draft);
        if (d.propertyId) setPropertyId(d.propertyId);
        if (d.unitIds)    setUnitIds(d.unitIds);
        if (d.tenantId)   setTenantId(d.tenantId);
        if (d.startDate)  setStartDate(d.startDate);
        if (d.endDate)    setEndDate(d.endDate);
        if (d.durationValue) setDurationValue(d.durationValue);
        if (d.durationUnit)  setDurationUnit(d.durationUnit);
        if (d.rentPerSqm)    setRentPerSqm(d.rentPerSqm);
        if (d.investmentAddition) setInvestmentAddition(d.investmentAddition);
        if (d.paymentFrequency)   setPaymentFrequency(d.paymentFrequency);
        if (d.indexBaseDate)  setIndexBaseDate(d.indexBaseDate);
        if (d.indexBaseValue) setIndexBaseValue(d.indexBaseValue);
        if (d.mgmtFeePerSqm)  setMgmtFeePerSqm(d.mgmtFeePerSqm);
        if (d.vatType)   setVatType(d.vatType);
        if (d.vatPct)    setVatPct(d.vatPct);
        if (d.guaranteeType)   setGuaranteeType(d.guaranteeType);
        if (d.guaranteeAmount) setGuaranteeAmount(d.guaranteeAmount);
        if (d.guaranteeExpiry) setGuaranteeExpiry(d.guaranteeExpiry);
        if (d.hasOptions !== undefined) setHasOptions(d.hasOptions);
        if (d.options)   setOptions(d.options);
        if (d.hasPriceIncrease !== undefined) setHasPriceIncrease(d.hasPriceIncrease);
        if (d.increaseType)  setIncreaseType(d.increaseType);
        if (d.increaseValue) setIncreaseValue(d.increaseValue);
        if (d.increaseFreqMonths)  setIncreaseFreqMonths(d.increaseFreqMonths);
        if (d.increaseUntilYear)   setIncreaseUntilYear(d.increaseUntilYear);
      }
    } catch {}
  }, []);

  const [propertyId, setPropertyId]   = useState("");
  const [unitIds, setUnitIds]         = useState<string[]>([]);
  const [tenantId, setTenantId]       = useState("");
  const [startDate, setStartDate]     = useState("");
  const [durationValue, setDurationValue] = useState("");
  const [durationUnit, setDurationUnit]   = useState("months");
  const [endDate, setEndDate]         = useState("");
  const [hasOptions, setHasOptions]   = useState(false);
  const [options, setOptions]         = useState<Option[]>([{
    id: 1, durationValue: "", durationUnit: "months",
    noticeType: "non_renewal", noticeMonths: "3",
    priceType: "none", priceValue: ""
  }]);
  const [rentPerSqm, setRentPerSqm]   = useState("");
  const [investmentAddition, setInvestmentAddition] = useState("0");
  const [paymentFrequency, setPaymentFrequency]     = useState("monthly");
  const [hasPriceIncrease, setHasPriceIncrease]     = useState(false);
  const [increaseType, setIncreaseType]   = useState("percent");
  const [increaseValue, setIncreaseValue] = useState("");
  const [increaseFreqMonths, setIncreaseFreqMonths] = useState("12");
  const [increaseUntilYear, setIncreaseUntilYear]   = useState("");
  const [indexBaseDate, setIndexBaseDate]   = useState("");
  const [indexBaseValue, setIndexBaseValue] = useState("");
  const [fetchingCpi, setFetchingCpi]       = useState(false);
  const [mgmtFeePerSqm, setMgmtFeePerSqm]  = useState("");
  const [vatType, setVatType]   = useState("taxable");
  const [vatPct, setVatPct]     = useState("18");
  const [guaranteeType, setGuaranteeType]       = useState("");
  const [guaranteeCalcMethod, setGuaranteeCalcMethod] = useState("months");
  const [guaranteeMonths, setGuaranteeMonths]   = useState("3");
  const [guaranteeAmount, setGuaranteeAmount]   = useState("");
  const [guaranteeExpiry, setGuaranteeExpiry]   = useState("");
  const [guaranteeInitialExpiry, setGuaranteeInitialExpiry] = useState("");
  const [guaranteeIncludesMgmt, setGuaranteeIncludesMgmt] = useState(false);
  const [documentUrl, setDocumentUrl] = useState("");
  const [selectedSpaces, setSelectedSpaces] = useState<SpaceCharge[]>([]);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedProperty = dbProperties.find(function(p: any) { return p.id === propertyId; });
  const availableUnits   = (selectedProperty?.spaces ?? selectedProperty?.units ?? []);
  const selectedUnits    = availableUnits.filter(function(u: any) { return unitIds.includes(u.id); });
  const totalArea        = selectedUnits.reduce(function(s: number, u: any) { return s + (u.area ?? 0); }, 0);
  const spacesArea       = selectedSpaces.filter(function(s) { return s.charge_method === "per_sqm" && s.area; })
                            .reduce(function(acc, s) { return acc + (s.area ?? 0); }, 0);
  const mgmtMonthly      = mgmtFeePerSqm && totalArea ? Number(mgmtFeePerSqm) * totalArea : 0;
  const rentMonthly      = rentPerSqm && totalArea ? Number(rentPerSqm) * totalArea + Number(investmentAddition) : 0;
  const vatMultiplier    = vatType === "taxable" ? (1 + Number(vatPct)/100) : 1;
  const calcGuaranteeAmount = guaranteeCalcMethod === "months" && guaranteeMonths && rentMonthly
    ? Math.round((rentMonthly + (guaranteeIncludesMgmt ? mgmtMonthly : 0)) * Number(guaranteeMonths) * vatMultiplier)
    : null;
  const monthlyRent = rentPerSqm && totalArea
    ? (Number(rentPerSqm) * totalArea + Number(investmentAddition))
    : null;

  function calcEnd(start: string, val: string, unit: string) {
    if (!start || !val) return;
    const months = unit === "years" ? Number(val) * 12 : Number(val);
    setEndDate(addMonths(start, months));
  }

  function updateOption(id: number, field: string, value: string) {
    setOptions(function(prev) { return prev.map(function(o) { return o.id === id ? { ...o, [field]: value } : o; }); });
  }

  function addOption() {
    setOptions(function(prev) {
      return [...prev, { id: Date.now(), durationValue: "", durationUnit: "months", noticeType: "non_renewal", noticeMonths: "3", priceType: "none", priceValue: "" }];
    });
  }

  const optionStartDates: string[] = [];
  const optionEndDates:   string[] = [];
  options.forEach(function(o, i) {
    const prevEnd  = i === 0 ? endDate : optionEndDates[i-1];
    const optStart = prevEnd ? nextDay(prevEnd) : "";
    optionStartDates.push(optStart);
    const months = o.durationUnit === "years" ? Number(o.durationValue) * 12 : Number(o.durationValue);
    optionEndDates.push(optStart && months ? addMonths(optStart, months) : "");
  });

  async function fetchCpiForBaseDate() {
    if (!indexBaseDate) return;
    setFetchingCpi(true);
    try {
      const [year, month] = indexBaseDate.split("-");
      const res = await fetch("/api/cpi?year=" + year);
      const data = await res.json();
      const records = data.records ?? data ?? [];
      const found = Array.isArray(records) && records.find(function(r: any) { return r.year === Number(year) && r.month === Number(month); });
      if (found) {
        setIndexBaseValue(found.value.toString());
      } else {
        const res2 = await fetch("/api/cpi?from_year=" + year + "&to_year=" + year + "&refresh=true");
        const data2 = await res2.json();
        const records2 = data2.records ?? data2 ?? [];
        const found2 = Array.isArray(records2) && records2.find(function(r: any) { return r.year === Number(year) && r.month === Number(month); });
        if (found2) {
          setIndexBaseValue(found2.value.toString());
        } else {
          alert("לא נמצא מדד עבור " + month + "/" + year);
        }
      }
    } catch { alert("שגיאה במשיכת המדד"); }
    finally { setFetchingCpi(false); }
  }

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
        text += c.items.map(function(item: any) { return item.str; }).join(" ") + "\n";
      }
      const response = await fetch("/api/extract-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      const data = await response.json();
      if (data.error) { alert("שגיאה: " + data.error); return; }
      let computedEnd = data.end_date ?? "";
      if (!computedEnd && data.start_date && data.duration_months) computedEnd = addMonths(data.start_date, Number(data.duration_months));
      if (data.start_date) setStartDate(data.start_date);
      if (computedEnd)     setEndDate(computedEnd);
      if (data.duration_months) { setDurationValue(data.duration_months.toString()); setDurationUnit("months"); }
      if (data.rent_per_sqm)    setRentPerSqm(data.rent_per_sqm.toString());
      if (data.investment_addition) setInvestmentAddition(data.investment_addition.toString());
      if (data.option_months) {
        setHasOptions(true);
        setOptions([{ id: 1, durationValue: data.option_months.toString(), durationUnit: "months", noticeType: "non_renewal", noticeMonths: "3", priceType: "none", priceValue: "" }]);
      }
      if (data.guarantee_type)   setGuaranteeType(data.guarantee_type);
      if (data.guarantee_amount) setGuaranteeAmount(data.guarantee_amount.toString());
      if (data.guarantee_expiry) setGuaranteeExpiry(data.guarantee_expiry);
      if (data.index_base_value) setIndexBaseValue(data.index_base_value.toString());
      if (data.index_base_date)  setIndexBaseDate(data.index_base_date);
      if (data.payment_frequency) setPaymentFrequency(data.payment_frequency);
      if (data.tenant_name) {
        const t = dbTenants.find(function(t: any) { return t.name === data.tenant_name; });
        if (t) setTenantId(t.id);
      }
      const ex = [];
      if (data.start_date)     ex.push("התחלה: " + data.start_date);
      if (computedEnd)         ex.push("סיום: " + computedEnd);
      if (data.duration_months) ex.push("תקופה: " + data.duration_months + " חודשים");
      if (data.tenant_name)    ex.push("שוכר: " + data.tenant_name);
      if (data.rent_per_sqm)   ex.push("מחיר למ\"ר: ₪" + data.rent_per_sqm);
      if (data.option_months)  ex.push("אופציה: " + data.option_months + " חודשים");
      if (data.guarantee_amount) ex.push("ערבות: ₪" + data.guarantee_amount);
      if (data.index_base_value) ex.push("מדד בסיס: " + data.index_base_value);
      alert("חולץ בהצלחה:\n" + (ex.length ? ex.join("\n") : "לא נמצאו נתונים"));
    } catch(e) { alert("שגיאה: " + e); }
    finally { setExtracting(false); }
  }

  async function handleSave() {
    if (!propertyId || !tenantId || !startDate || !endDate) {
      alert("חובה: נכס, שוכר, תאריכים");
      return;
    }
    try {
      // בנה spaceInputs מהשטחים שנבחרו
      const spaceInputs = selectedSpaces.map(function(sc) {
        return {
          space_id:       sc.space_id,
          charge_method:  sc.charge_method,
          price_per_sqm:  sc.price_per_sqm ? Number(sc.price_per_sqm) : undefined,
          fixed_amount:   sc.fixed_amount ? Number(sc.fixed_amount) : undefined,
          quantity:       sc.quantity ?? undefined,
          price_per_unit: sc.price_per_unit ? Number(sc.price_per_unit) : undefined,
          revenue_pct:    sc.revenue_pct ? Number(sc.revenue_pct) : undefined,
          min_rent:       sc.min_rent ? Number(sc.min_rent) : undefined,
          revenue_type:   (sc as any).revenue_type,
          included_in_main_rent: sc.included_in_main_rent,
          notes:          sc.notes,
        };
      });

      // בנה optionInputs מהסטייט — המר חודשים לימים
      const optionInputs = hasOptions
        ? options
            .filter(function(o) { return o.durationValue && Number(o.durationValue) > 0; })
            .map(function(o) {
              return {
                durationMonths: o.durationUnit === "years" ? Number(o.durationValue) * 12 : Number(o.durationValue),
                noticeDaysBefore: Number(o.noticeMonths) * 30,
                noticeType: o.noticeType,
                rentMechanism: o.priceType === "none" ? "no_change" : o.priceType === "percent" ? "pct_increase" : "fixed",
                rentIncreasePct: o.priceType === "percent" && o.priceValue ? Number(o.priceValue) : undefined,
                newRentValue: o.priceType === "fixed" && o.priceValue ? Number(o.priceValue) : undefined,
              };
            })
        : [];

      await createContract({
        property_id:   propertyId,
        tenant_id:     tenantId,
        unit_ids:      unitIds,
        start_date:    startDate,
        end_date:      endDate,
        rent_per_sqm:  Number(rentPerSqm),
        charged_area:  totalArea,
        investment_addition: Number(investmentAddition),
        payment_frequency: paymentFrequency,
        price_increase_type:        hasPriceIncrease ? increaseType : null,
        price_increase_value:       hasPriceIncrease && increaseValue ? Number(increaseValue) : null,
        price_increase_freq_months: hasPriceIncrease ? Number(increaseFreqMonths) : null,
        price_increase_until_year:  hasPriceIncrease && increaseUntilYear ? Number(increaseUntilYear) : null,
        index_base_date:  indexBaseDate ? indexBaseDate + "-01" : null,
        index_base_value: indexBaseValue ? Number(indexBaseValue) : null,
        index_base_month: indexBaseDate ? Number(indexBaseDate.split("-")[1]) : null,
        index_base_year:  indexBaseDate ? Number(indexBaseDate.split("-")[0]) : null,
        mgmt_fee_per_sqm: mgmtFeePerSqm ? Number(mgmtFeePerSqm) : null,
        vat_type:         vatType,
        vat_pct:          Number(vatPct),
        guarantee_type:   guaranteeType || null,
        guarantee_amount: guaranteeAmount ? Number(guaranteeAmount) : (calcGuaranteeAmount ?? null),
        guarantee_expiry: guaranteeExpiry || null,
        status: "active",
      }, optionInputs, spaceInputs);

      try { sessionStorage.removeItem("contract_draft"); } catch {}
      alert("חוזה נשמר!" + (optionInputs.length > 0 ? "\n" + optionInputs.length + " אופציות נשמרו." : ""));
      router.push("/contracts");
    } catch(e: any) {
      try {
        sessionStorage.setItem("contract_draft", JSON.stringify({
          propertyId, unitIds, tenantId, startDate, endDate, durationValue, durationUnit,
          rentPerSqm, investmentAddition, paymentFrequency, indexBaseDate, indexBaseValue,
          mgmtFeePerSqm, vatType, vatPct, guaranteeType, guaranteeAmount, guaranteeExpiry,
          hasOptions, options, hasPriceIncrease, increaseType, increaseValue, increaseFreqMonths, increaseUntilYear
        }));
      } catch {}
      const msg = e?.message || e?.details || e?.hint || JSON.stringify(e) || "שגיאה לא ידועה";
      alert("שגיאה: " + msg + "\n\nהנתונים נשמרו כטיוטה.");
    }
  }

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={function() { router.back(); }} className="text-slate-400 hover:text-slate-700 text-2xl">&larr;</button>
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
          <input ref={fileRef} type="file" accept=".pdf" className="hidden"
            onChange={function(e) { const f = e.target.files?.[0]; if (f) handlePdfUpload(f); }} />
          <button onClick={function() { fileRef.current?.click(); }} disabled={extracting}
            className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap">
            {extracting ? "⏳ מחלץ..." : "העלה PDF"}
          </button>
        </div>

        {/* נכס */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">נכס ויחידות</h2>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
            <select value={propertyId}
              onChange={function(e) { setPropertyId(e.target.value); setUnitIds([]); }}
              className={ic}>
              <option value="">-- בחר נכס --</option>
              {dbProperties.map(function(p: any) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
            </select>
          </div>
          {selectedProperty && (
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700">שטחים ויחידות *</label>
              <ContractSpacesSelector
                availableSpaces={availableUnits}
                selectedSpaces={selectedSpaces}
                onChange={setSelectedSpaces}
              />
            </div>
          )}
        </div>

        {/* שוכר */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">שוכר</h2>
          <select value={tenantId} onChange={function(e) { setTenantId(e.target.value); }} className={ic}>
            <option value="">-- בחר שוכר --</option>
            {dbTenants.map(function(t: any) { return <option key={t.id} value={t.id}>{t.name}</option>; })}
          </select>
          <button onClick={function() { router.push("/tenants/new"); }} className="mt-2 text-xs text-blue-600 hover:underline">
            + צור שוכר חדש
          </button>
        </div>

        {/* תקופה */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">תקופת חוזה</h2>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך התחלה *</label>
              <input type="date" value={startDate}
                onChange={function(e) { setStartDate(e.target.value); calcEnd(e.target.value, durationValue, durationUnit); }}
                className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">משך תקופה</label>
              <div className="flex gap-2">
                <input type="number" value={durationValue}
                  onChange={function(e) { setDurationValue(e.target.value); calcEnd(startDate, e.target.value, durationUnit); }}
                  placeholder="36" className={ic} />
                <select value={durationUnit}
                  onChange={function(e) { setDurationUnit(e.target.value); calcEnd(startDate, durationValue, e.target.value); }}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-800 bg-white">
                  <option value="months">חודשים</option>
                  <option value="years">שנים</option>
                </select>
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך סיום *</label>
            <input type="date" value={endDate} onChange={function(e) { setEndDate(e.target.value); }} className={ic} />
          </div>
        </div>

        {/* אופציות */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-700">אופציות הארכה</h2>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={!hasOptions} onChange={function() { setHasOptions(false); }} /> לא
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={hasOptions} onChange={function() { setHasOptions(true); }} /> כן
              </label>
            </div>
          </div>
          {hasOptions && (
            <div className="space-y-4">
              {options.map(function(o, i) {
                const optStart = optionStartDates[i];
                const optEnd   = optionEndDates[i];
                return (
                  <div key={o.id} className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-blue-700">אופציה {i+1}</span>
                      {optStart && optEnd && <span className="text-xs text-slate-500">{formatDate(optStart)} — {formatDate(optEnd)}</span>}
                      {options.length > 1 && (
                        <button onClick={function() { setOptions(function(prev) { return prev.filter(function(x) { return x.id !== o.id; }); }); }}
                          className="text-red-400 text-xs hover:text-red-600">הסר</button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">משך האופציה</label>
                        <div className="flex gap-2">
                          <input type="number" value={o.durationValue}
                            onChange={function(e) { updateOption(o.id, "durationValue", e.target.value); }}
                            placeholder="24" className={ic} />
                          <select value={o.durationUnit}
                            onChange={function(e) { updateOption(o.id, "durationUnit", e.target.value); }}
                            className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-800 bg-white">
                            <option value="months">חודשים</option>
                            <option value="years">שנים</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">הודעה מוקדמת (חודשים)</label>
                        <input type="number" value={o.noticeMonths}
                          onChange={function(e) { updateOption(o.id, "noticeMonths", e.target.value); }}
                          placeholder="3" className={ic} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">סוג הודעה</label>
                        <select value={o.noticeType}
                          onChange={function(e) { updateOption(o.id, "noticeType", e.target.value); }}
                          className={ic}>
                          <option value="non_renewal">הודעה על אי חידוש</option>
                          <option value="exercise">הודעה על מימוש</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">מנגנון מחיר</label>
                        <select value={o.priceType}
                          onChange={function(e) { updateOption(o.id, "priceType", e.target.value); }}
                          className={ic}>
                          <option value="none">ללא שינוי מחיר</option>
                          <option value="percent">עלייה באחוזים</option>
                          <option value="fixed">מחיר קבוע חדש</option>
                        </select>
                      </div>
                    </div>
                    {o.priceType !== "none" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          {o.priceType === "percent" ? "אחוז עלייה" : "מחיר חדש למ\"ר (₪)"}
                        </label>
                        <input type="number" value={o.priceValue}
                          onChange={function(e) { updateOption(o.id, "priceValue", e.target.value); }}
                          placeholder={o.priceType === "percent" ? "5" : "0"} className={ic} />
                      </div>
                    )}
                  </div>
                );
              })}
              <button onClick={addOption}
                className="w-full rounded-lg border border-dashed border-blue-300 py-2 text-sm text-blue-600 hover:bg-blue-50">
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
              {hasOptions && options.map(function(o, i) {
                return optionEndDates[i] ? (
                  <div key={o.id} className="flex items-center gap-3 mr-1.5 border-r-2 border-dashed border-slate-200 pr-4">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0 -mr-5"></div>
                    <div className="flex-1 text-sm mr-2">
                      <span className="font-medium text-slate-600">אופציה {i+1}</span>
                      <span className="text-slate-400 mr-2">{formatDate(optionStartDates[i])} — {formatDate(optionEndDates[i])}</span>
                      {o.durationValue && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{o.durationValue} {o.durationUnit === "years" ? "שנים" : "חודשים"}</span>}
                    </div>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* תנאי תשלום */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">תנאי תשלום</h2>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תעריף למ&quot;ר (₪) *</label>
              <input type="number" value={rentPerSqm} onChange={function(e) { setRentPerSqm(e.target.value); }} placeholder="0" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעות (₪)</label>
              <input type="number" value={investmentAddition} onChange={function(e) { setInvestmentAddition(e.target.value); }} placeholder="0" className={ic} />
            </div>
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות תשלום</label>
            <select value={paymentFrequency} onChange={function(e) { setPaymentFrequency(e.target.value); }} className={ic}>
              <option value="monthly">חודשי</option>
              <option value="quarterly">רבעוני</option>
              <option value="other">אחר</option>
            </select>
          </div>
          {monthlyRent != null && monthlyRent > 0 && (
            <div className="rounded-lg bg-green-50 border border-green-100 px-4 py-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">שכ&quot;ד חודשי לפני מע&quot;מ</span>
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
                  <span className="text-sm text-green-600">תשלום רבעוני</span>
                  <span className="text-lg font-bold text-green-800">₪{Math.round(monthlyRent * (vatType === "taxable" ? (1 + Number(vatPct)/100) : 1) * 3).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          {/* עליית מחיר */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-medium text-slate-600">מנגנון עליית מחיר</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={!hasPriceIncrease} onChange={function() { setHasPriceIncrease(false); }} /> לא
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={hasPriceIncrease} onChange={function() { setHasPriceIncrease(true); }} /> כן
                </label>
              </div>
            </div>
            {hasPriceIncrease && (
              <div className="rounded-xl bg-slate-50 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">סוג עלייה</label>
                    <select value={increaseType} onChange={function(e) { setIncreaseType(e.target.value); }} className={ic}>
                      <option value="percent">אחוז מהמחיר הקודם</option>
                      <option value="fixed">סכום קבוע (₪)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">{increaseType === "percent" ? "אחוז עלייה" : "סכום עלייה למ\"ר (₪)"}</label>
                    <input type="number" value={increaseValue} onChange={function(e) { setIncreaseValue(e.target.value); }} className={ic} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות</label>
                    <select value={increaseFreqMonths} onChange={function(e) { setIncreaseFreqMonths(e.target.value); }} className={ic}>
                      <option value="12">כל שנה (12 חודשים)</option>
                      <option value="24">כל שנתיים (24 חודשים)</option>
                      <option value="36">כל 3 שנים (36 חודשים)</option>
                      <option value="48">כל 4 שנים (48 חודשים)</option>
                      <option value="60">כל 5 שנים (60 חודשים)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">עד שנה (ריק=עד סוף)</label>
                    <input type="number" value={increaseUntilYear} onChange={function(e) { setIncreaseUntilYear(e.target.value); }} className={ic} />
                  </div>
                </div>
                {rentPerSqm && totalArea > 0 && increaseValue && startDate && endDate && (
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-2">סימולציית מחיר</div>
                    <div className="space-y-1">
                      {(function() {
                        const rows: any[] = [];
                        let current = Number(rentPerSqm);
                        const freq = Number(increaseFreqMonths);
                        const totalMonths2 = monthsBetween(startDate, endDate);
                        const untilYear = increaseUntilYear ? Number(increaseUntilYear) : null;
                        for (let m = 0; m <= totalMonths2; m += freq) {
                          const d = addMonths(startDate, m);
                          const yr = new Date(d).getFullYear();
                          const frozen = untilYear !== null && yr > untilYear;
                          rows.push({ date: d, rent: current, frozen });
                          if (!frozen) {
                            if (increaseType === "percent") current = current * (1 + Number(increaseValue)/100);
                            else current = current + Number(increaseValue);
                          }
                        }
                        return rows.slice(0,6).map(function(r, idx) {
                          return (
                            <div key={idx} className={"flex justify-between text-xs rounded px-3 py-1.5 " + (r.frozen ? "bg-orange-50" : "bg-white")}>
                              <span className="text-slate-500">{formatDate(r.date)}</span>
                              <span className={"font-medium " + (r.frozen ? "text-orange-600" : "text-slate-700")}>
                                ₪{r.rent.toFixed(2)} למ&quot;ר ({totalArea > 0 ? "₪" + Math.round(r.rent * totalArea).toLocaleString() : ""}/ חודש)
                                {r.frozen && " ❄️"}
                              </span>
                            </div>
                          );
                        });
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
              <select value={indexBaseDate ? indexBaseDate.split("-")[1] : ""}
                onChange={function(e) {
                  const y = indexBaseDate ? indexBaseDate.split("-")[0] : new Date().getFullYear().toString();
                  setIndexBaseDate(y + "-" + e.target.value.padStart(2,"0"));
                }} className={ic}>
                <option value="">חודש</option>
                {["01","02","03","04","05","06","07","08","09","10","11","12"].map(function(m,i) {
                  return <option key={m} value={m}>{["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"][i]}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שנת בסיס</label>
              <input type="number" value={indexBaseDate ? indexBaseDate.split("-")[0] : ""}
                onChange={function(e) {
                  const m = indexBaseDate ? indexBaseDate.split("-")[1] : "01";
                  setIndexBaseDate(e.target.value + "-" + m);
                }} placeholder="2021" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">ערך מדד בסיס</label>
              <div className="flex gap-1">
                <input type="number" step="0.01" value={indexBaseValue}
                  onChange={function(e) { setIndexBaseValue(e.target.value); }} placeholder="102.3" className={ic} />
                {indexBaseDate && (
                  <button onClick={fetchCpiForBaseDate} disabled={fetchingCpi}
                    className="rounded-lg border border-blue-300 bg-blue-50 px-2 text-blue-600 hover:bg-blue-100 disabled:opacity-50 text-xs">
                    {fetchingCpi ? "⏳" : "🔄"}
                  </button>
                )}
              </div>
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
                <input type="radio" checked={vatType === "taxable"} onChange={function() { setVatType("taxable"); }} className="w-3.5 h-3.5" />
                <span>חייב מע&quot;מ ({vatPct}%)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={vatType === "exempt"} onChange={function() { setVatType("exempt"); }} className="w-3.5 h-3.5" />
                <span>פטור ממע&quot;מ</span>
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול למ&quot;ר (₪)</label>
              <input type="number" step="0.01" value={mgmtFeePerSqm} onChange={function(e) { setMgmtFeePerSqm(e.target.value); }} placeholder="0.00" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז מע&quot;מ</label>
              <select value={vatPct} onChange={function(e) { setVatPct(e.target.value); }} className={ic}>
                <option value="0">0%</option>
                <option value="17">17%</option>
                <option value="18">18%</option>
              </select>
            </div>
          </div>
        </div>

        {/* ערבות */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-700">ערבות</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">סוג ערבות</label>
              <select value={guaranteeType} onChange={function(e) { setGuaranteeType(e.target.value); }} className={ic}>
                <option value="">-- בחר --</option>
                <option value="bank">ערבות בנקאית</option>
                <option value="check">שיק ביטחון</option>
                <option value="cash">פיקדון מזומן</option>
                <option value="other">אחר</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שיטת חישוב</label>
              <select value={guaranteeCalcMethod} onChange={function(e) { setGuaranteeCalcMethod(e.target.value); }} className={ic}>
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
                  <input type="number" value={guaranteeMonths} onChange={function(e) { setGuaranteeMonths(e.target.value); }} placeholder="3" className={ic} />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                    <input type="checkbox" checked={guaranteeIncludesMgmt} onChange={function(e) { setGuaranteeIncludesMgmt(e.target.checked); }} className="w-4 h-4" />
                    כולל דמי ניהול
                  </label>
                </div>
              </div>
              {calcGuaranteeAmount != null && calcGuaranteeAmount > 0 && (
                <div className="rounded-lg bg-green-50 border border-green-100 px-4 py-3 flex justify-between items-center">
                  <span className="text-sm text-slate-600">סכום ערבות מחושב ({guaranteeMonths} חודשים)</span>
                  <span className="text-xl font-bold text-green-700">₪{calcGuaranteeAmount.toLocaleString()}</span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">סכום קבוע (₪)</label>
              <input type="number" value={guaranteeAmount} onChange={function(e) { setGuaranteeAmount(e.target.value); }} placeholder="0" className={ic} />
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תוקף ערבות קיימת</label>
              <input type="date" value={guaranteeInitialExpiry} onChange={function(e) { setGuaranteeInitialExpiry(e.target.value); }} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תוקף מחויב לפי הסכם</label>
              <input type="date" value={guaranteeExpiry} onChange={function(e) { setGuaranteeExpiry(e.target.value); }} className={ic} />
            </div>
          </div>
          {endDate && !guaranteeExpiry && (
            <button onClick={function() {
              const d = new Date(endDate); d.setMonth(d.getMonth()+3);
              setGuaranteeExpiry(d.toISOString().split("T")[0]);
            }} className="mt-2 text-xs text-blue-600 hover:underline">
              ← חשב אוטומטי (3 חודשים אחרי סיום)
            </button>
          )}
        </div>

        {/* קישור מסמך */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-slate-500">קישור מסמך חוזה</h2>
          <input type="url" value={documentUrl} onChange={function(e) { setDocumentUrl(e.target.value); }}
            placeholder="https://www.dropbox.com/..." className={ic} />
          {documentUrl && (
            <a href={documentUrl} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-block text-xs text-blue-600 hover:underline">פתח קישור ↗</a>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={function() { router.back(); }}
            className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">
            ביטול
          </button>
          <button onClick={handleSave}
            className="flex-1 rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800">
            שמור חוזה
          </button>
        </div>
      </div>
    </div>
  );
}
