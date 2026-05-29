"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import PropertyHierarchyFilter from '@/components/PropertyHierarchyFilter';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function daysLeft(d: string) { return Math.ceil((new Date(d).getTime()-Date.now())/86400000); }
function fmtMoney(n: number) { return n ? "₪"+Number(n).toLocaleString("he-IL",{minimumFractionDigits:0,maximumFractionDigits:0}) : "—"; }

// Tenant insurance coverage types, per the standard "נספח אחריות וביטוח".
// A tenant typically must hold several of these simultaneously.
const COVERAGE_TYPES = [
  { v: "contents",     l: "תכולה / רכוש",     icon: "📦", desc: "ביטוח תכולת המושכר ורכוש השוכר" },
  { v: "third_party",  l: "צד שלישי",          icon: "⚖️", desc: "אחריות כלפי צד ג' (לרוב ₪10,000,000)" },
  { v: "employers",    l: "חבות מעבידים",      icon: "👷", desc: "אחריות מעבידים כלפי עובדי השוכר" },
  { v: "consequential",l: "אבדן תוצאתי",       icon: "📉", desc: "אבדן רווח גולמי עקב נזק" },
  { v: "contractor",   l: "עבודות קבלניות",    icon: "🚧", desc: "ביטוח עבודות במהלך התאמות/שיפוץ המושכר" },
];
function coverageInfo(v: string) { return COVERAGE_TYPES.find(function(t){return t.v===v;}) || { v:v, l:v, icon:"🛡️", desc:"" }; }

// Doc types stored in documents jsonb.
function docTypeLabel(t: string) {
  if (t === "policy")      return "📄 פוליסה";
  if (t === "certificate") return "📄 אישור";
  if (t === "renewal")     return "♻️ חידוש";
  return "📎 מסמך";
}

type Health = "expired" | "expiring30" | "expiring60" | "ok" | "inactive";
function healthOf(ins: any): Health {
  if (ins.status === "expired") return "expired";
  if (ins.status !== "active") return "inactive";
  if (ins.end_date && daysLeft(ins.end_date) < 0) return "expired";
  if (ins.end_date && daysLeft(ins.end_date) <= 30) return "expiring30";
  if (ins.end_date && daysLeft(ins.end_date) <= 60) return "expiring60";
  return "ok";
}
function healthOrder(h: Health) { return ({expired:0,expiring30:1,expiring60:2,ok:3,inactive:4} as any)[h]; }

export default function InsurancesPage() {
  const [buildingIns, setBuildingIns] = useState<any[]>([]);
  const [tenantIns,   setTenantIns]   = useState<any[]>([]);
  const [properties,  setProperties]  = useState<any[]>([]);
  const [contracts,   setContracts]   = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState<"building"|"tenant">("building");
  const [editingId,   setEditingId]   = useState("");
  const [isNew,       setIsNew]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [filterPropIds, setFilterPropIds] = useState<string[]>([]);
  const [filterSt,    setFilterSt]    = useState<"all"|"active"|"expired"|"expiring">("all");

  // form
  const [fRefId,      setFRefId]      = useState("");
  const [fInsurer,    setFInsurer]    = useState("");
  const [fPolicyNum,  setFPolicyNum]  = useState("");
  const [fCoverage,   setFCoverage]   = useState("");
  const [fPremium,    setFPremium]    = useState("");
  const [fDeductible, setFDeductible] = useState("");
  const [fStartDate,  setFStartDate]  = useState("");
  const [fEndDate,    setFEndDate]    = useState("");
  const [fStatus,     setFStatus]     = useState("active");
  const [fNotes,      setFNotes]      = useState("");
  const [fDocUrl,     setFDocUrl]     = useState("");
  const [fCovTypes,   setFCovTypes]   = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]     = useState(false);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: b }, { data: t }, { data: p }, { data: c }] = await Promise.all([
      supabase.from("insurances_building").select("*, properties(name)").order("end_date"),
      supabase.from("insurances_tenant").select("*, contracts(id, property_id, no_tenant_insurance_required, tenants(name), properties(name), contract_spaces(spaces(space_name)))").order("end_date"),
      supabase.from("properties").select("id,name").order("name"),
      supabase.from("contracts")
        .select("id, property_id, start_date, end_date, status, is_amendment, parent_contract_id, no_tenant_insurance_required, tenants(name), properties(name), contract_spaces(spaces(space_name))")
        .in("status",["active","expiring","extended","upcoming"])
        .order("start_date", { ascending: false }),
    ]);
    setBuildingIns(b ?? []);
    setTenantIns(t ?? []);
    setProperties(p ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  function spacesLabel(contract: any): string {
    var arr = contract?.contract_spaces || [];
    var names = arr.map(function(cs: any){ return cs?.spaces?.space_name; }).filter(Boolean);
    if (names.length === 0) return "—";
    if (names.length <= 3) return names.join(" · ");
    return names.slice(0,3).join(" · ") + " +" + (names.length-3);
  }
  function contractRange(c: any): string {
    var s = c?.start_date ? new Date(c.start_date) : null;
    var e = c?.end_date ? new Date(c.end_date) : null;
    var fmt = function(d: Date){ return (d.getMonth()+1)+"/"+d.getFullYear(); };
    if (s && e) return fmt(s)+"–"+fmt(e);
    if (s) return "מ-"+fmt(s);
    if (e) return "עד "+fmt(e);
    return "";
  }
  function insurerOf(ins: any) { return ins.insurer_name || ins.insurer || "—"; }

  async function uploadFile(file: File, prefix: string): Promise<string> {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = "insurances/" + prefix + "_" + Date.now() + "_" + safe;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
    if (upErr) throw upErr;
    const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
    return urlData.publicUrl;
  }
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try { setFDocUrl(await uploadFile(file, activeTab)); }
    catch (err: any) { alert("שגיאה בהעלאה: " + (err?.message || err)); }
    finally { setUploading(false); }
  }

  function openNew(prefillRefId?: string) {
    setIsNew(true); setEditingId("new");
    setFRefId(prefillRefId || ""); setFInsurer(""); setFPolicyNum(""); setFCoverage("");
    setFPremium(""); setFDeductible(""); setFStartDate(""); setFEndDate("");
    setFStatus("active"); setFNotes(""); setFDocUrl(""); setFCovTypes([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function openEdit(ins: any) {
    setIsNew(false); setEditingId(ins.id);
    setFRefId(ins.property_id ?? ins.contract_id ?? "");
    setFInsurer(insurerOf(ins)==="—"?"":insurerOf(ins)); setFPolicyNum(ins.policy_number??"");
    setFCoverage(ins.coverage_amount?.toString()??""); setFPremium((ins.annual_premium ?? ins.total_premium)?.toString()??"");
    setFDeductible(ins.deductible?.toString()??"");
    setFStartDate(ins.start_date?.split("T")[0]??""); setFEndDate(ins.end_date?.split("T")[0]??"");
    setFStatus(ins.status??"active"); setFNotes(ins.notes??"");
    setFDocUrl(ins.document_url || ins.certificate_url || "");
    setFCovTypes(Array.isArray(ins.coverage_types) ? ins.coverage_types : []);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSave() {
    if (!fRefId) { alert("חובה: " + (activeTab==="building"?"נכס":"חוזה")); return; }
    setSaving(true);
    try {
      const table  = activeTab==="building" ? "insurances_building" : "insurances_tenant";
      const refKey = activeTab==="building" ? "property_id" : "contract_id";
      const existing = !isNew ? (activeTab==="building"?buildingIns:tenantIns).find(function(x){return x.id===editingId;}) : null;
      const prevDocs: any[] = Array.isArray(existing?.documents) ? existing.documents : [];
      const docs = prevDocs.slice();
      const urlKey = activeTab==="building" ? "document_url" : "certificate_url";
      if (fDocUrl && fDocUrl !== (existing?.document_url || existing?.certificate_url)) {
        docs.push({ type: activeTab==="building"?"policy":"certificate", url: fDocUrl, uploaded_at: new Date().toISOString() });
      }
      const payload: any = {
        [refKey]: fRefId,
        insurer:         fInsurer||null,
        insurer_name:    fInsurer||null,
        policy_number:   fPolicyNum||null,
        coverage_amount: fCoverage ? Number(fCoverage) : null,
        annual_premium:  fPremium  ? Number(fPremium)  : null,
        start_date:      fStartDate||null,
        end_date:        fEndDate||null,
        status:          fStatus,
        notes:           fNotes||null,
        [urlKey]:        fDocUrl||null,
        documents:       docs,
      };
      if (activeTab==="building") { payload.total_premium = fPremium ? Number(fPremium) : null; payload.deductible = fDeductible ? Number(fDeductible) : null; }
      else { payload.coverage_types = fCovTypes; }

      if (isNew) {
        const { data, error: ie } = await supabase.from(table).insert(payload).select().single();
        if (ie) throw new Error(ie.message);
        if (!data?.id) throw new Error("שגיאה בשמירה");
        await logAudit({ entity_type:"insurance", entity_id:data.id, action:"create" });
      } else {
        await supabase.from(table).update(payload).eq("id", editingId);
        await logAudit({ entity_type:"insurance", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק ביטוח?")) return;
    const table = activeTab==="building" ? "insurances_building" : "insurances_tenant";
    await supabase.from(table).delete().eq("id", id);
    await logAudit({ entity_type:"insurance", entity_id:id, action:"delete" });
    await loadAll();
  }

  async function markNoTenantInsurance(contractId: string, tenantName: string) {
    if (!confirm("לסמן את ההסכם של " + tenantName + " כ\"אינו דורש אישור ביטוח שוכר\"? יוצא מההתראה.")) return;
    await supabase.from("contracts").update({ no_tenant_insurance_required: true }).eq("id", contractId);
    await logAudit({ entity_type:"contract", entity_id:contractId, action:"mark_no_tenant_insurance" });
    await loadAll();
  }
  async function unmarkNoTenantInsurance(contractId: string) {
    await supabase.from("contracts").update({ no_tenant_insurance_required: false }).eq("id", contractId);
    await loadAll();
  }

  // ─── Filtering + sorting ───────────────────────────────────────────
  const allList = activeTab==="building" ? buildingIns : tenantIns;
  const propFiltered = filterPropIds.length===0 ? allList : allList.filter(function(ins) {
    const pid = activeTab==="building" ? ins.property_id : ins.contracts?.property_id;
    return filterPropIds.includes(pid);
  });
  const list = propFiltered.filter(function(ins) {
    var h = healthOf(ins);
    if (filterSt === "all") return true;
    if (filterSt === "active")   return ins.status === "active";
    if (filterSt === "expired")  return h === "expired";
    if (filterSt === "expiring") return h === "expiring30" || h === "expiring60";
    return true;
  });
  const sorted = list.slice().sort(function(a,b){
    var ha = healthOrder(healthOf(a)), hb = healthOrder(healthOf(b));
    if (ha !== hb) return ha - hb;
    var ea = a.end_date ? new Date(a.end_date).getTime() : Infinity;
    var eb = b.end_date ? new Date(b.end_date).getTime() : Infinity;
    return ea - eb;
  });

  const expiring = propFiltered.filter(function(ins) { var h=healthOf(ins); return h==="expiring30"||h==="expiring60"; });
  const expired  = propFiltered.filter(function(ins) { return healthOf(ins)==="expired"; });
  const active   = propFiltered.filter(function(ins) { return ins.status==="active"; });

  // ─── Coverage gap detection ────────────────────────────────────────
  // Properties (in use via active contracts) that have NO active in-date
  // building insurance.
  const usedPropertyIds = new Set<string>();
  contracts.forEach(function(c:any){ if (c.property_id) usedPropertyIds.add(c.property_id); });
  function propHasActiveBuildingIns(propId: string): boolean {
    return buildingIns.some(function(b:any){
      return b.property_id===propId && b.status==="active" && (!b.end_date || daysLeft(b.end_date)>=0);
    });
  }
  const propertiesMissingBuilding = properties.filter(function(p:any){
    if (filterPropIds.length>0 && !filterPropIds.includes(p.id)) return false;
    if (!usedPropertyIds.has(p.id)) return false;
    return !propHasActiveBuildingIns(p.id);
  });

  // Active base contracts with no active in-date tenant insurance certificate.
  function contractHasActiveTenantIns(contractId: string): boolean {
    return tenantIns.some(function(t:any){
      return t.contract_id===contractId && t.status==="active" && (!t.end_date || daysLeft(t.end_date)>=0);
    });
  }
  const baseActiveContracts = contracts.filter(function(c:any){
    if (filterPropIds.length>0 && !filterPropIds.includes(c.property_id)) return false;
    if (c.is_amendment===true) return false;
    if (c.parent_contract_id) return false;
    return true;
  });
  const contractsMissingTenantIns = baseActiveContracts.filter(function(c:any){
    if (c.no_tenant_insurance_required) return false;
    return !contractHasActiveTenantIns(c.id);
  });
  const contractsExemptTenantIns = baseActiveContracts.filter(function(c:any){
    return c.no_tenant_insurance_required && !contractHasActiveTenantIns(c.id);
  });

  // Sum of active building premium (feeds tenant insurance billing on /billing).
  const totalBuildingPremium = (activeTab==="building" ? active : [])
    .reduce(function(s:number,b:any){ return s + Number(b.annual_premium || b.total_premium || 0); }, 0);

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ביטוחים</h1>
          <p className="text-sm text-slate-500 mt-1">
            {active.length} פעילים
            {expiring.length>0 && <span className="text-yellow-600 font-semibold"> | {expiring.length} פגות ב-60י</span>}
            {expired.length>0 && <span className="text-red-600 font-semibold"> | {expired.length} פגו</span>}
            {activeTab==="building" && totalBuildingPremium>0 && <span className="text-slate-500"> | סה&quot;כ פרמיה {fmtMoney(totalBuildingPremium)}</span>}
          </p>
        </div>
        <button onClick={function(){openNew();}} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800"
          title={activeTab==="building"?"הוסף פוליסת ביטוח מבנה לנכס":"הוסף אישור/פוליסת ביטוח שוכר"}>
          + ביטוח חדש
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {[{v:"building",l:"🏢 ביטוח מבנה"},{v:"tenant",l:"👤 ביטוח שוכר (יחידות)"}].map(function(t) {
          return (
            <button key={t.v} onClick={function(){setActiveTab(t.v as any); setFilterSt("all");}}
              className={"px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px " +
                (activeTab===t.v?"border-blue-600 text-blue-700":"border-transparent text-slate-500 hover:text-slate-700")}>
              {t.l}
              <span className="mr-2 text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5">
                {t.v==="building" ? buildingIns.length : tenantIns.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-4">
        <PropertyHierarchyFilter onChange={function(f) { setFilterPropIds(f.propertyIds); }} />
      </div>

      {/* Coverage alert: building */}
      {activeTab==="building" && propertiesMissingBuilding.length>0 && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 mb-4">
          <div className="font-bold text-rose-800 text-sm">⚠ נכסים בשימוש ללא ביטוח מבנה בתוקף — {propertiesMissingBuilding.length}</div>
          <div className="text-xs text-rose-600 mt-0.5">נכסים עם חוזים פעילים שאין להם פוליסת ביטוח מבנה במצב &quot;פעיל&quot; בתוקף. ביטוח המבנה הוא מקור הסכום לחיוב הדיירים.</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            {propertiesMissingBuilding.map(function(p:any){
              return (
                <div key={p.id} className="rounded-lg bg-white border border-rose-200 p-2.5 text-xs">
                  <div className="font-semibold text-slate-800">{p.name}</div>
                  <button onClick={function(){openNew(p.id);}} title="הוסף פוליסת ביטוח מבנה לנכס זה"
                    className="mt-1.5 text-[11px] rounded bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 font-semibold">+ הוסף ביטוח מבנה</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Coverage alert: tenant */}
      {activeTab==="tenant" && contractsMissingTenantIns.length>0 && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 mb-4">
          <div className="font-bold text-rose-800 text-sm">⚠ שוכרים ללא אישור ביטוח בתוקף — {contractsMissingTenantIns.length}</div>
          <div className="text-xs text-rose-600 mt-0.5">חוזים פעילים שלא הומצא לנו עבורם אישור קיום ביטוחים בתוקף. על כל שוכר להמציא אישור ביטוח על המושכר שלו.</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {contractsMissingTenantIns.slice(0,15).map(function(c:any){
              return (
                <div key={c.id} className="rounded-lg bg-white border border-rose-200 p-2.5 text-xs">
                  <div className="font-semibold text-slate-800">{(c.tenants as any)?.name}</div>
                  <div className="text-slate-500">{(c.properties as any)?.name}</div>
                  <div className="text-[10px] text-indigo-700 mt-0.5">יח&apos;: {spacesLabel(c)}</div>
                  <div className="text-[10px] text-slate-400">{contractRange(c)}</div>
                  <div className="mt-1.5 flex gap-1 flex-wrap">
                    <button onClick={function(){openNew(c.id);}} title="הוסף אישור ביטוח עבור שוכר זה"
                      className="text-[11px] rounded bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 font-semibold">+ הוסף אישור</button>
                    <button onClick={function(){markNoTenantInsurance(c.id,(c.tenants as any)?.name||"");}}
                      title="סמן שההסכם אינו דורש אישור ביטוח שוכר — יוצא מההתראה"
                      className="text-[11px] rounded border border-slate-300 text-slate-600 hover:bg-slate-50 px-2 py-1">לא נדרש</button>
                  </div>
                </div>
              );
            })}
          </div>
          {contractsMissingTenantIns.length>15 && <div className="text-[11px] text-rose-600 mt-2">ועוד {contractsMissingTenantIns.length-15} שוכרים...</div>}
        </div>
      )}

      {/* Exempt tenants info */}
      {activeTab==="tenant" && contractsExemptTenantIns.length>0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4">
          <div className="font-bold text-slate-700 text-sm">ℹ️ הסכמים שסומנו &quot;לא נדרש אישור ביטוח&quot; — {contractsExemptTenantIns.length}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {contractsExemptTenantIns.map(function(c:any){
              return (
                <span key={c.id} className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 flex items-center gap-2">
                  <span className="font-semibold text-slate-700">{(c.tenants as any)?.name}</span>
                  <span className="text-slate-400">{(c.properties as any)?.name}</span>
                  <button onClick={function(){unmarkNoTenantInsurance(c.id);}} title="בטל סימון" className="text-slate-400 hover:text-rose-600 underline">בטל</button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* KPI — clickable filters */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          {f:"all",     label:"הכל",        value:propFiltered.length, color:"text-slate-600", bg:"bg-white"},
          {f:"active",  label:"פעילים",     value:active.length,       color:"text-green-700", bg:"bg-white"},
          {f:"expiring",label:"פגות בקרוב", value:expiring.length,     color:expiring.length>0?"text-yellow-700":"text-slate-400", bg:expiring.length>0?"bg-yellow-50":"bg-white"},
          {f:"expired", label:"פגו",        value:expired.length,      color:expired.length>0?"text-red-700":"text-slate-400", bg:expired.length>0?"bg-red-50":"bg-white"},
        ].map(function(k) {
          return (
            <button key={k.label} onClick={function(){setFilterSt(k.f as any);}}
              className={"rounded-xl border p-3 text-center transition-all " + k.bg + (filterSt===k.f?" border-blue-500 ring-2 ring-blue-300":" border-slate-200")}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🛡️</div><div>אין ביטוחים התואמים את הסינון</div>
          <button onClick={function(){openNew();}} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף ביטוח</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">{activeTab==="building"?"נכס":"שוכר / יחידות"}</th>
                <th className="px-4 py-3 font-semibold text-slate-700">מבטח</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פוליסה</th>
                {activeTab==="tenant" && <th className="px-4 py-3 font-semibold text-slate-700">כיסויים</th>}
                <th className="px-4 py-3 font-semibold text-slate-700">{activeTab==="building"?"סכום כיסוי":"גבול אחריות"}</th>
                {activeTab==="building" && <th className="px-4 py-3 font-semibold text-slate-700">פרמיה</th>}
                <th className="px-4 py-3 font-semibold text-slate-700">פקיעה</th>
                <th className="px-4 py-3 font-semibold text-slate-700">סטטוס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(function(ins) {
                const d = ins.end_date ? daysLeft(ins.end_date) : null;
                const h = healthOf(ins);
                const rowBg = h==="expired" ? "bg-red-50 border-r-4 border-red-500"
                  : h==="expiring30" ? "bg-orange-50 border-r-4 border-orange-400"
                  : h==="expiring60" ? "bg-yellow-50/40"
                  : h==="inactive" ? "opacity-60" : "hover:bg-slate-50";
                const name = activeTab==="building" ? ins.properties?.name : ins.contracts?.tenants?.name;
                const sub  = activeTab==="tenant"   ? ins.contracts?.properties?.name : null;
                const docUrl = ins.document_url || ins.certificate_url;
                const docs = Array.isArray(ins.documents) ? ins.documents : [];
                return (
                  <tr key={ins.id} className={"border-t border-slate-100 " + rowBg}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 text-sm">{name}</div>
                      {sub && <div className="text-xs text-slate-500">{sub}</div>}
                      {activeTab==="tenant" && <div className="text-[10px] text-indigo-700 mt-0.5">יח&apos;: {spacesLabel(ins.contracts)}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-700 text-sm">{insurerOf(ins)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-500">{ins.policy_number||"—"}</td>
                    {activeTab==="tenant" && (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(Array.isArray(ins.coverage_types)?ins.coverage_types:[]).map(function(ct:string){
                            var info = coverageInfo(ct);
                            return <span key={ct} title={info.desc} className="text-[10px] bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5">{info.icon} {info.l}</span>;
                          })}
                          {(!ins.coverage_types || ins.coverage_types.length===0) && <span className="text-[10px] text-slate-300">—</span>}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-3">{fmtMoney(ins.coverage_amount)}</td>
                    {activeTab==="building" && <td className="px-4 py-3 text-slate-700">{fmtMoney(ins.annual_premium || ins.total_premium)}</td>}
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-slate-700">{fmtDate(ins.end_date)}</div>
                      {d!==null && ins.status==="active" && (
                        d<0 ? <div className="text-red-600 font-bold text-xs">פג לפני {Math.abs(d)} ימים</div>
                        : d<=60 ? <div className={"text-xs font-bold " + (d<=30?"text-orange-600":"text-yellow-600")}>נותרו {d} ימים</div>
                        : null
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (h==="expired"?"bg-red-100 text-red-700":ins.status==="active"?"bg-green-100 text-green-700":"bg-slate-100 text-slate-600")}>
                        {h==="expired"?"פג":ins.status==="active"?"פעיל":"לא פעיל"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={function(){openEdit(ins);}} title="ערוך פרטי ביטוח" className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">✏️ ערוך</button>
                        {docs.length>0
                          ? docs.map(function(dc:any,i:number){ return <a key={i} href={dc.url} target="_blank" rel="noopener noreferrer" title={"פתח "+docTypeLabel(dc.type)} className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50">{docTypeLabel(dc.type)}</a>; })
                          : docUrl && <a href={docUrl} target="_blank" rel="noopener noreferrer" title={activeTab==="building"?"פתח פוליסה":"פתח אישור ביטוח"} className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50">📄</a>}
                        <button onClick={function(){handleDelete(ins.id);}} title="מחק ביטוח" className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">
                {isNew ? (activeTab==="building"?"ביטוח מבנה חדש":"אישור ביטוח שוכר חדש") : "עריכת ביטוח"}
              </h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">{activeTab==="building"?"נכס *":"חוזה / שוכר *"}</label>
                <select value={fRefId} onChange={function(e){setFRefId(e.target.value);}} className={ic}>
                  <option value="">-- בחר --</option>
                  {activeTab==="building"
                    ? properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})
                    : contracts.map(function(c){return <option key={c.id} value={c.id}>{(c.tenants as any)?.name} — {(c.properties as any)?.name} | יח&apos;: {spacesLabel(c)}{contractRange(c)?" | "+contractRange(c):""}</option>;})
                  }
                </select>
              </div>

              {activeTab==="tenant" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כיסויים כלולים באישור</label>
                  <div className="grid grid-cols-2 gap-2">
                    {COVERAGE_TYPES.map(function(t){
                      var on = fCovTypes.includes(t.v);
                      return (
                        <button key={t.v} type="button" title={t.desc}
                          onClick={function(){ setFCovTypes(on?fCovTypes.filter(function(x){return x!==t.v;}):fCovTypes.concat([t.v])); }}
                          className={"rounded-lg border p-2 text-right text-xs " + (on?"border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold":"border-slate-200 text-slate-600")}>
                          {t.icon} {t.l}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">חברת ביטוח</label><input type="text" value={fInsurer} onChange={function(e){setFInsurer(e.target.value);}} className={ic} /></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">מספר פוליסה</label><input type="text" value={fPolicyNum} onChange={function(e){setFPolicyNum(e.target.value);}} className={ic} dir="ltr" /></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">{activeTab==="building"?"סכום כיסוי (₪)":"גבול אחריות (₪)"}</label><input type="number" value={fCoverage} onChange={function(e){setFCoverage(e.target.value);}} className={ic} /></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">פרמיה שנתית (₪)</label><input type="number" value={fPremium} onChange={function(e){setFPremium(e.target.value);}} className={ic} /></div>
                {activeTab==="building" && (
                  <div><label className="mb-1 block text-xs font-semibold text-slate-700">השתתפות עצמית (₪)</label><input type="number" value={fDeductible} onChange={function(e){setFDeductible(e.target.value);}} className={ic} /></div>
                )}
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">תחילה</label><input type="date" value={fStartDate} onChange={function(e){setFStartDate(e.target.value);}} className={ic} /></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">פקיעה</label><input type="date" value={fEndDate} onChange={function(e){setFEndDate(e.target.value);}} className={ic} /></div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}>
                  <option value="active">פעיל</option>
                  <option value="expired">פג</option>
                  <option value="inactive">לא פעיל</option>
                </select>
              </div>

              {/* Cloud document upload */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                <label className="block text-xs font-semibold text-slate-700">📄 {activeTab==="building"?"פוליסת ביטוח":"אישור קיום ביטוחים"} (עליה לענן או קישור)</label>
                <div className="flex gap-2 items-center flex-wrap">
                  <input ref={fileRef} type="file" onChange={handleFileChange}
                    className="text-xs file:rounded file:border-0 file:bg-blue-600 file:text-white file:px-3 file:py-1.5 file:font-semibold file:cursor-pointer file:ml-2"/>
                  {uploading && <span className="text-xs text-blue-600">מעלה...</span>}
                </div>
                <input type="text" value={fDocUrl} onChange={function(e){setFDocUrl(e.target.value);}} placeholder="או הדבק קישור (Drive / Dropbox / כל URL)" className={ic} dir="ltr"/>
                {fDocUrl && (
                  <div className="text-[11px] text-emerald-700 flex items-center gap-2">
                    ✓ מסמך מצורף — <a href={fDocUrl} target="_blank" rel="noopener noreferrer" className="underline">פתח</a>
                    <button type="button" onClick={function(){setFDocUrl("");}} className="text-rose-600 underline">הסר</button>
                  </div>
                )}
              </div>

              <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} /></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"שומר...":"שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
