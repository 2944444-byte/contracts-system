"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";
import { logAudit } from "../../../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const TABS = [
  { id:"basic",      label:"פרטי חוזה",    icon:"📄" },
  { id:"financial",  label:"כספים",         icon:"💳" },
  { id:"options",    label:"אופציות",       icon:"🔄" },
  { id:"guarantees", label:"ערבויות",       icon:"🏦" },
];

export default function ContractEditPage() {
  const params = useParams();
  const router = useRouter();
  const contractId = params?.id as string;

  const [tab,       setTab]       = useState("basic");
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [contract,  setContract]  = useState<any>(null);
  const [tenants,   setTenants]   = useState<any[]>([]);
  const [properties,setProperties]= useState<any[]>([]);
  const [options,   setOptions]   = useState<any[]>([]);
  const [guarantees,setGuarantees]= useState<any[]>([]);

  // basic
  const [tenantId,   setTenantId]   = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [status,     setStatus]     = useState("active");
  const [startDate,  setStartDate]  = useState("");
  const [endDate,    setEndDate]    = useState("");
  // financial
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

  useEffect(function() { loadAll(); }, [contractId]);

  async function loadAll() {
    const [{ data: c }, { data: t }, { data: p }, { data: o }, { data: g }] = await Promise.all([
      supabase.from("contracts").select("*").eq("id", contractId).single(),
      supabase.from("tenants").select("id,name").order("name"),
      supabase.from("properties").select("id,name").order("name"),
      supabase.from("contract_options").select("*").eq("contract_id", contractId).order("option_number"),
      supabase.from("guarantees").select("*").eq("contract_id", contractId),
    ]);
    if (c) {
      setContract(c);
      setTenantId(c.tenant_id??""); setPropertyId(c.property_id??""); setStatus(c.status??"active");
      setStartDate(c.start_date?.split("T")[0]??""); setEndDate(c.end_date?.split("T")[0]??"");
      setRentPerSqm(c.rent_per_sqm?.toString()??""); setChargedArea(c.charged_area?.toString()??"");
      setInvAddition(c.investment_addition?.toString()??""); setVatType(c.vat_type??"taxable");
      setBaseIndex(c.base_cpi_value?.toString()??""); setBaseIndexDate(c.base_cpi_date?.split("T")[0]??"");
      setIndexMethod(c.indexation_method??"standard"); setRentType(c.rent_type??"fixed");
      setRevenuePct(c.revenue_pct?.toString()??""); setMinRentSqm(c.min_rent_per_sqm?.toString()??"");
      setMgmtPct(c.management_fee_pct?.toString()??""); setMgmtFixed(c.management_fee_fixed?.toString()??"");
    }
    setTenants(t??[]); setProperties(p??[]); setOptions(o??[]); setGuarantees(g??[]);
    setLoading(false);
  }

  async function saveBasic() {
    setSaving(true);
    try {
      await supabase.from("contracts").update({
        tenant_id: tenantId, property_id: propertyId, status,
        start_date: startDate||null, end_date: endDate||null,
        rent_per_sqm:      rentPerSqm    ? Number(rentPerSqm)    : null,
        charged_area:      chargedArea   ? Number(chargedArea)   : null,
        investment_addition: invAddition ? Number(invAddition)   : null,
        vat_type: vatType,
        base_cpi_value:    baseIndex     ? Number(baseIndex)     : null,
        base_cpi_date:     baseIndexDate || null,
        indexation_method: indexMethod,
        rent_type:         rentType,
        revenue_pct:       revenuePct    ? Number(revenuePct)    : null,
        min_rent_per_sqm:  minRentSqm    ? Number(minRentSqm)   : null,
        management_fee_pct:   mgmtPct   ? Number(mgmtPct)   : null,
        management_fee_fixed: mgmtFixed ? Number(mgmtFixed) : null,
      }).eq("id", contractId);
      await logAudit({ entity_type:"contract", entity_id:contractId, action:"update" });
      alert("✅ נשמר בהצלחה");
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function addOption() {
    const { data } = await supabase.from("contract_options").insert({
      contract_id: contractId, option_number: options.length+1,
      duration_months: 12, notice_days_before_end: 90, status: "pending",
    }).select().single();
    setOptions(function(prev) { return [...prev, data]; });
  }

  async function updateOption(id: string, field: string, val: any) {
    await supabase.from("contract_options").update({ [field]: val }).eq("id", id);
    setOptions(function(prev) { return prev.map(function(o) { return o.id===id ? {...o,[field]:val} : o; }); });
  }

  async function deleteOption(id: string) {
    if (!confirm("למחוק אופציה?")) return;
    await supabase.from("contract_options").delete().eq("id", id);
    setOptions(function(prev) { return prev.filter(function(o) { return o.id!==id; }); });
  }

  const monthly = (Number(rentPerSqm)||0)*(Number(chargedArea)||0)+(Number(invAddition)||0);

  if (loading) return <div className="text-center py-12 text-slate-400">טוען...</div>;

  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button onClick={function(){router.push("/contracts");}} className="text-slate-400 hover:text-slate-600">← חזרה</button>
        <h1 className="text-2xl font-bold text-slate-800">עריכת חוזה</h1>
        <span className="text-sm text-slate-400">{contract?.tenants?.name ?? tenants.find(function(t){return t.id===tenantId;})?.name ?? ""}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {TABS.map(function(t) {
          return (
            <button key={t.id} onClick={function(){setTab(t.id);}}
              className={"px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px " +
                (tab===t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">

        {/* Basic + Financial combined */}
        {(tab==="basic" || tab==="financial") && (
          <div className="space-y-4">
            {tab==="basic" && (
              <>
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
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                  <select value={status} onChange={function(e){setStatus(e.target.value);}} className={ic}>
                    {["active","expiring","extended","upcoming","ended"].map(function(s){
                      const labels:Record<string,string>={active:"פעיל",expiring:"פוגה",extended:"מורחב",upcoming:"עתידי",ended:"הסתיים"};
                      return <option key={s} value={s}>{labels[s]}</option>;
                    })}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">תחילה</label>
                    <input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">סיום</label>
                    <input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} className={ic} />
                  </div>
                </div>
              </>
            )}
            {tab==="financial" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">שכ"ד/מ"ר (₪)</label>
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
                  <label className="mb-2 block text-xs font-semibold text-slate-700">שיטת הצמדה</label>
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
                <div>
                  <label className="mb-2 block text-xs font-semibold text-slate-700">סוג שכ"ד</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[{v:"fixed",l:"קבוע"},{v:"revenue_based",l:"פידיון"},{v:"indexed",l:"מוצמד"}].map(function(r) {
                      return (
                        <button key={r.v} type="button" onClick={function(){setRentType(r.v);}}
                          className={"rounded-xl border p-2.5 text-sm font-semibold " +
                            (rentType===r.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 hover:bg-slate-50 text-slate-600")}>
                          {r.l}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {rentType==="revenue_based" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">% מהמחזור</label>
                      <input type="number" value={revenuePct} onChange={function(e){setRevenuePct(e.target.value);}} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">מינימום ₪/מ"ר</label>
                      <input type="number" value={minRentSqm} onChange={function(e){setMinRentSqm(e.target.value);}} className={ic} />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול %</label>
                    <input type="number" value={mgmtPct} onChange={function(e){setMgmtPct(e.target.value);}} className={ic} step="0.5" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול קבוע (₪)</label>
                    <input type="number" value={mgmtFixed} onChange={function(e){setMgmtFixed(e.target.value);}} className={ic} />
                  </div>
                </div>
                {monthly > 0 && (
                  <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm">
                    <div className="flex justify-between font-bold text-green-800">
                      <span>הכנסה חודשית</span>
                      <span>₪{Math.round(monthly+(vatType==="taxable"?monthly*0.18:0)).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </>
            )}
            <button onClick={saveBasic} disabled={saving}
              className="w-full rounded-xl bg-blue-700 py-3 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50 mt-4">
              {saving ? "שומר..." : "💾 שמור שינויים"}
            </button>
          </div>
        )}

        {/* Options */}
        {tab==="options" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800">אופציות ({options.length})</h3>
              <button onClick={addOption} className="rounded-xl bg-blue-600 text-white text-sm px-4 py-2 font-semibold">+ אופציה</button>
            </div>
            {options.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">אין אופציות — לחץ + להוסיף</div>
            ) : options.map(function(opt) {
              return (
                <div key={opt.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">אופציה {opt.option_number}</span>
                    <div className="flex gap-2">
                      <select value={opt.status} onChange={function(e){updateOption(opt.id,"status",e.target.value);}}
                        className="text-xs border border-slate-200 rounded px-2 py-1">
                        <option value="pending">ממתינה</option>
                        <option value="exercised">מומשה</option>
                        <option value="expired">פגה</option>
                      </select>
                      <button onClick={function(){deleteOption(opt.id);}} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">חודשים</label>
                      <input type="number" value={opt.duration_months??""} className={ic}
                        onChange={function(e){updateOption(opt.id,"duration_months",Number(e.target.value));}} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">ימי הודעה</label>
                      <input type="number" value={opt.notice_days_before_end??""} className={ic}
                        onChange={function(e){updateOption(opt.id,"notice_days_before_end",Number(e.target.value));}} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Guarantees summary */}
        {tab==="guarantees" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800">ערבויות ({guarantees.length})</h3>
              <button onClick={function(){router.push("/guarantees");}} className="text-sm text-blue-600 hover:underline">נהל ערבויות →</button>
            </div>
            {guarantees.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">אין ערבויות לחוזה זה</div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-right text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold text-slate-700">סוג</th>
                      <th className="px-4 py-2.5 font-semibold text-slate-700">נדרש</th>
                      <th className="px-4 py-2.5 font-semibold text-slate-700">בפועל</th>
                      <th className="px-4 py-2.5 font-semibold text-slate-700">סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guarantees.map(function(g) {
                      const diff = (g.amount_actual??0)-(g.amount_required??0);
                      return (
                        <tr key={g.id} className={"border-t border-slate-100 " + (diff<0?"bg-red-50":"")}>
                          <td className="px-4 py-2.5 text-slate-700">{g.guarantee_type}</td>
                          <td className="px-4 py-2.5">₪{(g.amount_required??0).toLocaleString()}</td>
                          <td className="px-4 py-2.5 font-semibold">₪{(g.amount_actual??0).toLocaleString()}</td>
                          <td className="px-4 py-2.5">
                            <span className={diff<0?"text-red-600 font-bold":"text-green-600"}>{diff<0?"פער!":"✓"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
