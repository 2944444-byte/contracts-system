"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function formatDateInput(d: string) {
  if (!d) return "";
  return d.split("T")[0];
}

export default function EditContractPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contract, setContract] = useState<any>(null);

  // שדות עריכה
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rentPerSqm, setRentPerSqm] = useState("");
  const [investmentAddition, setInvestmentAddition] = useState("0");
  const [paymentFrequency, setPaymentFrequency] = useState("monthly");
  const [indexBaseMonth, setIndexBaseMonth] = useState("");
  const [indexBaseYear, setIndexBaseYear] = useState("");
  const [indexBaseValue, setIndexBaseValue] = useState("");
  const [mgmtFeePerSqm, setMgmtFeePerSqm] = useState("");
  const [vatType, setVatType] = useState("taxable");
  const [vatPct, setVatPct] = useState("18");
  const [optionMonths, setOptionMonths] = useState("");
  const [optionExercised, setOptionExercised] = useState(false);
  const [guaranteeType, setGuaranteeType] = useState("");
  const [guaranteeAmount, setGuaranteeAmount] = useState("");
  const [guaranteeExpiry, setGuaranteeExpiry] = useState("");
  const [priceIncreaseType, setPriceIncreaseType] = useState("percent");
  const [priceIncreaseValue, setPriceIncreaseValue] = useState("");
  const [priceIncreaseFreqMonths, setPriceIncreaseFreqMonths] = useState("12");
  const [priceIncreaseUntilYear, setPriceIncreaseUntilYear] = useState("");
  const [hasPriceIncrease, setHasPriceIncrease] = useState(false);
  const [status, setStatus] = useState("active");
  const [notes, setNotes] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");

  useEffect(() => {
    if (!id) return;
    supabase.from("contracts")
      .select("*, tenants(name), properties(name)")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (!data) { router.push("/contracts"); return; }
        setContract(data);
        setStartDate(formatDateInput(data.start_date));
        setEndDate(formatDateInput(data.end_date));
        setRentPerSqm(data.rent_per_sqm?.toString() ?? "");
        setInvestmentAddition(data.investment_addition?.toString() ?? "0");
        setPaymentFrequency(data.payment_frequency ?? "monthly");
        setIndexBaseMonth(data.index_base_month?.toString() ?? "");
        setIndexBaseYear(data.index_base_year?.toString() ?? "");
        setIndexBaseValue(data.index_base_value?.toString() ?? "");
        setMgmtFeePerSqm(data.mgmt_fee_per_sqm?.toString() ?? "");
        setVatType(data.vat_type ?? "taxable");
        setVatPct(data.vat_pct?.toString() ?? "18");
        setOptionMonths(data.option_months?.toString() ?? "");
        setOptionExercised(data.option_exercised ?? false);
        setGuaranteeType(data.guarantee_type ?? "");
        setGuaranteeAmount(data.guarantee_amount?.toString() ?? "");
        setGuaranteeExpiry(formatDateInput(data.guarantee_expiry ?? ""));
        setHasPriceIncrease(!!(data.price_increase_type));
        setPriceIncreaseType(data.price_increase_type ?? "percent");
        setPriceIncreaseValue(data.price_increase_value?.toString() ?? "");
        setPriceIncreaseFreqMonths(data.price_increase_freq_months?.toString() ?? "12");
        setPriceIncreaseUntilYear(data.price_increase_until_year?.toString() ?? "");
        setStatus(data.status ?? "active");
        setNotes(data.notes ?? "");
        setDocumentUrl(data.document_url ?? "");
        setLoading(false);
      });
  }, [id]);

  async function handleSave() {
    setSaving(true);
    try {
      const updates: any = {
        start_date: startDate,
        end_date: endDate,
        rent_per_sqm: rentPerSqm ? Number(rentPerSqm) : null,
        investment_addition: Number(investmentAddition),
        payment_frequency: paymentFrequency,
        index_base_month: indexBaseMonth ? Number(indexBaseMonth) : null,
        index_base_year: indexBaseYear ? Number(indexBaseYear) : null,
        index_base_value: indexBaseValue ? Number(indexBaseValue) : null,
        index_base_date: indexBaseYear && indexBaseMonth ? `${indexBaseYear}-${indexBaseMonth.padStart(2,"0")}-01` : null,
        mgmt_fee_per_sqm: mgmtFeePerSqm ? Number(mgmtFeePerSqm) : null,
        vat_type: vatType,
        vat_pct: Number(vatPct),
        option_months: optionMonths ? Number(optionMonths) : null,
        option_exercised: optionExercised,
        guarantee_type: guaranteeType || null,
        guarantee_amount: guaranteeAmount ? Number(guaranteeAmount) : null,
        guarantee_expiry: guaranteeExpiry || null,
        price_increase_type: hasPriceIncrease ? priceIncreaseType : null,
        price_increase_value: hasPriceIncrease && priceIncreaseValue ? Number(priceIncreaseValue) : null,
        price_increase_freq_months: hasPriceIncrease ? Number(priceIncreaseFreqMonths) : null,
        price_increase_until_year: hasPriceIncrease && priceIncreaseUntilYear ? Number(priceIncreaseUntilYear) : null,
        status: status,
        notes: notes || null,
        document_url: documentUrl || null,
      };

      const { error } = await supabase.from("contracts").update(updates).eq("id", id);
      if (error) throw error;
      alert("✅ החוזה עודכן בהצלחה!");
      router.push("/contracts");
    } catch(e: any) {
      alert("שגיאה: " + (e?.message || JSON.stringify(e)));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div dir="rtl" className="p-8 text-center text-slate-400">טוען...</div>;

  const monthlyRent = rentPerSqm && contract?.charged_area
    ? Number(rentPerSqm) * contract.charged_area + Number(investmentAddition)
    : null;

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-700 text-2xl">&larr;</button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">עריכת חוזה</h1>
          <p className="text-sm text-slate-500">{contract?.tenants?.name} — {contract?.properties?.name}</p>
        </div>
      </div>

      <div className="space-y-5">

        {/* סטטוס */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">סטטוס חוזה</h2>
          <select value={status} onChange={e => setStatus(e.target.value)} className={ic}>
            <option value="active">פעיל</option>
            <option value="ended">הסתיים</option>
            <option value="extended">הוארך (אופציה מומשה)</option>
            <option value="cancelled">בוטל</option>
          </select>

          {/* אופציה מומשה */}
          {optionMonths && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                <input type="checkbox" checked={optionExercised} onChange={e => {
                  setOptionExercised(e.target.checked);
                  if (e.target.checked) setStatus("extended");
                }} className="w-4 h-4" />
                <span className="font-medium">האופציה מומשה</span>
                <span className="text-slate-400 text-xs">({optionMonths} חודשים)</span>
              </label>
              {optionExercised && (
                <div className="mt-2 text-xs text-purple-600 bg-purple-50 rounded px-3 py-2">
                  ✓ החוזה יוצג כ"הוארך" במקום "הסתיים"
                </div>
              )}
            </div>
          )}
        </div>

        {/* קישור מסמך */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-slate-500">📎 קישור למסמך</h2>
          <input type="url" value={documentUrl} onChange={e => setDocumentUrl(e.target.value)}
            placeholder="https://www.dropbox.com/... או https://drive.google.com/..."
            className={ic} />
          <p className="text-xs text-slate-400 mt-1.5">הדבק קישור ל-Dropbox, Google Drive, או כל מקום אחר</p>
          {documentUrl && (
            <a href={documentUrl} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-block text-xs text-blue-600 hover:underline">בדוק קישור ↗</a>
          )}
        </div>

        {/* תקופה */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">תקופת חוזה</h2>
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
          <div className="mt-3">
            <label className="mb-1 block text-xs font-semibold text-slate-700">אופציה (חודשים)</label>
            <input type="number" value={optionMonths} onChange={e => setOptionMonths(e.target.value)}
              placeholder="24" className={ic} />
          </div>
        </div>

        {/* תשלום */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">תנאי תשלום</h2>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תעריף למ"ר (₪)</label>
              <input type="number" value={rentPerSqm} onChange={e => setRentPerSqm(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעות (₪)</label>
              <input type="number" value={investmentAddition} onChange={e => setInvestmentAddition(e.target.value)} className={ic} />
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
            <div className="rounded-lg bg-green-50 px-4 py-2.5 text-sm flex justify-between">
              <span className="text-slate-600">שכ"ד חודשי</span>
              <span className="font-bold text-green-700">₪{monthlyRent.toLocaleString()}</span>
            </div>
          )}

          {/* עליית מחיר */}
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
                    <label className="mb-1 block text-xs font-semibold text-slate-700">{priceIncreaseType === "percent" ? "אחוז עלייה" : "סכום (₪)"}</label>
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
          <h2 className="mb-4 text-sm font-bold text-slate-700">מדד הצמדה</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">חודש בסיס</label>
              <select value={indexBaseMonth} onChange={e => setIndexBaseMonth(e.target.value)} className={ic}>
                <option value="">--</option>
                {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m,i) => (
                  <option key={m} value={m}>{["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"][i]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שנת בסיס</label>
              <input type="number" value={indexBaseYear} onChange={e => setIndexBaseYear(e.target.value)} placeholder="2021" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">ערך מדד</label>
              <input type="number" step="0.01" value={indexBaseValue} onChange={e => setIndexBaseValue(e.target.value)} placeholder="102.3" className={ic} />
            </div>
          </div>
        </div>

        {/* דמי ניהול */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-700">דמי ניהול</h2>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={vatType === "taxable"} onChange={() => setVatType("taxable")} />
                <span>חייב מע"מ</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={vatType === "exempt"} onChange={() => setVatType("exempt")} />
                <span>פטור ממע"מ</span>
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול למ"ר (₪)</label>
              <input type="number" step="0.01" value={mgmtFeePerSqm} onChange={e => setMgmtFeePerSqm(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז מע"מ</label>
              <select value={vatPct} onChange={e => setVatPct(e.target.value)} className={ic}>
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
              <select value={guaranteeType} onChange={e => setGuaranteeType(e.target.value)} className={ic}>
                <option value="">-- בחר --</option>
                <option value="bank">ערבות בנקאית</option>
                <option value="check">שיק ביטחון</option>
                <option value="cash">פיקדון מזומן</option>
                <option value="other">אחר</option>
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

        {/* הערות */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-slate-500">📝 הערות</h2>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            rows={4} placeholder="הערות נוספות על החוזה..."
            className={ic + " resize-none"} />
        </div>

        {/* כפתורים */}
        <div className="flex gap-3 pt-2">
          <button onClick={() => router.back()} className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">ביטול</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {saving ? "שומר..." : "שמור שינויים"}
          </button>
        </div>
      </div>
    </div>
  );
}
