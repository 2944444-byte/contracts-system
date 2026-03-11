"use client";
import { useState, useEffect } from "react";
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

export default function EditContractPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const isExtension = searchParams?.get("mode") === "extend"; // מצב הארכה

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contract, setContract] = useState<any>(null);

  // שדות
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rentPerSqm, setRentPerSqm] = useState("");
  const [chargedArea, setChargedArea] = useState("");
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
  const [hasPriceIncrease, setHasPriceIncrease] = useState(false);
  const [priceIncreaseType, setPriceIncreaseType] = useState("percent");
  const [priceIncreaseValue, setPriceIncreaseValue] = useState("");
  const [priceIncreaseFreqMonths, setPriceIncreaseFreqMonths] = useState("12");
  const [priceIncreaseUntilYear, setPriceIncreaseUntilYear] = useState("");
  const [status, setStatus] = useState("active");
  const [notes, setNotes] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");

  // הארכה — תקופה חדשה
  const [extendDurationValue, setExtendDurationValue] = useState("12");
  const [extendDurationUnit, setExtendDurationUnit] = useState<"months"|"years">("months");

  useEffect(() => {
    if (!id) return;
    supabase.from("contracts")
      .select("*, tenants(name), properties(name), units:contract_units(unit_id, units(name, area))")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (!data) { router.push("/contracts"); return; }
        setContract(data);

        if (isExtension) {
          // הארכה: התחלה = יום אחרי סיום המקורי
          const origEnd = fmt(data.end_date);
          const newStart = origEnd ? (() => {
            const d = new Date(origEnd); d.setDate(d.getDate() + 1);
            return d.toISOString().split("T")[0];
          })() : "";
          setStartDate(newStart);
          setEndDate(newStart ? addMonths(newStart, 12) : "");
          setExtendDurationValue("12");
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
        setOptionMonths(!isExtension ? (data.option_months?.toString() ?? "") : "");
        setOptionExercised(data.option_exercised ?? false);
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
  }, [id, isExtension]);

  // חישוב תאריך סיום הארכה
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
        start_date: startDate,
        end_date: endDate,
        rent_per_sqm: rentPerSqm ? Number(rentPerSqm) : null,
        charged_area: chargedArea ? Number(chargedArea) : null,
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
        notes: notes || null,
        document_url: documentUrl || null,
      };

      if (isExtension) {
        // יצירת חוזה חדש + סגירת המקורי
        const newContract = {
          ...payload,
          property_id: contract.property_id,
          tenant_id: contract.tenant_id,
          unit_ids: contract.unit_ids,
          status: "active",
          parent_contract_id: id,
        };
        const { error: insertError } = await supabase.from("contracts").insert(newContract);
        if (insertError) throw insertError;
        // סגור את המקורי
        await supabase.from("contracts").update({ status: "ended", option_exercised: true }).eq("id", id);
        alert("✅ החוזה הוארך בהצלחה! נוצר חוזה חדש.");
      } else {
        // עדכון רגיל
        payload.status = status;
        const { error } = await supabase.from("contracts").update(payload).eq("id", id);
        if (error) throw error;
        alert("✅ החוזה עודכן בהצלחה!");
      }
      router.push("/contracts");
    } catch(e: any) {
      alert("שגיאה: " + (e?.message || JSON.stringify(e)));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div dir="rtl" className="p-8 text-center text-slate-400">טוען...</div>;

  const area = Number(chargedArea) || contract?.charged_area || 0;
  const monthlyRent = rentPerSqm && area ? Number(rentPerSqm) * area + Number(investmentAddition) : null;

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-700 text-2xl">&larr;</button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            {isExtension ? "🔄 הארכת חוזה" : "✏️ עריכת חוזה"}
          </h1>
          <p className="text-sm text-slate-500">{contract?.tenants?.name} — {contract?.properties?.name}</p>
        </div>
      </div>

      {isExtension && (
        <div className="mb-5 rounded-xl bg-purple-50 border border-purple-200 p-4 text-sm text-purple-800">
          <div className="font-bold mb-1">🔄 הארכת חוזה קיים</div>
          <div>יישמר חוזה חדש החל מ-{startDate ? startDate.split("-").reverse().join("/") : "—"}. החוזה הקודם יסומן כ"הסתיים".</div>
          <div className="mt-1 text-xs text-purple-600">כל הנתונים הועתקו מהחוזה הקודם — שנה רק מה שצריך.</div>
        </div>
      )}

      <div className="space-y-5">

        {/* תקופה */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">
            {isExtension ? "📅 תקופת ההארכה" : "📅 תקופת חוזה"}
          </h2>

          {isExtension && (
            <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm">
              <div className="flex justify-between mb-2">
                <span className="text-slate-500">חוזה מקורי הסתיים:</span>
                <span className="font-medium">{fmt(contract.end_date).split("-").reverse().join("/")}</span>
              </div>
              <div className="mb-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">משך ההארכה</label>
                <div className="flex gap-2">
                  <input type="number" value={extendDurationValue}
                    onChange={e => { setExtendDurationValue(e.target.value); updateExtendEnd(e.target.value, extendDurationUnit); }}
                    className={ic} placeholder="12" />
                  <select value={extendDurationUnit}
                    onChange={e => { setExtendDurationUnit(e.target.value as any); updateExtendEnd(extendDurationValue, e.target.value as any); }}
                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white">
                    <option value="months">חודשים</option>
                    <option value="years">שנים</option>
                  </select>
                </div>
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

          {!isExtension && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-slate-700">אופציות (חודשים)</label>
              <input type="number" value={optionMonths} onChange={e => setOptionMonths(e.target.value)} placeholder="24" className={ic} />
            </div>
          )}
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
                <option value="other">אחר</option>
              </select>
            </div>
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
          {isExtension && (
            <p className="text-xs text-slate-400 mb-3">בהארכה ניתן לעדכן את מדד הבסיס לחוזה החדש</p>
          )}
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
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={vatType === "taxable"} onChange={() => setVatType("taxable")} />
                <span>חייב מע"מ</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={vatType === "exempt"} onChange={() => setVatType("exempt")} />
                <span>פטור</span>
              </label>
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
                <option value="0">0%</option>
                <option value="17">17%</option>
                <option value="18">18%</option>
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

        {/* סטטוס + מימוש אופציה (עריכה בלבד) */}
        {!isExtension && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-slate-500">סטטוס</h2>
            <select value={status} onChange={e => setStatus(e.target.value)} className={ic}>
              <option value="active">פעיל</option>
              <option value="ended">הסתיים</option>
              <option value="extended">הוארך</option>
              <option value="cancelled">בוטל</option>
            </select>
            {optionMonths && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" checked={optionExercised} onChange={e => {
                    setOptionExercised(e.target.checked);
                    if (e.target.checked) setStatus("extended");
                  }} className="w-4 h-4" />
                  <span className="font-medium">✅ האופציה מומשה</span>
                  <span className="text-slate-400 text-xs">({optionMonths} חודשים)</span>
                </label>
                {optionExercised && (
                  <p className="mt-1.5 text-xs text-purple-600 bg-purple-50 rounded px-3 py-1.5">
                    החוזה יוצג כ"הוארך" — אם תרצה ליצור חוזה הארכה רשמי, לחץ "הארך חוזה" מרשימת החוזים
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* קישור מסמך */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-slate-500">📎 קישור למסמך</h2>
          <input type="url" value={documentUrl} onChange={e => setDocumentUrl(e.target.value)}
            placeholder="https://www.dropbox.com/... או https://drive.google.com/..."
            className={ic} />
          {documentUrl && (
            <a href={documentUrl} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-block text-xs text-blue-600 hover:underline">פתח קישור ↗</a>
          )}
        </div>

        {/* הערות */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-slate-500">📝 הערות</h2>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            rows={3} placeholder="הערות נוספות..."
            className={ic + " resize-none"} />
        </div>

        {/* כפתורים */}
        <div className="flex gap-3 pt-2">
          <button onClick={() => router.back()} className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">ביטול</button>
          <button onClick={handleSave} disabled={saving} className={`flex-1 rounded-lg py-2.5 font-bold text-white disabled:opacity-50 ${isExtension ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-700 hover:bg-blue-800"}`}>
            {saving ? "שומר..." : isExtension ? "🔄 צור חוזה הארכה" : "שמור שינויים"}
          </button>
        </div>
      </div>
    </div>
  );
}
