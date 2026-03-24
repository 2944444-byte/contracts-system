"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const STEPS = [
  {id:1, label:"שוכר ונכס",    icon:"👤"},
  {id:2, label:"תנאי שכירות", icon:"📋"},
  {id:3, label:"גרייס ועלייה", icon:"📈"},
  {id:4, label:"ביטחונות",    icon:"🏦"},
  {id:5, label:"סיכום",        icon:"✅"},
];

const VAT_TYPES        = [{v:"taxable",l:'חייב במע"מ (18%)'},{v:"exempt",l:"פטור"},{v:"partial",l:"חלקי"}];
const INDEX_METHODS    = [{v:"standard",l:"t-2 רגיל"},{v:"highest_in_period",l:"מדד גבוה ביותר"},{v:"none",l:"ללא הצמדה"}];
const PAYMENT_FREQS    = [{v:"monthly",l:"חודשי"},{v:"quarterly",l:"רבעוני"},{v:"annual",l:"שנתי"},{v:"checks_advance",l:'שיקים מראש'},{v:"one_time",l:"חד פעמי"}];
const CONTRACT_TYPES   = [{v:"regular",l:"שכירות רגילה"},{v:"complementary",l:"הסכם משלים"},{v:"parking",l:"חניה"},{v:"special",l:"שימוש מיוחד"},{v:"other",l:"אחר"}];
const GRACE_TYPES      = [{v:"full",l:"גרייס מלא (100%)"},{v:"partial",l:"גרייס חלקי"},{v:"rent_only",l:'גרייס על שכ"ד בלבד'}];
const GUARANTEE_TYPES  = [{v:"bank",l:"ערבות בנקאית",icon:"🏦"},{v:"check",l:"שיקים",icon:"📝"},{v:"cash",l:"מזומן",icon:"💵"},{v:"insurance",l:"ביטוח",icon:"🛡️"},{v:"personal",l:"אישית",icon:"👤"}];
const INCREASE_TYPES   = [{v:"pct",l:"אחוז קבוע"},{v:"fixed",l:"סכום קבוע (₪/מ\"ר)"},{v:"none",l:"ללא עלייה"}];

function fmtMoney(n: number) { return "₪"+Math.round(n).toLocaleString("he-IL"); }

export default function ContractsNewPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [tenants, setTenants] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [spaces, setSpaces] = useState<any[]>([]);

  // Step 1
  const [tenantId,      setTenantId]      = useState("");
  const [propertyId,    setPropertyId]    = useState("");
  const [selSpaces,     setSelSpaces]     = useState<string[]>([]);
  const [contractType,  setContractType]  = useState("regular");

  // Step 2
  const [startDate,     setStartDate]     = useState("");
  const [endDate,       setEndDate]       = useState("");
  const [rentPerSqm,    setRentPerSqm]    = useState("");
  const [chargedArea,   setChargedArea]   = useState("");
  const [investAdd,     setInvestAdd]     = useState("");
  const [vatType,       setVatType]       = useState("taxable");
  const [paymentFreq,   setPaymentFreq]   = useState("monthly");
  const [paymentDay,    setPaymentDay]    = useState("1");
  const [indexMethod,   setIndexMethod]   = useState("standard");
  const [baseCPI,       setBaseCPI]       = useState("");
  const [baseCPIDate,   setBaseCPIDate]   = useState("");
  const [hasOption,     setHasOption]     = useState(false);
  const [optionYears,   setOptionYears]   = useState("1");
  const [mgmtFeePct,    setMgmtFeePct]    = useState("");

  // Step 3 — גרייס ועלייה
  const [hasGrace,        setHasGrace]        = useState(false);
  const [graceMonths,     setGraceMonths]     = useState("3");
  const [graceType,       setGraceType]       = useState("full");
  const [graceDiscountPct,setGraceDiscountPct]= useState("50");
  const [hasIncrease,     setHasIncrease]     = useState(false);
  const [increaseType,    setIncreaseType]    = useState("pct");
  const [increaseValue,   setIncreaseValue]   = useState("");
  const [increaseFreqMo,  setIncreaseFreqMo]  = useState("12");
  const [increaseUntilYr, setIncreaseUntilYr] = useState("");

  // Step 4 — ביטחונות
  const [guaranteeType,    setGuaranteeType]    = useState("bank");
  const [guaranteeAmt,     setGuaranteeAmt]     = useState("");
  const [guaranteeActual,  setGuaranteeActual]  = useState("");
  const [guaranteeBank,    setGuaranteeBank]    = useState("");
  const [guaranteeEnd,     setGuaranteeEnd]     = useState("");
  const [addGuarantee,     setAddGuarantee]     = useState(false);

  useEffect(function() { loadRef(); }, []);
  useEffect(function() {
    if (propertyId) {
      supabase.from("spaces").select("id,space_name,area,status").eq("property_id",propertyId)
        .then(function({data}){ setSpaces(data??[]); setSelSpaces([]); });
    }
  }, [propertyId]);

  async function loadRef() {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from("tenants").select("id,name,company_name").order("name"),
      supabase.from("properties").select("id,name,city").order("name"),
    ]);
    setTenants(t??[]);
    setProperties(p??[]);
  }

  function toggleSpace(id: string) {
    setSelSpaces(function(prev) {
      return prev.includes(id) ? prev.filter(function(x){return x!==id;}) : [...prev,id];
    });
    const sp = spaces.find(function(s){return s.id===id;});
    if (sp?.area && !selSpaces.includes(id)) {
      setChargedArea(function(prev){ return prev ? prev : sp.area.toString(); });
    }
  }

  const baseRent  = (Number(rentPerSqm)||0)*(Number(chargedArea)||0)+(Number(investAdd)||0);
  const vat       = vatType==="taxable" ? baseRent*0.18 : 0;
  const totalRent = baseRent+vat;
  const annualRent= baseRent*12;

  async function handleSubmit() {
    if (!tenantId||!propertyId||!startDate||!endDate||!rentPerSqm) {
      alert("נא מלא כל שדות חובה"); return;
    }
    setSaving(true);
    try {
      const insertPayload: any = {
        tenant_id:         tenantId,
        property_id:       propertyId,
        contract_type:     contractType,
        start_date:        startDate,
        end_date:          endDate,
        rent_per_sqm:      Number(rentPerSqm)||null,
        charged_area:      Number(chargedArea)||null,
        investment_addition: Number(investAdd)||null,
        vat_type:          vatType,
        payment_frequency: paymentFreq,
        payment_day:       Number(paymentDay)||1,
        indexation_method: indexMethod,
        index_base_value:  baseCPI ? Number(baseCPI) : null,
        index_base_date:   baseCPIDate||null,
        mgmt_fee_per_sqm:  mgmtFeePct ? Number(mgmtFeePct) : null,
        status:            "active",
      };

      // גרייס
      if (hasGrace) {
        insertPayload.grace_months      = Number(graceMonths)||null;
        insertPayload.grace_type        = graceType;
        insertPayload.grace_discount_pct= graceType==="partial" ? Number(graceDiscountPct)||null : null;
      }

      // עלייה שנתית
      if (hasIncrease) {
        insertPayload.price_increase_type        = increaseType;
        insertPayload.price_increase_value       = Number(increaseValue)||null;
        insertPayload.price_increase_freq_months = Number(increaseFreqMo)||12;
        insertPayload.price_increase_until_year  = increaseUntilYr ? Number(increaseUntilYr) : null;
      }

      const { data: contract, error: ce } = await supabase
        .from("contracts").insert(insertPayload).select().single();
      if (ce) throw new Error(ce.message);
      if (!contract?.id) throw new Error("שגיאה בשמירת חוזה");

      // קשר חוזה-יחידות
      if (selSpaces.length>0) {
        await supabase.from("contract_spaces").insert(
          selSpaces.map(function(sid){return {contract_id:contract.id, space_id:sid};})
        );
        await supabase.from("spaces").update({status:"occupied"}).in("id",selSpaces);
      }

      // אופציה
      if (hasOption) {
        const optEnd = new Date(
          new Date(endDate).getTime()+(Number(optionYears)*365*24*3600*1000)
        ).toISOString().split("T")[0];
        await supabase.from("contract_options").insert({
          contract_id: contract.id,
          start_date:  endDate,
          end_date:    optEnd,
          status:      "pending",
        });
      }

      // ערבות
      if (addGuarantee && guaranteeAmt) {
        await supabase.from("guarantees").insert({
          contract_id:     contract.id,
          guarantee_type:  guaranteeType,
          amount_required: Number(guaranteeAmt),
          amount_actual:   guaranteeActual ? Number(guaranteeActual) : null,
          bank:            guaranteeBank||null,
          end_date:        guaranteeEnd||null,
          status:          "active",
        });
      }

      await logAudit({
        entity_type: "contract",
        entity_id:   contract.id,
        action:      "create",
        notes:       tenants.find(function(t){return t.id===tenantId;})?.name,
      });
      router.push("/contracts");
    } catch(e:any) {
      alert("שגיאה: "+e?.message);
    } finally {
      setSaving(false);
    }
  }

  const tenant   = tenants.find(function(t){return t.id===tenantId;});
  const property = properties.find(function(p){return p.id===propertyId;});

  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">חוזה חדש</h1>
      </div>

      {/* Steps */}
      <div className="flex gap-0 mb-8">
        {STEPS.map(function(s,i) {
          const done=step>s.id, active=step===s.id;
          return (
            <div key={s.id} className="flex-1 flex items-center">
              <div className={"flex items-center gap-2 cursor-pointer "+(active?"":"opacity-50")}
                onClick={function(){if(s.id<step)setStep(s.id);}}>
                <div className={"w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-all "+
                  (done?"bg-green-500 text-white":active?"bg-blue-600 text-white":"bg-slate-200 text-slate-500")}>
                  {done ? "✓" : s.icon}
                </div>
                <span className={"text-xs font-semibold hidden sm:block "+(active?"text-blue-700":"text-slate-400")}>{s.label}</span>
              </div>
              {i<STEPS.length-1&&<div className={"flex-1 h-px mx-2 "+(step>s.id?"bg-green-400":"bg-slate-200")}/>}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">

        {/* STEP 1 — שוכר ונכס */}
        {step===1 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">👤 שוכר ונכס</h2>

            {/* סוג חוזה */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700">סוג חוזה</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {CONTRACT_TYPES.map(function(ct){
                  return (
                    <button key={ct.v} type="button" onClick={function(){setContractType(ct.v);}}
                      className={"rounded-lg border p-2 text-center text-xs transition-all "+
                        (contractType===ct.v?"border-blue-500 bg-blue-50 font-bold text-blue-700":"border-slate-200 hover:bg-slate-50")}>
                      {ct.l}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר *</label>
              <select value={tenantId} onChange={function(e){setTenantId(e.target.value);}} className={ic}>
                <option value="">-- בחר שוכר --</option>
                {tenants.map(function(t){return <option key={t.id} value={t.id}>{t.name}{t.company_name?" — "+t.company_name:""}</option>;})}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
              <select value={propertyId} onChange={function(e){setPropertyId(e.target.value);}} className={ic}>
                <option value="">-- בחר נכס --</option>
                {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}{p.city?" — "+p.city:""}</option>;})}
              </select>
            </div>

            {spaces.length>0&&(
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">יחידות משויכות לחוזה</label>
                <div className="grid grid-cols-3 gap-2">
                  {spaces.map(function(s) {
                    const sel=selSpaces.includes(s.id);
                    return (
                      <button key={s.id} type="button" onClick={function(){toggleSpace(s.id);}}
                        className={"rounded-lg border p-2 text-center text-xs transition-all "+
                          (sel?"border-blue-500 bg-blue-50 font-bold text-blue-700":
                           s.status==="occupied"?"border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed":
                           "border-slate-200 hover:bg-slate-50")}
                        disabled={s.status==="occupied"&&!sel}>
                        <div className="font-semibold">{s.space_name}</div>
                        {s.area&&<div className="text-slate-400">{s.area} מ"ר</div>}
                        <div className={"text-xs "+(s.status==="occupied"?"text-red-400":"text-green-500")}>
                          {s.status==="occupied"?"מושכרת":"פנויה"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2 — תנאי שכירות */}
        {step===2 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">📋 תנאי שכירות</h2>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">תחילת חוזה *</label>
                <input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">סיום חוזה *</label>
                <input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">שכ"ד למ"ר (₪) *</label>
                <input type="number" value={rentPerSqm} onChange={function(e){setRentPerSqm(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">שטח מחויב (מ"ר)</label>
                <input type="number" value={chargedArea} onChange={function(e){setChargedArea(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעות (₪)</label>
                <input type="number" value={investAdd} onChange={function(e){setInvestAdd(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ</label>
                <select value={vatType} onChange={function(e){setVatType(e.target.value);}} className={ic}>
                  {VAT_TYPES.map(function(v){return <option key={v.v} value={v.v}>{v.l}</option>;})}
                </select></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">תדירות תשלום</label>
                <select value={paymentFreq} onChange={function(e){setPaymentFreq(e.target.value);}} className={ic}>
                  {PAYMENT_FREQS.map(function(v){return <option key={v.v} value={v.v}>{v.l}</option>;})}
                </select></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">יום תשלום בחודש</label>
                <input type="number" min="1" max="28" value={paymentDay} onChange={function(e){setPaymentDay(e.target.value);}} className={ic}/></div>
            </div>

            {/* תצוגה מקדימה */}
            {baseRent>0&&(
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                <div className="text-xs font-bold text-blue-700 mb-2">תצוגת שכ"ד חודשי</div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[{l:'שכ"ד בסיס',v:fmtMoney(baseRent)},{l:'מע"מ',v:fmtMoney(vat)},{l:'סה"כ לחודש',v:fmtMoney(totalRent)}]
                    .map(function(k){return <div key={k.l}><div className="text-lg font-black text-blue-800">{k.v}</div><div className="text-xs text-blue-600">{k.l}</div></div>;})}
                </div>
                <div className="mt-2 text-center text-xs text-blue-600">שנתי: <strong>{fmtMoney(annualRent)}</strong></div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">שיטת הצמדה</label>
                <select value={indexMethod} onChange={function(e){setIndexMethod(e.target.value);}} className={ic}>
                  {INDEX_METHODS.map(function(m){return <option key={m.v} value={m.v}>{m.l}</option>;})}
                </select></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">מדד בסיס</label>
                <input type="number" value={baseCPI} onChange={function(e){setBaseCPI(e.target.value);}} placeholder="למשל 107.5" className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">תאריך מדד בסיס</label>
                <input type="date" value={baseCPIDate} onChange={function(e){setBaseCPIDate(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול (₪/מ"ר)</label>
                <input type="number" value={mgmtFeePct} onChange={function(e){setMgmtFeePct(e.target.value);}} placeholder="5" className={ic}/></div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input type="checkbox" id="opt" checked={hasOption} onChange={function(e){setHasOption(e.target.checked);}} className="w-4 h-4"/>
              <label htmlFor="opt" className="text-sm font-semibold text-slate-700">הוסף אופציה לחידוש</label>
              {hasOption&&<select value={optionYears} onChange={function(e){setOptionYears(e.target.value);}} className="rounded border border-slate-300 px-2 py-1 text-sm">
                <option value="1">שנה</option><option value="2">שנתיים</option><option value="3">3 שנים</option>
              </select>}
            </div>
          </div>
        )}

        {/* STEP 3 — גרייס ועלייה */}
        {step===3 && (
          <div className="space-y-5">
            <h2 className="font-bold text-slate-800 text-lg mb-4">📈 גרייס ועלייה שנתית</h2>

            {/* גרייס */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <input type="checkbox" id="grace" checked={hasGrace} onChange={function(e){setHasGrace(e.target.checked);}} className="w-4 h-4"/>
                <label htmlFor="grace" className="text-sm font-bold text-slate-700">תקופת גרייס</label>
              </div>
              {hasGrace&&(
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="mb-1 block text-xs font-semibold text-slate-700">מספר חודשי גרייס</label>
                      <input type="number" min="1" max="24" value={graceMonths} onChange={function(e){setGraceMonths(e.target.value);}} className={ic}/></div>
                    <div><label className="mb-1 block text-xs font-semibold text-slate-700">סוג גרייס</label>
                      <select value={graceType} onChange={function(e){setGraceType(e.target.value);}} className={ic}>
                        {GRACE_TYPES.map(function(g){return <option key={g.v} value={g.v}>{g.l}</option>;})}
                      </select></div>
                  </div>
                  {graceType==="partial"&&(
                    <div><label className="mb-1 block text-xs font-semibold text-slate-700">אחוז הנחה בגרייס (%)</label>
                      <input type="number" min="1" max="99" value={graceDiscountPct} onChange={function(e){setGraceDiscountPct(e.target.value);}} className={ic}/></div>
                  )}
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
                    גרייס: {graceMonths} חודשים | {GRACE_TYPES.find(g=>g.v===graceType)?.l}
                    {graceType==="partial"&&` | ${graceDiscountPct}% הנחה`}
                    {" | "}שכ"ד בגרייס: {fmtMoney(graceType==="full"?0:graceType==="partial"?baseRent*(1-Number(graceDiscountPct)/100):0)}
                  </div>
                </div>
              )}
            </div>

            {/* עלייה שנתית */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <input type="checkbox" id="increase" checked={hasIncrease} onChange={function(e){setHasIncrease(e.target.checked);}} className="w-4 h-4"/>
                <label htmlFor="increase" className="text-sm font-bold text-slate-700">עלייה שנתית בשכ"ד</label>
              </div>
              {hasIncrease&&(
                <div className="space-y-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold text-slate-700">סוג עלייה</label>
                    <div className="flex gap-2">
                      {INCREASE_TYPES.map(function(it){return (
                        <button key={it.v} type="button" onClick={function(){setIncreaseType(it.v);}}
                          className={"rounded-lg border px-3 py-2 text-xs transition-all "+
                            (increaseType===it.v?"border-blue-500 bg-blue-50 font-bold text-blue-700":"border-slate-200 hover:bg-slate-50")}>
                          {it.l}
                        </button>
                      );})}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="mb-1 block text-xs font-semibold text-slate-700">
                      {increaseType==="pct"?"שיעור עלייה (%)":"סכום עלייה (₪/מ\"ר)"}
                    </label>
                      <input type="number" value={increaseValue} onChange={function(e){setIncreaseValue(e.target.value);}} className={ic}/></div>
                    <div><label className="mb-1 block text-xs font-semibold text-slate-700">תדירות (חודשים)</label>
                      <select value={increaseFreqMo} onChange={function(e){setIncreaseFreqMo(e.target.value);}} className={ic}>
                        <option value="12">שנתי (12)</option>
                        <option value="24">דו-שנתי (24)</option>
                        <option value="36">כל 3 שנים</option>
                      </select></div>
                    <div><label className="mb-1 block text-xs font-semibold text-slate-700">עלייה עד שנה (אופציונלי)</label>
                      <input type="number" value={increaseUntilYr} onChange={function(e){setIncreaseUntilYr(e.target.value);}} placeholder="למשל: 3" className={ic}/></div>
                  </div>
                </div>
              )}
              {!hasIncrease&&<div className="text-xs text-slate-400 mt-1">ללא עלייה שנתית (מעבר להצמדה)</div>}
            </div>
          </div>
        )}

        {/* STEP 4 — ביטחונות */}
        {step===4 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">🏦 ביטחונות</h2>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="guar" checked={addGuarantee} onChange={function(e){setAddGuarantee(e.target.checked);}} className="w-4 h-4"/>
              <label htmlFor="guar" className="text-sm font-semibold text-slate-700">הוסף ערבות לחוזה</label>
            </div>
            {addGuarantee&&(
              <div className="space-y-3">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {GUARANTEE_TYPES.map(function(t){return (
                    <button key={t.v} type="button" onClick={function(){setGuaranteeType(t.v);}}
                      className={"rounded-xl border p-2.5 text-center "+(guaranteeType===t.v?"border-blue-500 bg-blue-50":"border-slate-200")}>
                      <div>{t.icon}</div>
                      <div className={"text-xs font-semibold "+(guaranteeType===t.v?"text-blue-700":"text-slate-600")}>{t.l}</div>
                    </button>
                  );})}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="mb-1 block text-xs font-semibold text-slate-700">סכום נדרש (₪)</label>
                    <input type="number" value={guaranteeAmt} onChange={function(e){setGuaranteeAmt(e.target.value);}} className={ic}/></div>
                  <div><label className="mb-1 block text-xs font-semibold text-slate-700">סכום בפועל (₪)</label>
                    <input type="number" value={guaranteeActual} onChange={function(e){setGuaranteeActual(e.target.value);}} className={ic}/></div>
                  <div><label className="mb-1 block text-xs font-semibold text-slate-700">בנק / מוציא</label>
                    <input type="text" value={guaranteeBank} onChange={function(e){setGuaranteeBank(e.target.value);}} className={ic}/></div>
                  <div><label className="mb-1 block text-xs font-semibold text-slate-700">תוקף ערבות</label>
                    <input type="date" value={guaranteeEnd} onChange={function(e){setGuaranteeEnd(e.target.value);}} className={ic}/></div>
                </div>
              </div>
            )}
            {!addGuarantee&&<div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 p-6 text-center text-slate-400 text-sm">
              ניתן להוסיף ערבות מאוחר יותר דרך מסך הערבויות
            </div>}
          </div>
        )}

        {/* STEP 5 — סיכום */}
        {step===5 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">✅ סיכום החוזה</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                {l:"סוג חוזה",   v:CONTRACT_TYPES.find(c=>c.v===contractType)?.l},
                {l:"שוכר",       v:tenant?.name},
                {l:"נכס",        v:property?.name},
                {l:"יחידות",     v:selSpaces.length>0?`${selSpaces.length} יחידות`:"לא נבחרו"},
                {l:"תחילה",      v:startDate},
                {l:"סיום",       v:endDate},
                {l:'שכ"ד לחודש',v:fmtMoney(totalRent)},
                {l:"שנתי",       v:fmtMoney(annualRent)},
                {l:"תדירות",     v:PAYMENT_FREQS.find(p=>p.v===paymentFreq)?.l},
                {l:"הצמדה",      v:INDEX_METHODS.find(m=>m.v===indexMethod)?.l},
                {l:'מע"מ',       v:vatType==="taxable"?"18%":"פטור"},
                {l:"גרייס",      v:hasGrace?`${graceMonths} חודשים | ${GRACE_TYPES.find(g=>g.v===graceType)?.l}`:"לא"},
                {l:"עלייה",      v:hasIncrease?`${increaseValue}${increaseType==="pct"?"%":"₪"} כל ${increaseFreqMo} חודשים`:"לא"},
                {l:"אופציה",     v:hasOption?`${optionYears} שנה`:"לא"},
                {l:"ערבות",      v:addGuarantee?fmtMoney(Number(guaranteeAmt)||0):"לא"},
              ].map(function(r){return r.v?(
                <div key={r.l} className="flex justify-between border-b border-slate-100 py-2">
                  <span className="text-slate-500">{r.l}</span>
                  <span className="font-semibold text-slate-800">{r.v}</span>
                </div>
              ):null;})}
            </div>
          </div>
        )}

        {/* ניווט */}
        <div className="flex gap-3 mt-6 pt-4 border-t border-slate-100">
          {step>1&&<button onClick={function(){setStep(step-1);}}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-50">← חזור</button>}
          <div className="flex-1"/>
          {step<5 ? (
            <button
              onClick={function(){setStep(step+1);}}
              disabled={(step===1&&(!tenantId||!propertyId))||(step===2&&(!startDate||!endDate||!rentPerSqm))}
              className="rounded-xl bg-blue-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-40">
              המשך →
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving}
              className="rounded-xl bg-green-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-50">
              {saving?"שומר...":"✅ צור חוזה"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
