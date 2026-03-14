"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmt(d: string) { if (!d) return ""; return d.split("T")[0]; }
function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}
function formatDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function EditContractInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const isExtension = searchParams?.get("mode") === "extend";

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [contract, setContract] = useState<any>(null);
  const [tab, setTab]           = useState<"details" | "options">("details");

  // פרטי חוזה
  const [startDate, setStartDate]   = useState("");
  const [endDate, setEndDate]       = useState("");
  const [rentPerSqm, setRentPerSqm] = useState("");
  const [chargedArea, setChargedArea] = useState("");
  const [investmentAddition, setInvestmentAddition] = useState("0");
  const [paymentFrequency, setPaymentFrequency] = useState("monthly");
  const [indexBaseMonth, setIndexBaseMonth] = useState("");
  const [indexBaseYear, setIndexBaseYear]   = useState("");
  const [indexBaseValue, setIndexBaseValue] = useState("");
  const [mgmtFeePerSqm, setMgmtFeePerSqm] = useState("");
  const [vatType, setVatType] = useState("taxable");
  const [vatPct, setVatPct]   = useState("18");
  const [guaranteeType, setGuaranteeType]     = useState("");
  const [guaranteeAmount, setGuaranteeAmount] = useState("");
  const [guaranteeExpiry, setGuaranteeExpiry] = useState("");
  const [hasPriceIncrease, setHasPriceIncrease] = useState(false);
  const [priceIncreaseType, setPriceIncreaseType] = useState("percent");
  const [priceIncreaseValue, setPriceIncreaseValue] = useState("");
  const [priceIncreaseFreqMonths, setPriceIncreaseFreqMonths] = useState("12");
  const [priceIncreaseUntilYear, setPriceIncreaseUntilYear] = useState("");
  const [status, setStatus] = useState("active");
  const [notes, setNotes]         = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [extendDurationValue, setExtendDurationValue] = useState("12");
  const [extendDurationUnit, setExtendDurationUnit] = useState<"months"|"years">("months");

  // אופציות
  const [contractOptions, setContractOptions] = useState<any[]>([]);
  const [savingOpt, setSavingOpt] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [newOpt, setNewOpt] = useState({
    duration_months: "12",
    notice_type: "non_renewal",
    notice_days_before_end: "90",
    rent_mechanism: "no_change",
    rent_increase_pct: "",
    new_rent_value: "",
    notes: "",
  });

  async function loadOptions() {
    const { data } = await supabase
      .from("contract_options")
      .select("*")
      .eq("contract_id", id)
      .order("option_number");
    setContractOptions(data ?? []);
  }

  useEffect(() => {
    if (!id) return;
    supabase.from("contracts")
      .select("*, tenants(name), properties(name)")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (!data) { router.push("/contracts"); return; }
        setContract(data);
        if (isExtension) {
          const origEnd = fmt(data.end_date);
          const newStart = origEnd ? (() => {
            const d = new Date(origEnd); d.setDate(d.getDate() + 1);
            return d.toISOString().split("T")[0];
          })() : "";
          setStartDate(newStart);
          setEndDate(newStart ? addMonths(newStart, 12) : "");
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
        setLoading(false);
      });
    loadOptions();
  }, [id, isExtension]);

  function updateExtendEnd(val: string, unit: "months"|"years") {
    if (!startDate) return;
    const months = unit === "years" ? Number(val) * 12 : Number(val);
    setEndDate(addMonths(startDate, months));
  }

  async function handleSave() {
    if (!startDate || !endDate) { alert("חובה: תאריך התחלה וסיום"); return; }
    setSaving(true);
    try {
      const payload: any = {
        start_date: startDate, end_date: endDate,
        rent_per_sqm: rentPerSqm ? Number(rentPerSqm) : null,
        charged_area: chargedArea ? Number(chargedArea) : null,
        investment_addition: Number(investmentAddition),
        payment_frequency: paymentFrequency,
        index_base_month: indexBaseMonth ? Number(indexBaseMonth) : null,
        index_base_year: indexBaseYear ? Number(indexBaseYear) : null,
        index_base_value: indexBaseValue ? Number(indexBaseValue) : null,
        index_base_date: indexBaseYear && indexBaseMonth ? `${indexBaseYear}-${indexBaseMonth.padStart(2,"0")}-01` : null,
        mgmt_fee_per_sqm: mgmtFeePerSqm ? Number(mgmtFeePerSqm) : null,
        vat_type: vatType, vat_pct: Number(vatPct),
        guarantee_type: guaranteeType || null,
        guarantee_amount: guaranteeAmount ? Number(guaranteeAmount) : null,
        guarantee_expiry: guaranteeExpiry || null,
        price_increase_type: hasPriceIncrease ? priceIncreaseType : null,
        price_increase_value: hasPriceIncrease && priceIncreaseValue ? Number(priceIncreaseValue) : null,
        price_increase_freq_months: hasPriceIncrease ? Number(priceIncreaseFreqMonths) : null,
        price_increase_until_year: hasPriceIncrease && priceIncreaseUntilYear ? Number(priceIncreaseUntilYear) : null,
        notes: notes || null, document_url: documentUrl || null,
      };
      if (isExtension) {
        const { error } = await supabase.from("contracts").insert({
          ...payload, property_id: contract.property_id, tenant_id: contract.tenant_id,
          unit_ids: contract.unit_ids, status: "active", parent_contract_id: id,
        });
        if (error) throw error;
        await supabase.from("contracts").update({ status: "ended", option_exercised: true }).eq("id", id);
        alert("✅ החוזה הוארך! נוצר חוזה חדש.");
      } else {
        payload.status = status;
        const { error } = await supabase.from("contracts").update(payload).eq("id", id);
        if (error) throw error;
        alert("✅ החוזה עודכן!");
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
      // חשב start/end date
      const prevEnd = contractOptions.length > 0
        ? contractOptions[contractOptions.length - 1].end_date
        : endDate;
      const optStart = prevEnd ? (() => {
        const d = new Date(prevEnd); d.setDate(d.getDate() + 1);
        return d.toISOString().split("T")[0];
      })() : null;
      const optEnd = optStart ? addMonths(optStart, Number(newOpt.duration_months)) : null;

      const { error } = await supabase.from("contract_options").insert({
        contract_id: id,
        option_number: nextNum,
        duration_months: Number(newOpt.duration_months),
        start_date: optStart,
        end_date: optEnd,
        notice_type: newOpt.notice_type,
        notice_days_before_end: Number(newOpt.notice_days_before_end),
        rent_mechanism: newOpt.rent_mechanism,
        rent_increase_pct: newOpt.rent_increase_pct ? Number(newOpt.rent_increase_pct) : null,
        new_rent_value: newOpt.new_rent_value ? Number(newOpt.new_rent_value) : null,
        notes: newOpt.notes || null,
        status: "pending",
      });
      if (error) throw error;
      setNewOpt({ duration_months: "12", notice_type: "non_renewal", notice_days_before_end: "90", rent_mechanism: "no_change", rent_increase_pct: "", new_rent_value: "", notes: "" });
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

  async function handleMigrateOptions() {
    if (!contract?.option_months || !endDate) return;
    const count = Number(prompt("כמה אופציות יש בחוזה? (1 או 2)", "2"));
    if (!count || count < 1 || count > 5) { alert("מספר לא תקין"); return; }
    if (!confirm(`ליצור ${count} אופציות של ${contract.option_months} חודשים כל אחת?`)) return;
    setMigrating(true);
    try {
      let prevEnd = endDate;
      for (let i = 1; i <= count; i++) {
        const optStart = (() => {
          const d = new Date(prevEnd); d.setDate(d.getDate() + 1);
          return d.toISOString().split("T")[0];
        })();
        const optEnd = addMonths(optStart, contract.option_months);
        const { error } = await supabase.from("contract_options").insert({
          contract_id: id,
          option_number: i,
          duration_months: contract.option_months,
          start_date: optStart,
          end_date: optEnd,
          notice_type: "non_renewal",
          notice_days_before_end: 90,
          rent_mechanism: "no_change",
          status: "pending",
        });
        if (error) throw error;
        prevEnd = optEnd;
      }
      await loadOptions();
      alert(`✅ ${count} אופציות נוצרו בהצלחה!`);
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
    } finally { setMigrating(false); }
  }

  if (loading) return <div dir="rtl" className="p-8 text-center text-slate-400">טוען...</div>;
  const area = Number(chargedArea) || contract?.charged_area || 0;
  const monthlyRent = rentPerSqm && area ? Number(rentPerSqm) * area + Number(investmentAddition) : null;

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-700 text-2xl">&larr;</button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{isExtension ? "🔄 הארכת חוזה" : "✏️ עריכת חוזה"}</h1>
          <p className="text-sm text-slate-500">{contract?.tenants?.name} — {contract?.properties?.name}</p>
        </div>
      </div>

      {isExtension && (
        <div className="mb-5 rounded-xl bg-purple-50 border border-purple-200 p-4 text-sm text-purple-800">
          <div className="font-bold mb-1">🔄 הארכת חוזה קיים</div>
          <div>יישמר חוזה חדש החל מ-{startDate ? startDate.split("-").reverse().join("/") : "—"}. החוזה הקודם יסומן כ"הסתיים".</div>
        </div>
      )}

      {/* טאבים */}
      {!isExtension && (
        <div className="flex gap-2 mb-5 border-b border-slate-200">
          <button onClick={() => setTab("details")}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${tab === "details" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            פרטי חוזה
          </button>
          <button onClick={() => setTab("options")}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${tab === "options" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            אופציות
            {contractOptions.length > 0 && (
              <span className="bg-purple-100 text-purple-700 text-xs px-1.5 py-0.5 rounded-full">{contractOptions.length}</span>
            )}
          </button>
        </div>
      )}

      {/* טאב פרטים */}
      {(tab === "details" || isExtension) && (
        <div className="space-y-5">
          {/* תקופה */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-slate-500">{isExtension ? "📅 תקופת ההארכה" : "📅 תקופת חוזה"}</h2>
            {isExtension && (
              <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm">
                <div className="flex justify-between mb-2">
                  <span className="text-slate-500">חוזה מקורי הסתיים:</span>
                  <span className="font-medium">{fmt(contract.end_date).split("-").reverse().join("/")}</span>
                </div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">משך ההארכה</label>
                <div className="flex gap-2">
                  <input type="number" value={extendDurationValue} className={ic} placeholder="12"
                    onChange={e => { setExtendDurationValue(e.target.value); updateExtendEnd(e.target.value, extendDurationUnit); }} />
                  <select value={extendDurationUnit} className="rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white"
                    onChange={e => { setExtendDurationUnit(e.target.value as any); updateExtendEnd(extendDurationValue, e.target.value as any); }}>
                    <option value="months">חודשים</option>
                    <option value="years">שנים</option>
                  </select>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך התחלה</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך סיום</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={ic} />
              </div>
            </div>
          </div>

          {/* תשלום */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-slate-500">💰 תנאי תשלום</h2>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תעריף למ"ר (₪)</label>
                <input type="number" value={rentPerSqm} onChange={e => setRentPerSqm(e.target.value)} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שטח מחויב (מ"ר)</label>
                <input type="number" value={chargedArea} onChange={e => setChargedArea(e.target.value)} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעות (₪)</label>
                <input type="number" value={investmentAddition} onChange={e => setInvestmentAddition(e.target.value)} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות תשלום</label>
                <select value={paymentFrequency} onChange={e => setPaymentFrequency(e.target.value)} className={ic}>
                  <option value="monthly">חודשי</option>
                  <option value="quarterly">רבעוני</option>
                  <option value="annual">שנתי</option>
                  <option value="checks_advance">שיקים מראש</option>
                </select>
              </div>
            </div>
            {monthlyRent && (
              <div className="rounded-lg bg-green-50 px-4 py-2.5 text-sm flex justify-between">
                <span className="text-slate-600">שכ"ד חודשי</span>
                <span className="font-bold text-green-700">₪{monthlyRent.toLocaleString()}</span>
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-medium text-slate-600">מנגנון עליית מחיר</label>
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
                      <select value={priceIncreaseType} onChange={e => setPriceIncreaseType(e.target.value)} className={ic}>
                        <option value="percent">אחוז מהמחיר הקודם</option>
                        <option value="fixed">סכום קבוע (₪)</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">{priceIncreaseType === "percent" ? "אחוז" : "סכום (₪)"}</label>
                      <input type="number" value={priceIncreaseValue} onChange={e => setPriceIncreaseValue(e.target.value)} className={ic} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות</label>
                      <select value={priceIncreaseFreqMonths} onChange={e => setPriceIncreaseFreqMonths(e.target.value)} className={ic}>
                        <option value="12">כל שנה</option>
                        <option value="24">כל שנתיים</option>
                        <option value="36">כל 3 שנים</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">עד שנה (כולל)</label>
                      <input type="number" value={priceIncreaseUntilYear} onChange={e => setPriceIncreaseUntilYear(e.target.value)} placeholder="ריק = עד סוף" className={ic} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* מדד */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-slate-700">📈 מדד הצמדה</h2>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חודש בסיס</label>
                <select value={indexBaseMonth} onChange={e => setIndexBaseMonth(e.target.value)} className={ic}>
                  <option value="">--</option>
                  {MONTHS_HE.map((m,i) => <option key={i+1} value={String(i+1).padStart(2,"0")}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שנת בסיס</label>
                <input type="number" value={indexBaseYear} onChange={e => setIndexBaseYear(e.target.value)} placeholder="2024" className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">ערך מדד</label>
                <input type="number" step="0.01" value={indexBaseValue} onChange={e => setIndexBaseValue(e.target.value)} placeholder="108.5" className={ic} />
              </div>
            </div>
          </div>

          {/* דמי ניהול */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-700">🏢 דמי ניהול</h2>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={vatType==="taxable"} onChange={() => setVatType("taxable")} /> חייב מע"מ</label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={vatType==="exempt"} onChange={() => setVatType("exempt")} /> פטור</label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול למ"ר (₪)</label>
                <input type="number" step="0.01" value={mgmtFeePerSqm} onChange={e => setMgmtFeePerSqm(e.target.value)} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ %</label>
                <select value={vatPct} onChange={e => setVatPct(e.target.value)} className={ic}>
                  <option value="0">0%</option><option value="17">17%</option><option value="18">18%</option>
                </select>
              </div>
            </div>
          </div>

          {/* ערבות */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-slate-700">🛡️ ערבות</h2>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג ערבות</label>
                <select value={guaranteeType} onChange={e => setGuaranteeType(e.target.value)} className={ic}>
                  <option value="">-- בחר --</option>
                  <option value="bank">ערבות בנקאית</option>
                  <option value="check">שיק ביטחון</option>
                  <option value="cash">פיקדון מזומן</option>
                  <option value="personal">ערבות אישית</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סכום (₪)</label>
                <input type="number" value={guaranteeAmount} onChange={e => setGuaranteeAmount(e.target.value)} className={ic} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תוקף ערבות</label>
              <input type="date" value={guaranteeExpiry} onChange={e => setGuaranteeExpiry(e.target.value)} className={ic} />
            </div>
          </div>

          {/* סטטוס */}
          {!isExtension && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-bold text-slate-500">סטטוס</h2>
              <select value={status} onChange={e => setStatus(e.target.value)} className={ic}>
                <option value="active">פעיל</option>
                <option value="ended">הסתיים</option>
                <option value="extended">הוארך</option>
                <option value="cancelled">בוטל</option>
              </select>
            </div>
          )}

          {/* קישור מסמך */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-500">📎 קישור למסמך</h2>
            <input type="url" value={documentUrl} onChange={e => setDocumentUrl(e.target.value)}
              placeholder="https://www.dropbox.com/... או https://drive.google.com/..." className={ic} />
            {documentUrl && <a href={documentUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-blue-600 hover:underline">פתח קישור ↗</a>}
          </div>

          {/* הערות */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-500">📝 הערות</h2>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={ic + " resize-none"} />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => router.back()} className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">ביטול</button>
            <button onClick={handleSave} disabled={saving} className={`flex-1 rounded-lg py-2.5 font-bold text-white disabled:opacity-50 ${isExtension ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-700 hover:bg-blue-800"}`}>
              {saving ? "שומר..." : isExtension ? "🔄 צור חוזה הארכה" : "שמור שינויים"}
            </button>
          </div>
        </div>
      )}

      {/* טאב אופציות */}
      {tab === "options" && !isExtension && (
        <div className="space-y-4">
          {/* המרת option_months ישן לאופציות חדשות */}
          {contractOptions.length === 0 && contract?.option_months && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="text-2xl">⚠️</div>
                <div className="flex-1">
                  <div className="font-bold text-amber-800 mb-1">אופציה ישנה זוהתה</div>
                  <div className="text-sm text-amber-700 mb-3">
                    החוזה מוגדר עם <strong>{contract.option_months} חודשי אופציה</strong> בשדה ישן.
                    המר לאופציות מפורטות כדי שהמערכת תחשב את תאריך הסיום הנכון ותשלח התראות.
                  </div>
                  <button onClick={handleMigrateOptions} disabled={migrating}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                    {migrating ? "ממיר..." : "🔄 המר לאופציות מפורטות"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* אופציות קיימות */}
          {contractOptions.length > 0 && (
            <div className="space-y-3">
              {contractOptions.map((opt: any) => (
                <div key={opt.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-bold text-slate-800">אופציה {opt.option_number}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          opt.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                          opt.status === "exercised" ? "bg-green-100 text-green-700" :
                          opt.status === "not_exercised" ? "bg-red-100 text-red-700" :
                          "bg-purple-100 text-purple-700"
                        }`}>
                          {opt.status === "pending" ? "ממתין" : opt.status === "exercised" ? "מומש ✓" : opt.status === "not_exercised" ? "לא מומש" : "הוארך אוטו׳"}
                        </span>
                      </div>
                      <div className="text-sm text-slate-600 space-y-0.5">
                        <div>{opt.duration_months} חודשים | {formatDate(opt.start_date)} — {formatDate(opt.end_date)}</div>
                        {opt.notice_deadline && <div>מועד הודעה: <span className="font-medium">{formatDate(opt.notice_deadline)}</span> ({opt.notice_days_before_end} ימים לפני סיום)</div>}
                        {opt.rent_mechanism !== "no_change" && <div>מחיר: {opt.rent_mechanism === "pct_increase" ? `+${opt.rent_increase_pct}%` : `₪${opt.new_rent_value}`}</div>}
                        {opt.notes && <div className="text-slate-400">{opt.notes}</div>}
                      </div>
                    </div>
                    {opt.status === "pending" && (
                      <button onClick={() => handleDeleteOption(opt.id)}
                        className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded px-2 py-1">מחק</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* הוספת אופציה חדשה */}
          <div className="bg-white rounded-xl border border-blue-200 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700 mb-4">+ הוסף אופציה</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">משך האופציה (חודשים)</label>
                <input type="number" value={newOpt.duration_months}
                  onChange={e => setNewOpt(p => ({...p, duration_months: e.target.value}))} className={ic} placeholder="24" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">ימי הודעה מוקדמת</label>
                <input type="number" value={newOpt.notice_days_before_end}
                  onChange={e => setNewOpt(p => ({...p, notice_days_before_end: e.target.value}))} className={ic} placeholder="90" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג הודעה</label>
                <select value={newOpt.notice_type} onChange={e => setNewOpt(p => ({...p, notice_type: e.target.value}))} className={ic}>
                  <option value="non_renewal">הודעת אי-חידוש (opt-out)</option>
                  <option value="exercise">הודעת מימוש (opt-in)</option>
                  <option value="auto_extend">הארכה אוטומטית</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מנגנון מחיר</label>
                <select value={newOpt.rent_mechanism} onChange={e => setNewOpt(p => ({...p, rent_mechanism: e.target.value}))} className={ic}>
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
                  onChange={e => setNewOpt(p => ({...p, rent_increase_pct: e.target.value}))} className={ic} placeholder="5" />
              </div>
            )}
            {newOpt.rent_mechanism === "fixed" && (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-semibold text-slate-700">מחיר חדש למ"ר (₪)</label>
                <input type="number" value={newOpt.new_rent_value}
                  onChange={e => setNewOpt(p => ({...p, new_rent_value: e.target.value}))} className={ic} />
              </div>
            )}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
              <input type="text" value={newOpt.notes}
                onChange={e => setNewOpt(p => ({...p, notes: e.target.value}))} className={ic} placeholder="הערות לאופציה..." />
            </div>
            <button onClick={handleAddOption} disabled={savingOpt}
              className="w-full rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              {savingOpt ? "שומר..." : "הוסף אופציה"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EditContractPage() {
  return (
    <Suspense fallback={<div dir="rtl" className="p-8 text-center text-slate-400">טוען...</div>}>
      <EditContractInner />
    </Suspense>
  );
}
