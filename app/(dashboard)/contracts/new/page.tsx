"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { logAudit } from "../../../../lib/audit-log";

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

export default function NewContractPage() {
  const router = useRouter();
  const [tenants,    setTenants]    = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [spaces,     setSpaces]     = useState<any[]>([]);
  const [saving,     setSaving]     = useState(false);
  const [step,       setStep]       = useState(1);

  // שלב 1 — פרטי חוזה
  const [tenantId,   setTenantId]   = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [startDate,  setStartDate]  = useState("");
  const [durationM,  setDurationM]  = useState("12");
  const [endDate,    setEndDate]    = useState("");
  const [rentPerSqm, setRentPerSqm] = useState("");
  const [chargedArea,setChargedArea]= useState("");
  const [investAdd,  setInvestAdd]  = useState("0");
  const [vatType,    setVatType]    = useState("taxable");
  const [baseCpiVal, setBaseCpiVal] = useState("");
  const [baseCpiDate,setBaseCpiDate]= useState("");
  const [notes,      setNotes]      = useState("");

  // שלב 2 — יחידות
  const [selectedSpaces, setSelectedSpaces] = useState<any[]>([]);

  // שלב 3 — אופציות
  const [options, setOptions] = useState<any[]>([]);

  useEffect(function() {
    supabase.from("tenants").select("id, name").order("name").then(function({ data }) { setTenants(data ?? []); });
    supabase.from("properties").select("id, name").order("name").then(function({ data }) { setProperties(data ?? []); });
  }, []);

  useEffect(function() {
    if (startDate && durationM) {
      setEndDate(addMonths(startDate, Number(durationM)));
    }
  }, [startDate, durationM]);

  useEffect(function() {
    if (!propertyId) { setSpaces([]); return; }
    supabase.from("spaces").select("id, name, area, space_type, status").eq("property_id", propertyId)
      .then(function({ data }) { setSpaces(data ?? []); });
  }, [propertyId]);

  function toggleSpace(sp: any) {
    const exists = selectedSpaces.find(function(s) { return s.space_id === sp.id; });
    if (exists) {
      setSelectedSpaces(selectedSpaces.filter(function(s) { return s.space_id !== sp.id; }));
    } else {
      setSelectedSpaces([...selectedSpaces, {
        space_id: sp.id, name: sp.name, area: sp.area,
        charge_method: "per_sqm", price_per_sqm: rentPerSqm || "", fixed_amount: "",
      }]);
    }
  }

  function updateSpaceField(spaceId: string, field: string, value: string) {
    setSelectedSpaces(selectedSpaces.map(function(s) {
      return s.space_id === spaceId ? { ...s, [field]: value } : s;
    }));
  }

  function addOption() {
    setOptions([...options, {
      durationMonths: 12, noticeDaysBefore: 90, noticeType: "exercise",
      rentMechanism: "no_change", rentIncreasePct: 0,
    }]);
  }

  function updateOption(i: number, field: string, value: string) {
    const updated = [...options];
    (updated[i] as any)[field] = field === "durationMonths" || field === "noticeDaysBefore" || field === "rentIncreasePct"
      ? Number(value) : value;
    setOptions(updated);
  }

  async function handleSave() {
    if (!tenantId || !propertyId || !startDate || !endDate) {
      alert("חובה: שוכר, נכס, תאריך תחילה וסיום"); return;
    }
    setSaving(true);
    try {
      // צור חוזה
      const { data: contract, error } = await supabase.from("contracts").insert({
        tenant_id:        tenantId,
        property_id:      propertyId,
        start_date:       startDate,
        end_date:         endDate,
        rent_per_sqm:     rentPerSqm ? Number(rentPerSqm) : null,
        charged_area:     chargedArea ? Number(chargedArea) : null,
        investment_addition: Number(investAdd),
        vat_type:         vatType,
        base_cpi_value:   baseCpiVal ? Number(baseCpiVal) : null,
        base_cpi_date:    baseCpiDate || null,
        notes:            notes || null,
        status:           "upcoming",
      }).select().single();
      if (error) throw error;

      // צור יחידות M2M
      for (const sp of selectedSpaces) {
        await supabase.from("contract_spaces").insert({
          contract_id:   contract.id,
          space_id:      sp.space_id,
          charge_method: sp.charge_method,
          price_per_sqm: sp.charge_method === "per_sqm" && sp.price_per_sqm ? Number(sp.price_per_sqm) : null,
          fixed_amount:  sp.charge_method === "fixed"   && sp.fixed_amount  ? Number(sp.fixed_amount)  : null,
        });
        // עדכן סטטוס יחידה
        await supabase.from("spaces").update({ status: "rented" }).eq("id", sp.space_id);
      }

      // צור אופציות
      let prevEnd = endDate;
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const optStart = nextDay(prevEnd);
        const optEnd   = addMonths(optStart, opt.durationMonths);
        await supabase.from("contract_options").insert({
          contract_id:            contract.id,
          option_number:          i + 1,
          duration_months:        opt.durationMonths,
          start_date:             optStart,
          end_date:               optEnd,
          notice_type:            opt.noticeType,
          notice_days_before_end: opt.noticeDaysBefore,
          rent_mechanism:         opt.rentMechanism,
          rent_increase_pct:      opt.rentIncreasePct || null,
          status:                 "pending",
        });
        prevEnd = optEnd;
      }

      await logAudit({ entity_type: "contract", entity_id: contract.id, action: "create" });
      router.push("/contracts");
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  const steps = ["פרטי חוזה", "יחידות", "אופציות", "סיכום"];

  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">חוזה חדש</h1>
          <p className="text-sm text-slate-500 mt-0.5">שלב {step} מתוך {steps.length}: {steps[step - 1]}</p>
        </div>
        <button onClick={function() { router.push("/contracts"); }}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
          ← ביטול
        </button>
      </div>

      {/* Progress */}
      <div className="flex gap-2 mb-6">
        {steps.map(function(s, i) {
          return (
            <div key={i} className="flex-1">
              <div className={"h-1.5 rounded-full " + (i + 1 <= step ? "bg-blue-600" : "bg-slate-200")} />
              <div className={"text-xs mt-1 " + (i + 1 === step ? "text-blue-700 font-semibold" : "text-slate-400")}>{s}</div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">

        {/* שלב 1 */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר *</label>
                <select value={tenantId} onChange={function(e) { setTenantId(e.target.value); }} className={ic}>
                  <option value="">-- בחר שוכר --</option>
                  {tenants.map(function(t) { return <option key={t.id} value={t.id}>{t.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={propertyId} onChange={function(e) { setPropertyId(e.target.value); }} className={ic}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תחילה *</label>
                <input type="date" value={startDate} onChange={function(e) { setStartDate(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">משך (חודשים)</label>
                <input type="number" value={durationM} onChange={function(e) { setDurationM(e.target.value); }} className={ic} min="1" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סיום *</label>
                <input type="date" value={endDate} onChange={function(e) { setEndDate(e.target.value); }} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שכ"ד (₪/מ"ר)</label>
                <input type="number" value={rentPerSqm} onChange={function(e) { setRentPerSqm(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ"ר)</label>
                <input type="number" value={chargedArea} onChange={function(e) { setChargedArea(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעה</label>
                <input type="number" value={investAdd} onChange={function(e) { setInvestAdd(e.target.value); }} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ</label>
                <select value={vatType} onChange={function(e) { setVatType(e.target.value); }} className={ic}>
                  <option value="taxable">חייב במע"מ</option>
                  <option value="exempt">פטור ממע"מ</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מדד בסיס</label>
                <input type="number" value={baseCpiVal} onChange={function(e) { setBaseCpiVal(e.target.value); }} className={ic} step="0.01" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך מדד</label>
                <input type="date" value={baseCpiDate} onChange={function(e) { setBaseCpiDate(e.target.value); }} className={ic} />
              </div>
            </div>
            {rentPerSqm && chargedArea && (
              <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm">
                <span className="text-green-700 font-bold">
                  הכנסה חודשית: ₪{Math.round(Number(rentPerSqm) * Number(chargedArea) + Number(investAdd)).toLocaleString()}
                </span>
                {vatType === "taxable" && (
                  <span className="text-green-600 mr-2">
                    (כולל מע"מ: ₪{Math.round((Number(rentPerSqm) * Number(chargedArea) + Number(investAdd)) * 1.18).toLocaleString()})
                  </span>
                )}
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
              <textarea value={notes} onChange={function(e) { setNotes(e.target.value); }} rows={2} className={ic} />
            </div>
          </div>
        )}

        {/* שלב 2 */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded-xl p-3">
              בחר יחידות להוספה לחוזה. יחידות שנבחרו יוסמנו כמושכרות.
            </div>
            {spaces.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                {propertyId ? "אין יחידות לנכס זה" : "בחר נכס בשלב 1"}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {spaces.map(function(sp) {
                  const sel = selectedSpaces.find(function(s) { return s.space_id === sp.id; });
                  return (
                    <div key={sp.id}
                      onClick={function() { toggleSpace(sp); }}
                      className={"rounded-xl border-2 p-3 cursor-pointer transition-all " +
                        (sel ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300")}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm text-slate-800">{sp.name}</span>
                        <span className={"text-xs px-1.5 py-0.5 rounded-full " +
                          (sp.status === "rented" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700")}>
                          {sp.status === "rented" ? "מושכר" : "פנוי"}
                        </span>
                      </div>
                      {sp.area && <div className="text-xs text-slate-400">{sp.area} מ"ר</div>}
                      {sel && (
                        <div className="mt-2 space-y-1" onClick={function(e) { e.stopPropagation(); }}>
                          <select value={sel.charge_method}
                            onChange={function(e) { updateSpaceField(sp.id, "charge_method", e.target.value); }}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs">
                            <option value="per_sqm">₪/מ"ר</option>
                            <option value="fixed">סכום קבוע</option>
                            <option value="included">כלול בשכ"ד</option>
                          </select>
                          {sel.charge_method === "per_sqm" && (
                            <input type="number" value={sel.price_per_sqm}
                              onChange={function(e) { updateSpaceField(sp.id, "price_per_sqm", e.target.value); }}
                              placeholder="₪/מ&quot;ר" className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          )}
                          {sel.charge_method === "fixed" && (
                            <input type="number" value={sel.fixed_amount}
                              onChange={function(e) { updateSpaceField(sp.id, "fixed_amount", e.target.value); }}
                              placeholder="סכום קבוע" className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {selectedSpaces.length > 0 && (
              <div className="text-sm text-blue-700 font-semibold">{selectedSpaces.length} יחידות נבחרו</div>
            )}
          </div>
        )}

        {/* שלב 3 — אופציות */}
        {step === 3 && (
          <div className="space-y-4">
            {options.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <div className="text-4xl mb-2">📋</div>
                <div className="text-sm">לחוזה זה אין אופציות. ניתן להוסיף.</div>
              </div>
            ) : (
              options.map(function(opt, i) {
                const prevEnd = i === 0 ? endDate : addMonths(nextDay(i === 0 ? endDate : ""), options[i-1].durationMonths);
                const optStart = nextDay(i === 0 ? endDate : addMonths(nextDay(endDate), options.slice(0,i).reduce(function(s,o){return s+o.durationMonths;},0)));
                return (
                  <div key={i} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-semibold text-slate-800">אופציה {i + 1}</span>
                      <button onClick={function() { setOptions(options.filter(function(_, j) { return j !== i; })); }}
                        className="text-red-400 hover:text-red-600 text-lg">×</button>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">משך (חודשים)</label>
                        <input type="number" value={opt.durationMonths} min="1"
                          onChange={function(e) { updateOption(i, "durationMonths", e.target.value); }}
                          className={ic} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">הודעה (ימים)</label>
                        <input type="number" value={opt.noticeDaysBefore}
                          onChange={function(e) { updateOption(i, "noticeDaysBefore", e.target.value); }}
                          className={ic} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">סוג הפעלה</label>
                        <select value={opt.noticeType}
                          onChange={function(e) { updateOption(i, "noticeType", e.target.value); }}
                          className={ic}>
                          <option value="exercise">הפעלה פוזיטיבית</option>
                          <option value="non_renewal">אי-חידוש</option>
                          <option value="auto_extend">הארכה אוטומטית</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">מנגנון שכ"ד</label>
                        <select value={opt.rentMechanism}
                          onChange={function(e) { updateOption(i, "rentMechanism", e.target.value); }}
                          className={ic}>
                          <option value="no_change">ללא שינוי</option>
                          <option value="pct_increase">% עלייה</option>
                          <option value="fixed">סכום קבוע</option>
                        </select>
                      </div>
                      {opt.rentMechanism === "pct_increase" && (
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">% עלייה</label>
                          <input type="number" value={opt.rentIncreasePct}
                            onChange={function(e) { updateOption(i, "rentIncreasePct", e.target.value); }}
                            className={ic} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <button onClick={addOption}
              className="w-full rounded-xl border-2 border-dashed border-blue-200 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50">
              + הוסף אופציה
            </button>
          </div>
        )}

        {/* שלב 4 — סיכום */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-xl bg-slate-50 p-4 space-y-2">
                <div className="font-bold text-slate-700 mb-2">פרטי חוזה</div>
                <div className="flex justify-between"><span className="text-slate-500">שוכר</span><span>{tenants.find(function(t){return t.id===tenantId;})?.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">נכס</span><span>{properties.find(function(p){return p.id===propertyId;})?.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">תקופה</span><span>{startDate} — {endDate}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">שכ"ד</span><span>₪{rentPerSqm}/מ"ר × {chargedArea} מ"ר</span></div>
                <div className="flex justify-between font-bold"><span>הכנסה חודשית</span><span className="text-green-700">₪{Math.round(Number(rentPerSqm||0)*Number(chargedArea||0)+Number(investAdd||0)).toLocaleString()}</span></div>
              </div>
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="font-bold text-slate-700 mb-2">יחידות ({selectedSpaces.length})</div>
                  {selectedSpaces.length === 0 ? <div className="text-xs text-slate-400">לא נבחרו</div> :
                    selectedSpaces.map(function(s) { return <div key={s.space_id} className="text-xs text-slate-600">{s.name}</div>; })}
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="font-bold text-slate-700 mb-2">אופציות ({options.length})</div>
                  {options.length === 0 ? <div className="text-xs text-slate-400">ללא אופציות</div> :
                    options.map(function(o, i) { return <div key={i} className="text-xs text-slate-600">אופציה {i+1}: {o.durationMonths} חודשים</div>; })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ניווט */}
        <div className="flex gap-3 mt-6 pt-4 border-t border-slate-100">
          {step > 1 && (
            <button onClick={function() { setStep(step - 1); }}
              className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              ← הקודם
            </button>
          )}
          <div className="flex-1" />
          {step < 4 ? (
            <button onClick={function() { setStep(step + 1); }}
              className="rounded-lg bg-blue-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800">
              הבא →
            </button>
          ) : (
            <button onClick={handleSave} disabled={saving}
              className="rounded-lg bg-green-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-50">
              {saving ? "שומר..." : "✅ צור חוזה"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
