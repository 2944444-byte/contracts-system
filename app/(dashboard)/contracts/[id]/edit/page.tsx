"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";
import { ContractSpacesSelector, SpaceCharge } from "../../../../../components/ContractSpacesSelector";
import { TIManager } from "../../../../../components/TIManager";
import { logAudit } from "../../../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmt(d: string) { if (!d) return ""; return d.split("T")[0]; }
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
function formatDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

interface OptionRow {
  id: string;
  option_number: number;
  duration_months: number;
  start_date: string;
  end_date: string;
  notice_type: string;
  notice_days_before_end: number;
  notice_deadline: string;
  rent_mechanism: string;
  rent_increase_pct: string;
  new_rent_value: string;
  status: string;
  notes: string;
}

function EditInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const isExtension = searchParams?.get("mode") === "extend";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contract, setContract] = useState<any>(null);
  const [tab, setTab] = useState("details");

  // פרטי חוזה
  const [startDate, setStartDate]             = useState("");
  const [endDate, setEndDate]                 = useState("");
  const [rentPerSqm, setRentPerSqm]           = useState("");
  const [chargedArea, setChargedArea]         = useState("");
  const [investmentAddition, setInvestmentAddition] = useState("0");
  const [paymentFrequency, setPaymentFrequency] = useState("monthly");
  const [indexBaseMonth, setIndexBaseMonth]   = useState("");
  const [indexBaseYear, setIndexBaseYear]     = useState("");
  const [indexBaseValue, setIndexBaseValue]   = useState("");
  const [mgmtFeePerSqm, setMgmtFeePerSqm]   = useState("");
  const [vatType, setVatType]                 = useState("taxable");
  const [vatPct, setVatPct]                   = useState("18");
  const [guaranteeType, setGuaranteeType]     = useState("");
  const [guaranteeAmount, setGuaranteeAmount] = useState("");
  const [guaranteeExpiry, setGuaranteeExpiry] = useState("");
  const [hasPriceIncrease, setHasPriceIncrease] = useState(false);
  const [priceIncreaseType, setPriceIncreaseType] = useState("percent");
  const [priceIncreaseValue, setPriceIncreaseValue] = useState("");
  const [priceIncreaseFreqMonths, setPriceIncreaseFreqMonths] = useState("12");
  const [priceIncreaseUntilYear, setPriceIncreaseUntilYear] = useState("");
  const [status, setStatus]                   = useState("active");
  const [notes, setNotes]                     = useState("");
  const [documentUrl, setDocumentUrl]         = useState("");
  const [extendDurationValue, setExtendDurationValue] = useState("12");
  const [extendDurationUnit, setExtendDurationUnit] = useState("months");

  // אופציות
  const [contractOptions, setContractOptions] = useState<OptionRow[]>([]);
  const [contractSpaces, setContractSpaces]   = useState<SpaceCharge[]>([]);
  const [availableSpaces, setAvailableSpaces] = useState<any[]>([]);
  const [savingOpt, setSavingOpt] = useState(false);
  const [newOpt, setNewOpt] = useState({
    duration_months: "24",
    notice_type: "non_renewal",
    notice_days_before_end: "90",
    rent_mechanism: "no_change",
    rent_increase_pct: "",
    new_rent_value: "",
    notes: "",
  });

  async function loadContractSpaces() {
    const { data } = await supabase
      .from("contract_spaces")
      .select("*, spaces(space_name, space_type, area, quantity, is_commercial, status)")
      .eq("contract_id", id);
    if (data && data.length > 0) {
      const mapped: SpaceCharge[] = data.map(function(cs: any) {
        return {
          space_id:      cs.space_id,
          space_name:    cs.spaces?.space_name ?? "",
          space_type:    cs.spaces?.space_type ?? "unit",
          area:          cs.spaces?.area ?? null,
          quantity:      cs.spaces?.quantity ?? null,
          is_commercial: cs.spaces?.is_commercial ?? false,
          charge_method: cs.charge_method ?? "per_sqm",
          price_per_sqm: cs.price_per_sqm?.toString() ?? "",
          fixed_amount:  cs.fixed_amount?.toString() ?? "",
          price_per_unit: cs.price_per_unit?.toString() ?? "",
          revenue_pct:   cs.revenue_pct?.toString() ?? "",
          min_rent:      cs.min_rent?.toString() ?? "",
          revenue_type:  cs.revenue_type ?? "revenue_only",
          included_in_main_rent: cs.included_in_main_rent ?? true,
          notes:         cs.notes ?? "",
        };
      });
      setContractSpaces(mapped);
    }
  }

  async function loadOptions() {
    const { data } = await supabase
      .from("contract_options")
      .select("*")
      .eq("contract_id", id)
      .order("option_number");
    setContractOptions((data ?? []) as OptionRow[]);
  }

  useEffect(() => {
    if (!id) return;
    supabase.from("contracts")
      .select("*, tenants(name), properties(name)")
      .eq("id", id)
      .single()
      .then(function({ data }) {
        if (!data) { router.push("/contracts"); return; }
        setContract(data);
        if (isExtension) {
          const origEnd = fmt(data.end_date);
          if (origEnd) {
            const d = new Date(origEnd);
            d.setDate(d.getDate() + 1);
            const newStart = d.toISOString().split("T")[0];
            setStartDate(newStart);
            setEndDate(addMonths(newStart, 12));
          }
        } else {
          setStartDate(fmt(data.start_date));
          setEndDate(fmt(data.end_date));
        }
        setRentPerSqm(data.rent_per_sqm?.toString() ?? "");
        setChargedArea(data.charged_area?.toString() ?? "");
        setInvestmentAddition(data.investment_addition?.toString() ?? "0");
        setPaymentFrequency(data.payment_frequency ?? "monthly");
        setIndexBaseMonth(data.index_base_month?.toString() ?? "");
        setIndexBaseYear(data.index_base_year?.toString() ?? "");
        setIndexBaseValue(data.index_base_value?.toString() ?? "");
        setMgmtFeePerSqm(data.mgmt_fee_per_sqm?.toString() ?? "");
        setVatType(data.vat_type ?? "taxable");
        setVatPct(data.vat_pct?.toString() ?? "18");
        setGuaranteeType(data.guarantee_type ?? "");
        setGuaranteeAmount(data.guarantee_amount?.toString() ?? "");
        setGuaranteeExpiry(fmt(data.guarantee_expiry ?? ""));
        setHasPriceIncrease(!!(data.price_increase_type));
        setPriceIncreaseType(data.price_increase_type ?? "percent");
        setPriceIncreaseValue(data.price_increase_value?.toString() ?? "");
        setPriceIncreaseFreqMonths(data.price_increase_freq_months?.toString() ?? "12");
        setPriceIncreaseUntilYear(data.price_increase_until_year?.toString() ?? "");
        setStatus(isExtension ? "active" : (data.status ?? "active"));
        setNotes(isExtension ? "" : (data.notes ?? ""));
        setDocumentUrl(data.document_url ?? "");
        // טען שטחים זמינים לנכס
        if (data.property_id) {
          supabase.from("spaces").select("*").eq("property_id", data.property_id)
            .then(function({ data: sp }) { setAvailableSpaces(sp ?? []); });
        }
        setLoading(false);
      });
    loadOptions();
    loadContractSpaces();
  }, [id, isExtension]);

  function updateExtendEnd(val: string, unit: string) {
    if (!startDate) return;
    const months = unit === "years" ? Number(val) * 12 : Number(val);
    setEndDate(addMonths(startDate, months));
  }

  async function handleSave() {
    if (!startDate || !endDate) { alert("חובה: תאריך התחלה וסיום"); return; }
    setSaving(true);
    try {
      const payload: any = {
        start_date: startDate,
        end_date: endDate,
        rent_per_sqm: rentPerSqm ? Number(rentPerSqm) : null,
        charged_area: chargedArea ? Number(chargedArea) : null,
        investment_addition: Number(investmentAddition),
        payment_frequency: paymentFrequency,
        index_base_month: indexBaseMonth ? Number(indexBaseMonth) : null,
        index_base_year: indexBaseYear ? Number(indexBaseYear) : null,
        index_base_value: indexBaseValue ? Number(indexBaseValue) : null,
        index_base_date: indexBaseYear && indexBaseMonth
          ? indexBaseYear + "-" + indexBaseMonth.padStart(2,"0") + "-01"
          : null,
        mgmt_fee_per_sqm: mgmtFeePerSqm ? Number(mgmtFeePerSqm) : null,
        vat_type: vatType,
        vat_pct: Number(vatPct),
        guarantee_type: guaranteeType || null,
        guarantee_amount: guaranteeAmount ? Number(guaranteeAmount) : null,
        guarantee_expiry: guaranteeExpiry || null,
        price_increase_type: hasPriceIncrease ? priceIncreaseType : null,
        price_increase_value: hasPriceIncrease && priceIncreaseValue ? Number(priceIncreaseValue) : null,
        price_increase_freq_months: hasPriceIncrease ? Number(priceIncreaseFreqMonths) : null,
        price_increase_until_year: hasPriceIncrease && priceIncreaseUntilYear ? Number(priceIncreaseUntilYear) : null,
        notes: notes || null,
        document_url: documentUrl || null,
      };

      if (isExtension) {
        const { error } = await supabase.from("contracts").insert({
          ...payload,
          property_id: contract.property_id,
          tenant_id: contract.tenant_id,
          unit_ids: contract.unit_ids,
          status: "active",
          parent_contract_id: id,
        });
        if (error) throw error;
        await supabase.from("contracts").update({ status: "ended", option_exercised: true }).eq("id", id);
        alert("החוזה הוארך! נוצר חוזה חדש.");
      } else {
        payload.status = status;
        const { error } = await supabase.from("contracts").update(payload).eq("id", id);
        if (error) throw error;
        alert("החוזה עודכן!");
      }
      router.push("/contracts");
    } catch(e: any) {
      alert("שגיאה: " + (e?.message || JSON.stringify(e)));
    } finally { setSaving(false); }
  }

  async function handleAddOption() {
    if (!newOpt.duration_months) { alert("חובה: משך האופציה"); return; }
    setSavingOpt(true);
    try {
      const nextNum = contractOptions.length + 1;
      const prevEnd = contractOptions.length > 0
        ? contractOptions[contractOptions.length - 1].end_date
        : endDate;
      const optStart = prevEnd ? nextDay(prevEnd) : null;
      const optEnd = optStart ? addMonths(optStart, Number(newOpt.duration_months)) : null;

      const { error } = await supabase.from("contract_options").insert({
        contract_id: id,
        option_number: nextNum,
        duration_months: Number(newOpt.duration_months),
        start_date: optStart,
        end_date: optEnd,
        notice_type: newOpt.notice_type,
        notice_days_before_end: Number(newOpt.notice_days_before_end) * 30, // המרה מחודשים לימים
        rent_mechanism: newOpt.rent_mechanism,
        rent_increase_pct: newOpt.rent_increase_pct ? Number(newOpt.rent_increase_pct) : null,
        new_rent_value: newOpt.new_rent_value ? Number(newOpt.new_rent_value) : null,
        notes: newOpt.notes || null,
        status: "pending",
      });
      if (error) throw error;
      setNewOpt({ duration_months: "24", notice_type: "non_renewal", notice_days_before_end: "90", rent_mechanism: "no_change", rent_increase_pct: "", new_rent_value: "", notes: "" });
      await loadOptions();
    } catch(e: any) {
      alert("שגיאה: " + (e?.message || JSON.stringify(e)));
    } finally { setSavingOpt(false); }
  }

  async function handleDeleteOption(optId: string) {
    if (!confirm("למחוק אופציה זו?")) return;
    await supabase.from("contract_options").delete().eq("id", optId);
    await loadOptions();
  }

  async function handleExerciseOption(optId: string) {
    await supabase.from("contract_options")
      .update({ status: "exercised", exercised_at: new Date().toISOString() })
      .eq("id", optId);
    await supabase.from("contracts")
      .update({ option_exercised: true, status: "extended" })
      .eq("id", id);
    await loadOptions();
  }

  if (loading) return <div dir="rtl" className="p-8 text-center text-slate-400">טוען...</div>;

  const area = Number(chargedArea) || contract?.charged_area || 0;
  const monthlyRent = rentPerSqm && area
    ? Number(rentPerSqm) * area + Number(investmentAddition)
    : null;

  const optStatusLabels: Record<string,string> = {
    pending: "ממתין", exercised: "מומש ✓", not_exercised: "לא מומש", auto_extended: "הוארך אוטו׳"
  };

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={function() { router.back(); }} className="text-slate-400 hover:text-slate-700 text-2xl">&larr;</button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            {isExtension ? "הארכת חוזה" : "עריכת חוזה"}
          </h1>
          <p className="text-sm text-slate-500">{contract?.tenants?.name} — {contract?.properties?.name}</p>
        </div>
      </div>

      {isExtension && (
        <div className="mb-5 rounded-xl bg-purple-50 border border-purple-200 p-4 text-sm text-purple-800">
          <div className="font-bold mb-1">הארכת חוזה קיים</div>
          <div>יישמר חוזה חדש. החוזה הקודם יסומן כ&quot;הסתיים&quot;.</div>
          <div className="text-xs text-purple-600 mt-1">כל הנתונים הועתקו — שנה רק מה שצריך.</div>
        </div>
      )}

      {/* טאבים */}
      {!isExtension && (
        <div className="flex gap-1 mb-5 border-b border-slate-200">
          {[
            { key: "details", label: "פרטי חוזה" },
            { key: "spaces", label: "שטחים (" + contractSpaces.length + ")" },
            { key: "ti",      label: "השקעות TI" },
            { key: "options", label: "אופציות (" + contractOptions.length + ")" },
          ].map(function(t) {
            return (
              <button key={t.key} onClick={function() { setTab(t.key); }}
                className={"px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors " +
                  (tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* טאב פרטים */}
      {(tab === "details" || isExtension) && (
        <div className="space-y-5">

          {/* תקופה */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-slate-500">
              {isExtension ? "תקופת ההארכה" : "תקופת חוזה"}
            </h2>
            {isExtension && (
              <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm">
                <div className="flex justify-between mb-2">
                  <span className="text-slate-500">חוזה מקורי הסתיים:</span>
                  <span className="font-medium">{formatDate(contract.end_date)}</span>
                </div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">משך ההארכה</label>
                <div className="flex gap-2">
                  <input type="number" value={extendDurationValue} className={ic} placeholder="12"
                    onChange={function(e) { setExtendDurationValue(e.target.value); updateExtendEnd(e.target.value, extendDurationUnit); }} />
                  <select value={extendDurationUnit} className="rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white"
                    onChange={function(e) { setExtendDurationUnit(e.target.value); updateExtendEnd(extendDurationValue, e.target.value); }}>
                    <option value="months">חודשים</option>
                    <option value="years">שנים</option>
                  </select>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך התחלה</label>
                <input type="date" value={startDate} onChange={function(e) { setStartDate(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך סיום</label>
                <input type="date" value={endDate} onChange={function(e) { setEndDate(e.target.value); }} className={ic} />
              </div>
            </div>
          </div>

          {/* תשלום */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-slate-500">תנאי תשלום</h2>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תעריף למ&quot;ר (₪)</label>
                <input type="number" value={rentPerSqm} onChange={function(e) { setRentPerSqm(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שטח מחויב (מ&quot;ר)</label>
                <input type="number" value={chargedArea} onChange={function(e) { setChargedArea(e.target.value); }} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעות (₪)</label>
                <input type="number" value={investmentAddition} onChange={function(e) { setInvestmentAddition(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות תשלום</label>
                <select value={paymentFrequency} onChange={function(e) { setPaymentFrequency(e.target.value); }} className={ic}>
                  <option value="monthly">חודשי</option>
                  <option value="quarterly">רבעוני</option>
                  <option value="annual">שנתי</option>
                  <option value="checks_advance">שיקים מראש</option>
                </select>
              </div>
            </div>
            {monthlyRent != null && monthlyRent > 0 && (
              <div className="rounded-lg bg-green-50 px-4 py-2.5 text-sm flex justify-between">
                <span className="text-slate-600">שכ&quot;ד חודשי</span>
                <span className="font-bold text-green-700">₪{monthlyRent.toLocaleString()}</span>
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
                      <select value={priceIncreaseType} onChange={function(e) { setPriceIncreaseType(e.target.value); }} className={ic}>
                        <option value="percent">אחוז מהמחיר הקודם</option>
                        <option value="fixed">סכום קבוע (₪)</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        {priceIncreaseType === "percent" ? "אחוז" : "סכום (₪)"}
                      </label>
                      <input type="number" value={priceIncreaseValue}
                        onChange={function(e) { setPriceIncreaseValue(e.target.value); }} className={ic} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות</label>
                      <select value={priceIncreaseFreqMonths}
                        onChange={function(e) { setPriceIncreaseFreqMonths(e.target.value); }} className={ic}>
                        <option value="12">כל שנה</option>
                        <option value="24">כל שנתיים</option>
                        <option value="36">כל 3 שנים</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">עד שנה</label>
                      <input type="number" value={priceIncreaseUntilYear}
                        onChange={function(e) { setPriceIncreaseUntilYear(e.target.value); }}
                        placeholder="ריק = עד סוף" className={ic} />
                    </div>
                  </div>
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
                <select value={indexBaseMonth} onChange={function(e) { setIndexBaseMonth(e.target.value); }} className={ic}>
                  <option value="">--</option>
                  {MONTHS_HE.map(function(m, i) {
                    const val = String(i+1).padStart(2,"0");
                    return <option key={val} value={val}>{m}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שנת בסיס</label>
                <input type="number" value={indexBaseYear}
                  onChange={function(e) { setIndexBaseYear(e.target.value); }}
                  placeholder="2021" className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">ערך מדד</label>
                <input type="number" step="0.01" value={indexBaseValue}
                  onChange={function(e) { setIndexBaseValue(e.target.value); }}
                  placeholder="102.3" className={ic} />
              </div>
            </div>
          </div>

          {/* דמי ניהול */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-700">דמי ניהול</h2>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={vatType === "taxable"}
                    onChange={function() { setVatType("taxable"); }} /> חייב מע&quot;מ
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={vatType === "exempt"}
                    onChange={function() { setVatType("exempt"); }} /> פטור
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול למ&quot;ר (₪)</label>
                <input type="number" step="0.01" value={mgmtFeePerSqm}
                  onChange={function(e) { setMgmtFeePerSqm(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מע&quot;מ %</label>
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
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג ערבות</label>
                <select value={guaranteeType} onChange={function(e) { setGuaranteeType(e.target.value); }} className={ic}>
                  <option value="">-- בחר --</option>
                  <option value="bank">ערבות בנקאית</option>
                  <option value="check">שיק ביטחון</option>
                  <option value="cash">פיקדון מזומן</option>
                  <option value="personal">ערבות אישית</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סכום (₪)</label>
                <input type="number" value={guaranteeAmount}
                  onChange={function(e) { setGuaranteeAmount(e.target.value); }} className={ic} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תוקף ערבות</label>
              <input type="date" value={guaranteeExpiry}
                onChange={function(e) { setGuaranteeExpiry(e.target.value); }} className={ic} />
            </div>
          </div>

          {/* סטטוס */}
          {!isExtension && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-bold text-slate-500">סטטוס</h2>
              <select value={status} onChange={function(e) { setStatus(e.target.value); }} className={ic}>
                <option value="active">פעיל</option>
                <option value="expiring">פג בקרוב</option>
                <option value="ended">הסתיים</option>
                <option value="extended">הוארך</option>
                <option value="cancelled">בוטל</option>
              </select>
            </div>
          )}

          {/* קישור מסמך */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-500">קישור למסמך</h2>
            <input type="url" value={documentUrl}
              onChange={function(e) { setDocumentUrl(e.target.value); }}
              placeholder="https://www.dropbox.com/..." className={ic} />
            {documentUrl && (
              <a href={documentUrl} target="_blank" rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-blue-600 hover:underline">פתח קישור</a>
            )}
          </div>

          {/* הערות */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-500">הערות</h2>
            <textarea value={notes} onChange={function(e) { setNotes(e.target.value); }}
              rows={3} className={ic + " resize-none"} />
          </div>

          {/* כפתורים */}
          <div className="flex gap-3 pt-2">
            <button onClick={function() { router.back(); }}
              className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">
              ביטול
            </button>
            <button onClick={handleSave} disabled={saving}
              className={"flex-1 rounded-lg py-2.5 font-bold text-white disabled:opacity-50 " +
                (isExtension ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-700 hover:bg-blue-800")}>
              {saving ? "שומר..." : isExtension ? "צור חוזה הארכה" : "שמור שינויים"}
            </button>
          </div>
        </div>
      )}

      {/* טאב TI */}
      {tab === "ti" && !isExtension && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <TIManager contractId={id as string} contractEndDate={endDate} />
        </div>
      )}

      {/* טאב TI */}
      {tab === "ti" && !isExtension && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <TIManager contractId={id as string} contractEndDate={endDate} />
        </div>
      )}

      {/* טאב שטחים */}
      {tab === "spaces" && !isExtension && (
        <div className="space-y-4">
          {availableSpaces.length === 0 ? (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              <div className="font-bold mb-1">⚠️ לנכס זה אין שטחים מוגדרים</div>
              <div>הגדר שטחים ב<a href="/units" className="underline">מסך יחידות</a> ולאחר מכן חזור לשייך אותם לחוזה.</div>
            </div>
          ) : (
            <ContractSpacesSelector
              availableSpaces={availableSpaces}
              selectedSpaces={contractSpaces}
              onChange={setContractSpaces}
            />
          )}
        </div>
      )}

      {/* טאב אופציות */}
      {tab === "options" && !isExtension && (
        <div className="space-y-4">

          {/* אופציות קיימות */}
          {contractOptions.map(function(opt) {
            return (
              <div key={opt.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold text-slate-800">אופציה {opt.option_number}</span>
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (opt.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                         opt.status === "exercised" ? "bg-green-100 text-green-700" :
                         opt.status === "not_exercised" ? "bg-red-100 text-red-700" :
                         "bg-purple-100 text-purple-700")}>
                        {optStatusLabels[opt.status] ?? opt.status}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600 space-y-0.5">
                      <div>{opt.duration_months} חודשים | {formatDate(opt.start_date)} — {formatDate(opt.end_date)}</div>
                      {opt.notice_deadline && (
                        <div>מועד הודעה: <span className="font-medium">{formatDate(opt.notice_deadline)}</span> ({Math.round((opt.notice_days_before_end || 0) / 30)} חודשים לפני סיום)</div>
                      )}
                      {opt.notes && <div className="text-slate-400">{opt.notes}</div>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {opt.status === "pending" && (
                      <button onClick={function() { handleExerciseOption(opt.id); }}
                        className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-semibold">
                        מומש
                      </button>
                    )}
                    {opt.status === "pending" && (
                      <button onClick={function() { handleDeleteOption(opt.id); }}
                        className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">
                        מחק
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* הוספת אופציה */}
          <div className="bg-white rounded-xl border border-blue-200 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700 mb-4">+ הוסף אופציה</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">משך האופציה (חודשים)</label>
                <input type="number" value={newOpt.duration_months}
                  onChange={function(e) { setNewOpt(function(p) { return {...p, duration_months: e.target.value}; }); }}
                  className={ic} placeholder="24" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הודעה מוקדמת (חודשים)</label>
                <input type="number" value={newOpt.notice_days_before_end}
                  onChange={function(e) { setNewOpt(function(p) { return {...p, notice_days_before_end: e.target.value}; }); }}
                  className={ic} placeholder="3" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג הודעה</label>
                <select value={newOpt.notice_type}
                  onChange={function(e) { setNewOpt(function(p) { return {...p, notice_type: e.target.value}; }); }}
                  className={ic}>
                  <option value="non_renewal">הודעת אי-חידוש (opt-out)</option>
                  <option value="exercise">הודעת מימוש (opt-in)</option>
                  <option value="auto_extend">הארכה אוטומטית</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מנגנון מחיר</label>
                <select value={newOpt.rent_mechanism}
                  onChange={function(e) { setNewOpt(function(p) { return {...p, rent_mechanism: e.target.value}; }); }}
                  className={ic}>
                  <option value="no_change">ללא שינוי</option>
                  <option value="pct_increase">עלייה באחוזים</option>
                  <option value="fixed">מחיר קבוע חדש</option>
                </select>
              </div>
            </div>
            {newOpt.rent_mechanism === "pct_increase" && (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז עלייה</label>
                <input type="number" value={newOpt.rent_increase_pct}
                  onChange={function(e) { setNewOpt(function(p) { return {...p, rent_increase_pct: e.target.value}; }); }}
                  className={ic} placeholder="5" />
              </div>
            )}
            {newOpt.rent_mechanism === "fixed" && (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-semibold text-slate-700">מחיר חדש למ&quot;ר (₪)</label>
                <input type="number" value={newOpt.new_rent_value}
                  onChange={function(e) { setNewOpt(function(p) { return {...p, new_rent_value: e.target.value}; }); }}
                  className={ic} />
              </div>
            )}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
              <input type="text" value={newOpt.notes}
                onChange={function(e) { setNewOpt(function(p) { return {...p, notes: e.target.value}; }); }}
                className={ic} placeholder="הערות לאופציה..." />
            </div>
            <button onClick={handleAddOption} disabled={savingOpt}
              className="w-full rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              {savingOpt ? "שומר..." : "הוסף אופציה"}
            </button>
          </div>

          {/* ציר זמן */}
          {contractOptions.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="text-xs font-bold text-slate-500 mb-3 uppercase">ציר זמן</div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500 shrink-0"></div>
                  <span className="text-slate-600">חוזה ראשי: {formatDate(contract?.start_date)} — {formatDate(contract?.end_date)}</span>
                </div>
                {contractOptions.map(function(o) {
                  return (
                    <div key={o.id} className="flex items-center gap-2 mr-1.5 border-r-2 border-dashed border-slate-200 pr-3">
                      <div className={"w-2.5 h-2.5 rounded-full shrink-0 -mr-4 " +
                        (o.status === "exercised" ? "bg-green-500" : o.status === "pending" ? "bg-yellow-400" : "bg-red-400")}>
                      </div>
                      <span className="text-slate-500 mr-2">
                        אופציה {o.option_number}: {formatDate(o.start_date)} — {formatDate(o.end_date)}
                        <span className={"mr-2 text-xs font-bold " +
                          (o.status === "exercised" ? "text-green-600" : o.status === "pending" ? "text-yellow-600" : "text-red-500")}>
                          ({optStatusLabels[o.status]})
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EditContractPage() {
  return (
    <Suspense fallback={<div dir="rtl" className="p-8 text-center text-slate-400">טוען...</div>}>
      <EditInner />
    </Suspense>
  );
}
