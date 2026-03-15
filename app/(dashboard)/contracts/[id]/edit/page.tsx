"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";
import { logAudit } from "../../../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

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
  const contractId = params?.id as string;

  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [tenants,    setTenants]    = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [activeTab,  setActiveTab]  = useState("basic");

  // פרטי חוזה
  const [tenantId,    setTenantId]    = useState("");
  const [propertyId,  setPropertyId]  = useState("");
  const [startDate,   setStartDate]   = useState("");
  const [endDate,     setEndDate]     = useState("");
  const [rentPerSqm,  setRentPerSqm]  = useState("");
  const [chargedArea, setChargedArea] = useState("");
  const [investAdd,   setInvestAdd]   = useState("0");
  const [vatType,     setVatType]     = useState("taxable");
  const [rentType,    setRentType]    = useState("fixed");
  const [revenuePct,  setRevenuePct]  = useState("");
  const [minRentSqm,  setMinRentSqm]  = useState("");
  const [baseCpiVal,  setBaseCpiVal]  = useState("");
  const [baseCpiDate, setBaseCpiDate] = useState("");
  const [notes,       setNotes]       = useState("");
  const [status,      setStatus]      = useState("active");

  // אופציות
  const [options, setOptions] = useState<any[]>([]);

  // TI
  const [tiItems, setTiItems] = useState<any[]>([]);

  // מדרגות
  const [tiers, setTiers] = useState<any[]>([]);

  useEffect(function() { loadAll(); }, [contractId]);

  async function loadAll() {
    const [{ data: c }, { data: t }, { data: p }] = await Promise.all([
      supabase.from("contracts")
        .select("*, contract_options(*), contract_ti(*), contract_price_tiers(*)")
        .eq("id", contractId).single(),
      supabase.from("tenants").select("id,name").order("name"),
      supabase.from("properties").select("id,name").order("name"),
    ]);
    if (c) {
      setTenantId(c.tenant_id ?? ""); setPropertyId(c.property_id ?? "");
      setStartDate(c.start_date?.split("T")[0] ?? ""); setEndDate(c.end_date?.split("T")[0] ?? "");
      setRentPerSqm(c.rent_per_sqm?.toString() ?? ""); setChargedArea(c.charged_area?.toString() ?? "");
      setInvestAdd(c.investment_addition?.toString() ?? "0"); setVatType(c.vat_type ?? "taxable");
      setBaseCpiVal(c.base_cpi_value?.toString() ?? ""); setBaseCpiDate(c.base_cpi_date?.split("T")[0] ?? "");
      setNotes(c.notes ?? ""); setStatus(c.status ?? "active");
      setOptions(c.contract_options ?? []);
      setTiItems(c.contract_ti ?? []);
      setTiers(c.contract_price_tiers ?? []);
    }
    setTenants(t ?? []); setProperties(p ?? []);
    setLoading(false);
  }

  async function handleSaveBasic() {
    setSaving(true);
    try {
      await supabase.from("contracts").update({
        tenant_id: tenantId, property_id: propertyId,
        start_date: startDate, end_date: endDate,
        rent_per_sqm: rentPerSqm ? Number(rentPerSqm) : null,
        charged_area: chargedArea ? Number(chargedArea) : null,
        investment_addition: Number(investAdd),
        vat_type: vatType,
        rent_type: rentType,
        revenue_pct: revenuePct ? Number(revenuePct) : null,
        min_rent_per_sqm: minRentSqm ? Number(minRentSqm) : null,
        base_cpi_value: baseCpiVal ? Number(baseCpiVal) : null,
        base_cpi_date: baseCpiDate || null,
        notes: notes || null, status,
      }).eq("id", contractId);
      await logAudit({ entity_type: "contract", entity_id: contractId, action: "update" });
      alert("נשמר בהצלחה");
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  // אופציות
  async function saveOption(opt: any) {
    if (opt.id && !opt.id.startsWith("new_")) {
      await supabase.from("contract_options").update({
        duration_months: opt.duration_months, notice_type: opt.notice_type,
        notice_days_before_end: opt.notice_days_before_end, rent_mechanism: opt.rent_mechanism,
        rent_increase_pct: opt.rent_increase_pct ?? null, status: opt.status,
      }).eq("id", opt.id);
    } else {
      const { data } = await supabase.from("contract_options").insert({
        contract_id: contractId, option_number: opt.option_number,
        duration_months: opt.duration_months, notice_type: opt.notice_type,
        notice_days_before_end: opt.notice_days_before_end, rent_mechanism: opt.rent_mechanism,
        status: "pending",
      }).select().single();
      if (data) {
        setOptions(options.map(function(o) { return o.id === opt.id ? data : o; }));
      }
    }
    await logAudit({ entity_type: "contract_option", entity_id: opt.id, action: "update" });
  }

  async function deleteOption(id: string) {
    if (id.startsWith("new_")) {
      setOptions(options.filter(function(o) { return o.id !== id; })); return;
    }
    await supabase.from("contract_options").delete().eq("id", id);
    setOptions(options.filter(function(o) { return o.id !== id; }));
  }

  function addOption() {
    setOptions([...options, {
      id: "new_" + Date.now(), option_number: options.length + 1,
      duration_months: 12, notice_type: "exercise", notice_days_before_end: 90,
      rent_mechanism: "no_change", status: "pending",
    }]);
  }

  function updateOptionField(id: string, field: string, value: string) {
    setOptions(options.map(function(o) {
      return o.id === id ? { ...o, [field]: ["duration_months","notice_days_before_end","rent_increase_pct"].includes(field) ? Number(value) : value } : o;
    }));
  }

  // TI
  async function saveTi(ti: any) {
    if (ti.id && !ti.id.startsWith("new_")) {
      await supabase.from("contract_ti").update({
        ti_type: ti.ti_type, ti_amount: ti.ti_amount, status: ti.status, notes: ti.notes,
      }).eq("id", ti.id);
    } else {
      const { data } = await supabase.from("contract_ti").insert({
        contract_id: contractId, ti_type: ti.ti_type,
        ti_amount: ti.ti_amount, status: ti.status ?? "pending", notes: ti.notes,
      }).select().single();
      if (data) setTiItems(tiItems.map(function(t) { return t.id === ti.id ? data : t; }));
    }
  }

  async function deleteTi(id: string) {
    if (id.startsWith("new_")) { setTiItems(tiItems.filter(function(t) { return t.id !== id; })); return; }
    await supabase.from("contract_ti").delete().eq("id", id);
    setTiItems(tiItems.filter(function(t) { return t.id !== id; }));
  }

  function addTi() {
    setTiItems([...tiItems, { id: "new_" + Date.now(), ti_type: "renovation", ti_amount: "", status: "pending", notes: "" }]);
  }

  function updateTiField(id: string, field: string, value: string) {
    setTiItems(tiItems.map(function(t) { return t.id === id ? { ...t, [field]: field === "ti_amount" ? value : value } : t; }));
  }

  // מדרגות
  async function saveTier(tier: any) {
    if (tier.id && !tier.id.startsWith("new_")) {
      await supabase.from("contract_price_tiers").update({
        tier_number: tier.tier_number, start_date: tier.start_date,
        end_date: tier.end_date, rent_per_sqm: tier.rent_per_sqm,
      }).eq("id", tier.id);
    } else {
      const { data } = await supabase.from("contract_price_tiers").insert({
        contract_id: contractId, tier_number: tier.tier_number,
        start_date: tier.start_date, end_date: tier.end_date, rent_per_sqm: tier.rent_per_sqm,
      }).select().single();
      if (data) setTiers(tiers.map(function(t) { return t.id === tier.id ? data : t; }));
    }
  }

  async function deleteTier(id: string) {
    if (id.startsWith("new_")) { setTiers(tiers.filter(function(t) { return t.id !== id; })); return; }
    await supabase.from("contract_price_tiers").delete().eq("id", id);
    setTiers(tiers.filter(function(t) { return t.id !== id; }));
  }

  function addTier() {
    setTiers([...tiers, {
      id: "new_" + Date.now(), tier_number: tiers.length + 1,
      start_date: "", end_date: "", rent_per_sqm: "",
    }]);
  }

  function updateTierField(id: string, field: string, value: string) {
    setTiers(tiers.map(function(t) { return t.id === id ? { ...t, [field]: value } : t; }));
  }

  const TABS = [
    { id: "basic",   label: "פרטי חוזה" },
    { id: "options", label: "אופציות (" + options.length + ")" },
    { id: "tiers",   label: "מדרגות (" + tiers.length + ")"   },
    { id: "ti",      label: "TI (" + tiItems.length + ")"      },
  ];

  if (loading) return <div dir="rtl" className="py-12 text-center text-slate-400">טוען...</div>;

  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">עריכת חוזה</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {tenants.find(function(t){return t.id===tenantId;})?.name} — {properties.find(function(p){return p.id===propertyId;})?.name}
          </p>
        </div>
        <button onClick={function() { router.push("/contracts"); }}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
          ← חזרה
        </button>
      </div>

      {/* טאבים */}
      <div className="flex gap-1 mb-5">
        {TABS.map(function(t) {
          return (
            <button key={t.id} onClick={function() { setActiveTab(t.id); }}
              className={"rounded-xl border px-4 py-2 text-sm font-semibold transition-all " +
                (activeTab === t.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">

        {/* פרטי חוזה */}
        {activeTab === "basic" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר</label>
                <select value={tenantId} onChange={function(e){setTenantId(e.target.value);}} className={ic}>
                  {tenants.map(function(t){return <option key={t.id} value={t.id}>{t.name}</option>;})}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
                <select value={propertyId} onChange={function(e){setPropertyId(e.target.value);}} className={ic}>
                  {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תחילה</label>
                <input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סיום</label>
                <input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={status} onChange={function(e){setStatus(e.target.value);}} className={ic}>
                  {["upcoming","active","expiring","extended","ended"].map(function(s){
                    return <option key={s} value={s}>{s}</option>;
                  })}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שכ"ד (₪/מ"ר)</label>
                <input type="number" value={rentPerSqm} onChange={function(e){setRentPerSqm(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ"ר)</label>
                <input type="number" value={chargedArea} onChange={function(e){setChargedArea(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעה</label>
                <input type="number" value={investAdd} onChange={function(e){setInvestAdd(e.target.value);}} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ</label>
                <select value={vatType} onChange={function(e){setVatType(e.target.value);}} className={ic}>
                  <option value="taxable">חייב</option>
                  <option value="exempt">פטור</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג שכ"ד</label>
                <select value={rentType} onChange={function(e){setRentType(e.target.value);}} className={ic}>
                  <option value="fixed">קבוע</option>
                  <option value="revenue_based">פידיון (%)</option>
                  <option value="indexed">מוצמד בלבד</option>
                </select>
              </div>
              {rentType === 'revenue_based' && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">% מהמחזור</label>
                    <input type="number" value={revenuePct} onChange={function(e){setRevenuePct(e.target.value);}} className={ic} placeholder="8" step="0.5" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">מינימום שכ"ד (₪/מ"ר)</label>
                    <input type="number" value={minRentSqm} onChange={function(e){setMinRentSqm(e.target.value);}} className={ic} placeholder="80" />
                  </div>
                </>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מדד בסיס</label>
                <input type="number" value={baseCpiVal} onChange={function(e){setBaseCpiVal(e.target.value);}} className={ic} step="0.01" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך מדד</label>
                <input type="date" value={baseCpiDate} onChange={function(e){setBaseCpiDate(e.target.value);}} className={ic} />
              </div>
            </div>
            {rentPerSqm && chargedArea && (
              <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-700 font-bold">
                הכנסה חודשית: ₪{Math.round(Number(rentPerSqm)*Number(chargedArea)+Number(investAdd||0)).toLocaleString()}
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
              <textarea value={notes} onChange={function(e){setNotes(e.target.value);}} rows={3} className={ic} />
            </div>
            <button onClick={handleSaveBasic} disabled={saving}
              className="w-full rounded-lg bg-blue-700 py-3 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "שומר..." : "💾 שמור פרטי חוזה"}
            </button>
          </div>
        )}

        {/* אופציות */}
        {activeTab === "options" && (
          <div className="space-y-4">
            {options.map(function(opt) {
              return (
                <div key={opt.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-slate-800">אופציה {opt.option_number}</span>
                    <div className="flex gap-2">
                      <span className={"text-xs px-2 py-0.5 rounded-full " +
                        (opt.status === "exercised" ? "bg-blue-100 text-blue-700" :
                          opt.status === "expired" ? "bg-slate-100 text-slate-400" : "bg-green-100 text-green-700")}>
                        {opt.status === "exercised" ? "הופעלה" : opt.status === "expired" ? "פגה" : "פעילה"}
                      </span>
                      <button onClick={function() { saveOption(opt); }}
                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">שמור</button>
                      <button onClick={function() { deleteOption(opt.id); }}
                        className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">משך (חודשים)</label>
                      <input type="number" value={opt.duration_months}
                        onChange={function(e){updateOptionField(opt.id,"duration_months",e.target.value);}} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">הודעה (ימים)</label>
                      <input type="number" value={opt.notice_days_before_end}
                        onChange={function(e){updateOptionField(opt.id,"notice_days_before_end",e.target.value);}} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">סוג הפעלה</label>
                      <select value={opt.notice_type}
                        onChange={function(e){updateOptionField(opt.id,"notice_type",e.target.value);}} className={ic}>
                        <option value="exercise">הפעלה</option>
                        <option value="non_renewal">אי-חידוש</option>
                        <option value="auto_extend">אוטומטי</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">מנגנון שכ"ד</label>
                      <select value={opt.rent_mechanism}
                        onChange={function(e){updateOptionField(opt.id,"rent_mechanism",e.target.value);}} className={ic}>
                        <option value="no_change">ללא שינוי</option>
                        <option value="pct_increase">% עלייה</option>
                        <option value="fixed">קבוע</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">סטטוס</label>
                      <select value={opt.status}
                        onChange={function(e){updateOptionField(opt.id,"status",e.target.value);}} className={ic}>
                        <option value="pending">פעילה</option>
                        <option value="exercised">הופעלה</option>
                        <option value="expired">פגה</option>
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
            <button onClick={addOption}
              className="w-full rounded-xl border-2 border-dashed border-blue-200 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50">
              + הוסף אופציה
            </button>
          </div>
        )}

        {/* מדרגות */}
        {activeTab === "tiers" && (
          <div className="space-y-4">
            {tiers.map(function(tier) {
              return (
                <div key={tier.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-slate-800">מדרגה {tier.tier_number}</span>
                    <div className="flex gap-2">
                      <button onClick={function(){saveTier(tier);}} className="text-xs bg-blue-600 text-white px-2 py-1 rounded">שמור</button>
                      <button onClick={function(){deleteTier(tier.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400">🗑</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">מ-תאריך</label>
                      <input type="date" value={tier.start_date?.split("T")[0]??""} onChange={function(e){updateTierField(tier.id,"start_date",e.target.value);}} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">עד-תאריך</label>
                      <input type="date" value={tier.end_date?.split("T")[0]??""} onChange={function(e){updateTierField(tier.id,"end_date",e.target.value);}} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">שכ"ד (₪/מ"ר)</label>
                      <input type="number" value={tier.rent_per_sqm??""} onChange={function(e){updateTierField(tier.id,"rent_per_sqm",e.target.value);}} className={ic} />
                    </div>
                  </div>
                </div>
              );
            })}
            <button onClick={addTier} className="w-full rounded-xl border-2 border-dashed border-blue-200 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50">
              + הוסף מדרגה
            </button>
          </div>
        )}

        {/* TI */}
        {activeTab === "ti" && (
          <div className="space-y-4">
            {tiItems.map(function(ti) {
              return (
                <div key={ti.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-slate-800">השקעת שוכר</span>
                    <div className="flex gap-2">
                      <button onClick={function(){saveTi(ti);}} className="text-xs bg-blue-600 text-white px-2 py-1 rounded">שמור</button>
                      <button onClick={function(){deleteTi(ti.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400">🗑</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">סוג</label>
                      <select value={ti.ti_type??""} onChange={function(e){updateTiField(ti.id,"ti_type",e.target.value);}} className={ic}>
                        <option value="renovation">שיפוצים</option>
                        <option value="equipment">ציוד</option>
                        <option value="allowance">מענק</option>
                        <option value="other">אחר</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">סכום (₪)</label>
                      <input type="number" value={ti.ti_amount??""} onChange={function(e){updateTiField(ti.id,"ti_amount",e.target.value);}} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">סטטוס</label>
                      <select value={ti.status??""} onChange={function(e){updateTiField(ti.id,"status",e.target.value);}} className={ic}>
                        <option value="pending">ממתין</option>
                        <option value="approved">אושר</option>
                        <option value="paid">שולם</option>
                      </select>
                    </div>
                    <div className="col-span-3">
                      <label className="mb-1 block text-xs text-slate-600">הערות</label>
                      <input type="text" value={ti.notes??""} onChange={function(e){updateTiField(ti.id,"notes",e.target.value);}} className={ic} />
                    </div>
                  </div>
                </div>
              );
            })}
            <button onClick={addTi} className="w-full rounded-xl border-2 border-dashed border-blue-200 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50">
              + הוסף TI
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
