"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { logAudit } from "../../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const STEPS = ["צד א / ב", "תנאים כספיים", "אופציות", "סיכום"];

export default function ContractsNewPage() {
  const router  = useRouter();
  const [step,       setStep]       = useState(0);
  const [saving,     setSaving]     = useState(false);
  const [tenants,    setTenants]    = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [spaces,     setSpaces]     = useState<any[]>([]);

  // Step 1
  const [tenantId,    setTenantId]    = useState("");
  const [propertyId,  setPropertyId]  = useState("");
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);

  // Step 2
  const [startDate,    setStartDate]    = useState("");
  const [endDate,      setEndDate]      = useState("");
  const [rentPerSqm,   setRentPerSqm]   = useState("");
  const [chargedArea,  setChargedArea]  = useState("");
  const [invAddition,  setInvAddition]  = useState("");
  const [vatType,      setVatType]      = useState("taxable");
  const [baseIndex,    setBaseIndex]    = useState("");
  const [baseIndexDate,setBaseIndexDate]= useState("");
  const [indexMethod,  setIndexMethod]  = useState("standard");
  const [rentType,     setRentType]     = useState("fixed");
  const [revenuePct,   setRevenuePct]   = useState("");
  const [minRentSqm,   setMinRentSqm]   = useState("");
  const [mgmtPct,      setMgmtPct]      = useState("");
  const [mgmtFixed,    setMgmtFixed]    = useState("");

  // Step 3 - Options
  const [options, setOptions] = useState<{months:string;noticeDays:string}[]>([]);

  useEffect(function() { loadData(); }, []);

  async function loadData() {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from("tenants").select("id,name,company_name").order("name"),
      supabase.from("properties").select("id,name,city").order("name"),
    ]);
    setTenants(t ?? []);
    setProperties(p ?? []);
  }

  async function loadSpaces(propId: string) {
    const { data } = await supabase.from("spaces")
      .select("id,name,area,status,floor").eq("property_id", propId).order("name");
    setSpaces(data ?? []);
    // הצע שטח אוטומטי
    const occ = (data ?? []).filter(function(s:any){return s.status==="occupied";});
    if (occ.length === 0) {
      const tot = (data ?? []).reduce(function(s:any,sp:any){return s+(sp.area??0);},0);
      if (tot) setChargedArea(String(tot));
    }
  }

  function toggleSpace(id: string) {
    setSelectedSpaces(function(prev) {
      return prev.includes(id) ? prev.filter(function(x){return x!==id;}) : [...prev, id];
    });
  }

  function addOption() {
    setOptions(function(prev) { return [...prev, {months:"12",noticeDays:"90"}]; });
  }
  function removeOption(i: number) {
    setOptions(function(prev) { return prev.filter(function(_,j){return j!==i;}); });
  }

  const monthly = (Number(rentPerSqm)||0)*(Number(chargedArea)||0)+(Number(invAddition)||0);
  const vat      = vatType==="taxable" ? monthly*0.18 : 0;

  async function handleSubmit() {
    if (!tenantId || !propertyId || !startDate || !endDate) {
      alert("חובה: שוכר, נכס, תאריכים"); return;
    }
    setSaving(true);
    try {
      const { data: contract } = await supabase.from("contracts").insert({
        tenant_id:         tenantId,
        property_id:       propertyId,
        status:            new Date(startDate) > new Date() ? "upcoming" : "active",
        start_date:        startDate,
        end_date:          endDate,
        rent_per_sqm:      rentPerSqm ? Number(rentPerSqm) : null,
        charged_area:      chargedArea ? Number(chargedArea) : null,
        investment_addition: invAddition ? Number(invAddition) : null,
        vat_type:          vatType,
        base_cpi_value:    baseIndex ? Number(baseIndex) : null,
        base_cpi_date:     baseIndexDate || null,
        indexation_method: indexMethod,
        rent_type:         rentType,
        revenue_pct:       revenuePct ? Number(revenuePct) : null,
        min_rent_per_sqm:  minRentSqm ? Number(minRentSqm) : null,
        management_fee_pct:   mgmtPct   ? Number(mgmtPct)   : null,
        management_fee_fixed: mgmtFixed ? Number(mgmtFixed) : null,
      }).select().single();

      // contract_spaces
      for (const spaceId of selectedSpaces) {
        await supabase.from("contract_spaces").insert({ contract_id: contract.id, space_id: spaceId });
        await supabase.from("spaces").update({ status: "occupied" }).eq("id", spaceId);
      }

      // options
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (!opt.months) continue;
        const optStart = new Date(endDate);
        const optEnd   = new Date(endDate);
        optEnd.setMonth(optEnd.getMonth() + Number(opt.months));
        await supabase.from("contract_options").insert({
          contract_id: contract.id,
          option_number: i+1,
          duration_months: Number(opt.months),
          notice_days_before_end: Number(opt.noticeDays) || 90,
          start_date: endDate,
          end_date:   optEnd.toISOString().split("T")[0],
          status: "pending",
        });
      }

      await logAudit({ entity_type:"contract", entity_id:contract.id, action:"create" });
      router.push("/contracts");
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  return (
    <div dir="rtl" className="max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button onClick={function(){router.back();}} className="text-slate-400 hover:text-slate-600">← חזרה</button>
        <h1 className="text-2xl font-bold text-slate-800">חוזה חדש</h1>
      </div>

      {/* Steps */}
      <div className="flex gap-1 mb-6">
        {STEPS.map(function(s, i) {
          return (
            <div key={i} className={"flex-1 rounded-xl py-2 text-center text-xs font-semibold transition-all " +
              (i === step ? "bg-blue-600 text-white" : i < step ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400")}>
              {i+1}. {s}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">

        {/* Step 0 */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 mb-4">בחר שוכר ונכס</h2>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר *</label>
              <select value={tenantId} onChange={function(e){setTenantId(e.target.value);}} className={ic}>
                <option value="">-- בחר שוכר --</option>
                {tenants.map(function(t){return <option key={t.id} value={t.id}>{t.name}{t.company_name?" — "+t.company_name:""}</option>;})}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
              <select value={propertyId} onChange={function(e){setPropertyId(e.target.value);loadSpaces(e.target.value);}} className={ic}>
                <option value="">-- בחר נכס --</option>
                {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}{p.city?" — "+p.city:""}</option>;})}
              </select>
            </div>
            {spaces.length > 0 && (
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">יחידות (אופציונלי)</label>
                <div className="grid grid-cols-2 gap-2">
                  {spaces.map(function(s) {
                    const sel = selectedSpaces.includes(s.id);
                    return (
                      <button key={s.id} type="button" onClick={function(){toggleSpace(s.id);}}
                        className={"rounded-xl border p-2.5 text-right transition-all " +
                          (sel ? "border-blue-500 bg-blue-50" : s.status==="occupied" ? "border-slate-100 bg-slate-50 opacity-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div className={"font-semibold text-sm " + (sel?"text-blue-700":"text-slate-800")}>{s.name}</div>
                        <div className="text-xs text-slate-400">{s.area ? s.area+" מ\"ר" : ""}{s.floor ? " | קומה "+s.floor : ""}</div>
                        {s.status==="occupied" && <div className="text-xs text-red-400">תפוס</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 mb-4">תנאים כספיים</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תחילה *</label>
                <input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סיום *</label>
                <input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שכ"ד ל-מ"ר (₪)</label>
                <input type="number" value={rentPerSqm} onChange={function(e){setRentPerSqm(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שטח מחויב (מ"ר)</label>
                <input type="number" value={chargedArea} onChange={function(e){setChargedArea(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעה (₪)</label>
                <input type="number" value={invAddition} onChange={function(e){setInvAddition(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ</label>
                <select value={vatType} onChange={function(e){setVatType(e.target.value);}} className={ic}>
                  <option value="taxable">חייב (18%)</option>
                  <option value="exempt">פטור</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מדד בסיס</label>
                <input type="number" value={baseIndex} onChange={function(e){setBaseIndex(e.target.value);}} className={ic} step="0.1" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך מדד בסיס</label>
                <input type="date" value={baseIndexDate} onChange={function(e){setBaseIndexDate(e.target.value);}} className={ic} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שיטת הצמדה</label>
              <div className="grid grid-cols-2 gap-2">
                {[{v:"standard",l:"t-2 רגיל"},{v:"highest_in_period",l:"מדד גבוה ביותר"}].map(function(m) {
                  return (
                    <button key={m.v} type="button" onClick={function(){setIndexMethod(m.v);}}
                      className={"rounded-xl border p-2.5 text-sm font-semibold " +
                        (indexMethod===m.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 hover:bg-slate-50 text-slate-600")}>
                      {m.l}
                    </button>
                  );
                })}
              </div>
            </div>
            {monthly > 0 && (
              <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm">
                <div className="flex justify-between font-semibold text-green-800">
                  <span>הכנסה חודשית + מע"מ</span>
                  <span>₪{Math.round(monthly + vat).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — Options */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">אופציות (אופציונלי)</h2>
              <button onClick={addOption}
                className="rounded-xl bg-blue-600 text-white text-sm px-4 py-2 font-semibold hover:bg-blue-700">
                + אופציה
              </button>
            </div>
            {options.length === 0 && (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400 text-sm">
                אין אופציות — לחץ + אופציה להוסיף
              </div>
            )}
            {options.map(function(opt, i) {
              return (
                <div key={i} className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700 text-sm">אופציה {i+1}</span>
                    <button onClick={function(){removeOption(i);}} className="text-red-400 hover:text-red-600">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">משך (חודשים)</label>
                      <input type="number" value={opt.months}
                        onChange={function(e){setOptions(function(prev){const n=[...prev];n[i]={...n[i],months:e.target.value};return n;});}}
                        className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">ימי הודעה מראש</label>
                      <input type="number" value={opt.noticeDays}
                        onChange={function(e){setOptions(function(prev){const n=[...prev];n[i]={...n[i],noticeDays:e.target.value};return n;});}}
                        className={ic} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Step 3 — Summary */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 mb-4">סיכום וסגירה</h2>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-sm">
              {[
                {l:"שוכר",        v:tenants.find(function(t){return t.id===tenantId;})?.name ?? "—"},
                {l:"נכס",         v:properties.find(function(p){return p.id===propertyId;})?.name ?? "—"},
                {l:"תאריכים",     v:startDate+" — "+endDate},
                {l:"שכ\"ד/מ\"ר", v:rentPerSqm ? "₪"+rentPerSqm : "—"},
                {l:"שטח מחויב",   v:chargedArea ? chargedArea+" מ\"ר" : "—"},
                {l:"הכנסה חודשית",v:"₪"+Math.round(monthly).toLocaleString()},
                {l:"+ מע\"מ",     v:"₪"+Math.round(monthly+vat).toLocaleString()},
                {l:"אופציות",     v:options.length+" אופציות"},
              ].map(function(row) {
                return (
                  <div key={row.l} className="flex justify-between border-b border-slate-100 pb-1.5">
                    <span className="text-slate-400">{row.l}</span>
                    <span className="font-semibold text-slate-800">{row.v}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 mt-6">
          {step > 0 && (
            <button onClick={function(){setStep(function(s){return s-1;});}}
              className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              ← קודם
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button onClick={function(){setStep(function(s){return s+1;});}}
              className="flex-1 rounded-xl bg-blue-700 py-3 text-sm font-bold text-white hover:bg-blue-800">
              הבא →
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving}
              className="flex-1 rounded-xl bg-green-700 py-3 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-50">
              {saving ? "שומר חוזה..." : "✅ שמור חוזה"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
