"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { authHeaders } from '@/lib/api-auth-client';
import { logAudit } from '@/lib/audit-log';
import PropertyHierarchyFilter from '@/components/PropertyHierarchyFilter';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';
import { loadCompanyInfo, letterContent, priorSentOfKind, reminderIntro, reminderTitle } from '@/lib/letter-format';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
// Policies rarely run Jan–Dec (1.8.26–31.7.27). Every label is derived from the
// policy's own dates so "שנת 2026" can't stand for a period it doesn't match.
function policyPeriod(ins: any): string {
  if (!ins?.start_date || !ins?.end_date) return "—";
  var y1 = new Date(ins.start_date).getFullYear(), y2 = new Date(ins.end_date).getFullYear();
  return y1 === y2 ? String(y1) : y1 + "–" + y2;
}
function policyDates(ins: any): string {
  if (!ins?.start_date || !ins?.end_date) return "—";
  return fmtDate(ins.start_date) + " – " + fmtDate(ins.end_date);
}
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

// Default requirement template per the standard appendix: third-party
// ₪10M, employers' liability ₪20M, contents + consequential required
// (no specific minimum). The manager can edit per contract.
const DEFAULT_REQUIREMENTS: Record<string, number> = {
  contents: 0,
  third_party: 10000000,
  employers: 20000000,
  consequential: 0,
};
function fmtLimit(n: number) { return n ? "₪" + Number(n).toLocaleString("he-IL") : "—"; }

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
  const router = useRouter();
  const [buildingIns, setBuildingIns] = useState<any[]>([]);
  const [tenantIns,   setTenantIns]   = useState<any[]>([]);
  const [properties,  setProperties]  = useState<any[]>([]);
  const [contracts,   setContracts]   = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState<"building"|"tenant">("building");
  // מיקוד לחוזה בקישור עמוק — עובר אוטומטית לטאב ביטוחי שוכר
  const [focusContract, setFocusContract] = useState("");
  useEffect(function() {
    try { var fc = new URLSearchParams(window.location.search).get("contract"); if (fc) { setFocusContract(fc); setActiveTab("tenant"); setFilterSt("all"); } } catch (e) { /* noop */ }
  }, []);
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
  const [fCovLimits,  setFCovLimits]  = useState<Record<string,string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]     = useState(false);
  const [docExtracting, setDocExtracting] = useState(false);
  const [docExtractMsg, setDocExtractMsg] = useState("");

  // Requirements editor state (per-contract)
  const [reqEditContract, setReqEditContract] = useState<any>(null);
  const [reqMap, setReqMap] = useState<Record<string,string>>({});
  const [reqDocUrl, setReqDocUrl] = useState("");
  const [reqExtracting, setReqExtracting] = useState(false);
  const [reqExtractMsg, setReqExtractMsg] = useState("");
  const [insCharges, setInsCharges] = useState<any[]>([]);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: b }, { data: t }, { data: p }, { data: c }, { data: ch }] = await Promise.all([
      supabase.from("insurances_building").select("*, properties(name)").order("end_date"),
      supabase.from("insurances_tenant").select("*, contracts(id, property_id, is_amendment, parent_contract_id, no_tenant_insurance_required, insurance_requirements, tenants(name), properties(name), contract_spaces(spaces(space_name)))").order("end_date"),
      supabase.from("properties").select("id,name").order("name"),
      supabase.from("contracts")
        .select("id, tenant_id, property_id, start_date, end_date, status, is_amendment, parent_contract_id, amendment_date, amendment_number, no_tenant_insurance_required, insurance_requirements, tenants(name), properties(name), contract_spaces(spaces(space_name))")
        .in("status",["active","expiring","extended","upcoming"])
        .order("start_date", { ascending: false }),
      // Existing insurance charges — to flag policies whose charge was already created.
      supabase.from("charges").select("id, billing_period_start, contracts!charges_contract_id_fkey(property_id)").eq("charge_type", "insurance"),
    ]);
    var scope = await getScopeIds();
    setBuildingIns(scopeRows(b ?? [], scope, function(x: any){ return x.property_id; }));
    setTenantIns(scopeRows(t ?? [], scope, function(x: any){ return x.contracts?.property_id; }));
    setProperties(scopeRows(p ?? [], scope, function(x: any){ return x.id; }));
    setContracts(scopeRows(c ?? [], scope, function(x: any){ return x.property_id; }));
    setInsCharges(scopeRows(ch ?? [], scope, function(x: any){ return x.contracts?.property_id; }));
    setLoading(false);
  }

  // How many insurance charges already exist for a property in a given year.
  function insChargeCountFor(propId: string, years: number[]): number {
    return insCharges.filter(function(x:any){
      if (x.contracts?.property_id !== propId) return false;
      var y = x.billing_period_start ? new Date(x.billing_period_start).getFullYear() : 0;
      return years.includes(y);
    }).length;
  }
  function policyYears(b: any): number[] {
    var ys: number[] = [];
    if (b.start_date) ys.push(new Date(b.start_date).getFullYear());
    if (b.end_date) { var ey = new Date(b.end_date).getFullYear(); if (!ys.includes(ey)) ys.push(ey); }
    return ys.length ? ys : [new Date().getFullYear()];
  }

  // המצב האפקטיבי של משפחת החוזה (הצילום האחרון עם יחידות) — תעודת ביטוח
  // מציגה את היחידות שבפועל היום, גם אחרי החלפת יחידות בתוספת.
  var famEff: Record<string, any[] | null> = {};
  (function() {
    var groups: Record<string, any[]> = {};
    contracts.forEach(function(c: any) { var fid = c.parent_contract_id || c.id; (groups[fid] = groups[fid] || []).push(c); });
    Object.keys(groups).forEach(function(fid) {
      var snaps = groups[fid].slice().sort(function(a: any, b: any) {
        var ra = (a.is_amendment ? new Date(a.amendment_date || a.start_date).getTime() || 0 : 0) * 1000 + (Number(a.amendment_number) || 0);
        var rb = (b.is_amendment ? new Date(b.amendment_date || b.start_date).getTime() || 0 : 0) * 1000 + (Number(b.amendment_number) || 0);
        return ra - rb;
      });
      var spaces: any[] | null = null;
      snaps.forEach(function(s: any) { if ((s.contract_spaces || []).length > 0) spaces = s.contract_spaces; });
      famEff[fid] = spaces;
    });
  })();
  function spacesLabel(contract: any): string {
    var fid = contract?.parent_contract_id || contract?.id;
    var eff = fid ? famEff[fid] : null;
    var arr = eff || contract?.contract_spaces || [];
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

  // Read coverage types + limits from the attached certificate/policy document.
  async function readDocIntoForm() {
    if (!fDocUrl) { setDocExtractMsg("הזן/העלה קישור למסמך תחילה."); return; }
    setDocExtracting(true); setDocExtractMsg("קורא את המסמך ומנתח...");
    try {
      const res = await fetch("/api/extract-from-url", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ fileUrl: fDocUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "שגיאה בקריאת המסמך");
      var filled = 0;
      // Insurer / policy number / dates if found and empty.
      if (data.insurer && !fInsurer) { setFInsurer(data.insurer); filled++; }
      if (activeTab==="tenant") {
        var ir = (data.insurance_requirements && typeof data.insurance_requirements==="object") ? data.insurance_requirements : {};
        var keys = Object.keys(ir);
        if (keys.length > 0) {
          var lim: Record<string,string> = {};
          keys.forEach(function(k){ lim[k] = Number(ir[k])>0 ? String(Number(ir[k])) : ""; });
          setFCovTypes(keys); setFCovLimits(lim); filled += keys.length;
        }
      } else {
        // building: take third_party / coverage amount if present
        var ir2 = (data.insurance_requirements && typeof data.insurance_requirements==="object") ? data.insurance_requirements : {};
        if (ir2.third_party && !fCoverage) { setFCoverage(String(Number(ir2.third_party))); filled++; }
      }
      setDocExtractMsg(filled>0 ? ("✓ נקראו " + filled + " שדות מהמסמך — בדוק ואשר.") : "⚠ לא זוהו נתוני כיסוי במסמך. ניתן למלא ידנית.");
    } catch (e:any) {
      setDocExtractMsg("שגיאה: " + (e?.message || e));
    } finally { setDocExtracting(false); }
  }

  function openNew(prefillRefId?: string) {
    setIsNew(true); setEditingId("new"); setRenewFrom(null);
    setFRefId(prefillRefId || ""); setFInsurer(""); setFPolicyNum(""); setFCoverage("");
    setFPremium(""); setFDeductible(""); setFStartDate(""); setFEndDate("");
    setFStatus("active"); setFNotes(""); setFDocUrl(""); setFCovTypes([]); setFCovLimits({});
    setDocExtractMsg("");
    if (fileRef.current) fileRef.current.value = "";
  }

  // Renewing must not overwrite the policy that just ended — the premium
  // history is the point. This opens a NEW policy pre-filled from the old one,
  // with the period rolled forward a year; on save the old row is marked
  // expired and linked as the predecessor.
  const [renewFrom, setRenewFrom] = useState<any>(null);
  // Premium tracking across the years — the reason renewals must not overwrite.
  const [historyOf, setHistoryOf] = useState<any>(null);
  function openRenew(ins: any) {
    var addYear = function (d: string, days: number) {
      if (!d) return "";
      var x = new Date(d); x.setFullYear(x.getFullYear() + 1); x.setDate(x.getDate() + days);
      return x.toISOString().slice(0, 10);
    };
    setIsNew(true); setEditingId("new");
    setRenewFrom(ins);
    setFRefId(ins.property_id ?? ins.contract_id ?? "");
    setFInsurer(insurerOf(ins) === "—" ? "" : insurerOf(ins));
    setFPolicyNum("");                       // a renewal gets a new policy number
    setFCoverage(ins.coverage_amount?.toString() ?? "");
    setFPremium("");                         // and its own premium — the figure being tracked
    setFDeductible(ins.deductible?.toString() ?? "");
    // The new cover starts the day after the old one ends, keeping the same
    // anniversary (1.8–31.7 stays 1.8–31.7).
    setFStartDate(ins.end_date ? new Date(new Date(ins.end_date).getTime() + 86400000).toISOString().slice(0, 10) : "");
    setFEndDate(ins.end_date ? addYear(ins.end_date, 0) : "");
    setFStatus("active"); setFNotes(""); setFDocUrl("");
    var limits = (ins.coverage_limits && typeof ins.coverage_limits === "object") ? ins.coverage_limits : {};
    var types = Array.isArray(ins.coverage_types) ? ins.coverage_types.slice() : [];
    Object.keys(limits).forEach(function (k) { if (!types.includes(k)) types.push(k); });
    var limStr: Record<string, string> = {};
    Object.keys(limits).forEach(function (k) { limStr[k] = limits[k] ? String(limits[k]) : ""; });
    setFCovTypes(types); setFCovLimits(limStr);
    setDocExtractMsg("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function openEdit(ins: any) {
    setRenewFrom(null);
    setIsNew(false); setEditingId(ins.id);
    setFRefId(ins.property_id ?? ins.contract_id ?? "");
    setFInsurer(insurerOf(ins)==="—"?"":insurerOf(ins)); setFPolicyNum(ins.policy_number??"");
    setFCoverage(ins.coverage_amount?.toString()??""); setFPremium((ins.annual_premium ?? ins.total_premium)?.toString()??"");
    setFDeductible(ins.deductible?.toString()??"");
    setFStartDate(ins.start_date?.split("T")[0]??""); setFEndDate(ins.end_date?.split("T")[0]??"");
    setFStatus(ins.status??"active"); setFNotes(ins.notes??"");
    setFDocUrl(ins.document_url || ins.certificate_url || "");
    setDocExtractMsg("");
    var limits = (ins.coverage_limits && typeof ins.coverage_limits==="object") ? ins.coverage_limits : {};
    var types = Array.isArray(ins.coverage_types) ? ins.coverage_types.slice() : [];
    Object.keys(limits).forEach(function(k){ if (!types.includes(k)) types.push(k); });
    var limStr: Record<string,string> = {};
    Object.keys(limits).forEach(function(k){ limStr[k] = limits[k] ? String(limits[k]) : ""; });
    setFCovTypes(types); setFCovLimits(limStr);
    if (fileRef.current) fileRef.current.value = "";
  }

  function toggleCovType(v: string) {
    if (fCovTypes.includes(v)) {
      setFCovTypes(fCovTypes.filter(function(x){return x!==v;}));
      var nl = Object.assign({}, fCovLimits); delete nl[v]; setFCovLimits(nl);
    } else {
      setFCovTypes(fCovTypes.concat([v]));
    }
  }

  // After a building policy with a premium is saved, offer to bill the tenants
  // for their share right away. The same handoff is available later from the
  // row's "צור חיוב" button, so declining here loses nothing.
  const [billPrompt, setBillPrompt] = useState<any>(null);

  function billingLink(propertyId: string, year: number) {
    return "/billing?tab=insurance&property=" + encodeURIComponent(propertyId) + "&year=" + year;
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
      else {
        // insurances_tenant.tenant_id is NOT NULL — derive it from the contract.
        var selContract = contracts.find(function(c:any){ return c.id===fRefId; });
        var tId = selContract?.tenant_id || existing?.tenant_id || null;
        if (!tId) { throw new Error("לא נמצא שוכר משויך לחוזה הנבחר"); }
        payload.tenant_id = tId;
        // insurance_type is a NOT-NULL legacy column; certificates now carry
        // multiple coverages in coverage_types — store the primary one here.
        payload.insurance_type = fCovTypes[0] || existing?.insurance_type || "general";
        payload.coverage_types = fCovTypes;
        var limMap: Record<string,number> = {};
        fCovTypes.forEach(function(t){ var v = Number(fCovLimits[t]||0); if (v>0) limMap[t] = v; });
        payload.coverage_limits = limMap;
      }

      if (isNew) {
        if (renewFrom?.id) payload.previous_policy_id = renewFrom.id;
        const { data, error: ie } = await supabase.from(table).insert(payload).select().single();
        if (ie) throw new Error(ie.message);
        if (!data?.id) throw new Error("שגיאה בשמירה");
        // The predecessor stays as the record of its own period — only its
        // status changes, so the premium history survives the renewal.
        if (renewFrom?.id) {
          await supabase.from(table).update({ status: "expired" }).eq("id", renewFrom.id);
        }
        await logAudit({ entity_type:"insurance", entity_id:data.id, action: renewFrom?.id ? "renew" : "create" });
      } else {
        await supabase.from(table).update(payload).eq("id", editingId);
        await logAudit({ entity_type:"insurance", entity_id:editingId, action:"update" });
      }
      // Ask about billing the tenants only where there is something to split:
      // a building policy carrying a premium.
      var premiumNum = fPremium ? Number(fPremium) : 0;
      var wasNew = isNew;
      var savedPropId = fRefId;
      var savedYear = fStartDate ? new Date(fStartDate).getFullYear() : new Date().getFullYear();
      setEditingId(""); await loadAll();
      if (activeTab === "building" && premiumNum > 0) {
        var propName = (properties.find(function(pr:any){ return pr.id === savedPropId; }) || {}).name || "";
        setBillPrompt({ propertyId: savedPropId, propertyName: propName, premium: premiumNum, year: savedYear, isNew: wasNew });
      }
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

  // ─── Requirements editor ──────────────────────────────────────────
  async function openReqEditor(contract: any) {
    var req = (contract?.insurance_requirements && typeof contract.insurance_requirements==="object") ? contract.insurance_requirements : {};
    var m: Record<string,string> = {};
    Object.keys(req).forEach(function(k){ m[k] = (req[k] && Number(req[k])>0) ? String(req[k]) : ""; });
    setReqMap(m);
    setReqExtractMsg(""); setReqDocUrl("");
    setReqEditContract(contract);
    // Try to prefill the document URL from the contract's stored documents.
    try {
      const { data: docs } = await supabase.from("documents")
        .select("doc_type, file_url, external_url")
        .eq("contract_id", contract.id)
        .order("created_at", { ascending: false });
      if (docs && docs.length) {
        // Prefer an insurance doc, else a contract doc, else the first.
        var pick = docs.find(function(d:any){ return d.doc_type==="insurance"; })
          || docs.find(function(d:any){ return d.doc_type==="contract"; })
          || docs[0];
        var u = pick.external_url || pick.file_url || "";
        if (u && !/^https?:\/\//.test(u)) {
          // Looks like a storage path → build a public URL from the documents bucket.
          u = supabase.storage.from("documents").getPublicUrl(u).data.publicUrl;
        }
        setReqDocUrl(u);
      }
    } catch (_e) { /* non-fatal */ }
  }

  async function readRequirementsFromDoc() {
    if (!reqDocUrl) { setReqExtractMsg("הזן קישור למסמך ההסכם (PDF/DOCX) — בענן או משותף ציבורית."); return; }
    setReqExtracting(true); setReqExtractMsg("קורא את המסמך ומנתח...");
    try {
      const res = await fetch("/api/extract-from-url", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ fileUrl: reqDocUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "שגיאה בקריאת המסמך");
      var ir = (data && data.insurance_requirements && typeof data.insurance_requirements==="object") ? data.insurance_requirements : {};
      var keys = Object.keys(ir);
      if (keys.length === 0) { setReqExtractMsg("⚠ לא זוהו דרישות ביטוח במסמך. ניתן להגדיר ידנית."); return; }
      var m: Record<string,string> = {};
      keys.forEach(function(k){ m[k] = (Number(ir[k])>0) ? String(Number(ir[k])) : ""; });
      setReqMap(m);
      setReqExtractMsg("✓ נקראו " + keys.length + " דרישות מהמסמך — בדוק ואשר לפני שמירה.");
    } catch (e:any) {
      setReqExtractMsg("שגיאה: " + (e?.message || e));
    } finally { setReqExtracting(false); }
  }
  function toggleReq(v: string) {
    if (Object.prototype.hasOwnProperty.call(reqMap, v)) {
      var nm = Object.assign({}, reqMap); delete nm[v]; setReqMap(nm);
    } else {
      setReqMap(Object.assign({}, reqMap, { [v]: "" }));
    }
  }
  function loadDefaultReqs() {
    var m: Record<string,string> = {};
    Object.keys(DEFAULT_REQUIREMENTS).forEach(function(k){ var v = DEFAULT_REQUIREMENTS[k]; m[k] = v>0 ? String(v) : ""; });
    setReqMap(m);
  }
  async function saveRequirements() {
    if (!reqEditContract) return;
    var out: Record<string,number> = {};
    Object.keys(reqMap).forEach(function(k){ out[k] = Number(reqMap[k]||0); });
    await supabase.from("contracts").update({ insurance_requirements: out }).eq("id", reqEditContract.id);
    await logAudit({ entity_type:"contract", entity_id:reqEditContract.id, action:"set_insurance_requirements" });
    setReqEditContract(null);
    await loadAll();
  }

  // ─── Compliance engine ────────────────────────────────────────────
  // Compares a contract's active tenant certificate(s) against its
  // insurance_requirements (required coverage codes + minimum limits).
  function activeCertsForContract(contractId: string): any[] {
    return tenantIns.filter(function(t:any){
      return t.contract_id===contractId && t.status==="active" && (!t.end_date || daysLeft(t.end_date)>=0);
    });
  }
  // returns { state: 'no_req' | 'no_cert' | 'compliant' | 'deficient', issues: string[] }
  function complianceFor(contract: any) {
    var req = (contract?.insurance_requirements && typeof contract.insurance_requirements==="object") ? contract.insurance_requirements : {};
    var reqTypes = Object.keys(req);
    if (reqTypes.length === 0) return { state:"no_req", issues:[] as string[] };
    var certs = activeCertsForContract(contract.id);
    if (certs.length === 0) return { state:"no_cert", issues:["לא הומצא אישור ביטוח בתוקף"] };
    // Merge covered limits across all active certs (take the max per type).
    var covered: Record<string,number> = {};
    certs.forEach(function(c:any){
      var lims = (c.coverage_limits && typeof c.coverage_limits==="object") ? c.coverage_limits : {};
      (Array.isArray(c.coverage_types)?c.coverage_types:[]).forEach(function(t:string){ if (!(t in covered)) covered[t]=0; });
      Object.keys(lims).forEach(function(t:string){ covered[t] = Math.max(covered[t]||0, Number(lims[t]||0)); });
    });
    var issues: string[] = [];
    reqTypes.forEach(function(t){
      var info = coverageInfo(t);
      var minLimit = Number(req[t]||0);
      if (!(t in covered)) { issues.push("חסר כיסוי: " + info.l); return; }
      if (minLimit>0 && (covered[t]||0) < minLimit) {
        issues.push(info.l + ": גבול " + fmtLimit(covered[t]||0) + " < נדרש " + fmtLimit(minLimit));
      }
    });
    return { state: issues.length ? "deficient" : "compliant", issues: issues };
  }

  // ─── Insurance demand letter ──────────────────────────────────────
  async function sendInsuranceDemand(contract: any, issues: string[]) {
    try {
      var tName = (contract?.tenants as any)?.name || "";
      var propName = (contract?.properties as any)?.name || "";
      var ci = await loadCompanyInfo(contract.property_id);
      var prior = await priorSentOfKind(contract.id, "insurance_demand");
      var body = "לכבוד\n" + tName + ",\n\n" +
        "הנדון: דרישה להמצאת אישור קיום ביטוחים" + (propName ? " — " + propName : "") + "\n\n" +
        reminderIntro(prior) +
        "בהתאם להוראות נספח האחריות והביטוח שבהסכם השכירות שביניכם לבין " + (ci.companyName || "המשכירה") + " (\"המשכירה\"), על השוכר להמציא למשכירה אישור קיום ביטוחים תקף בגין המושכר, בנוסח ובהיקף הקבועים בהסכם.\n\n" +
        (issues && issues.length
          ? "באישור הביטוח שבידינו נמצאו הליקויים הבאים:\n" + issues.map(function(s){return "• " + s;}).join("\n") + "\n\n"
          : "נכון למועד מכתב זה, טרם הומצא לנו אישור קיום ביטוחים בתוקף.\n\n") +
        "נבקשכם להסדיר את הנדרש ולהמציא לנו אישור קיום ביטוחים תקין ובתוקף, הכולל את כל הכיסויים וגבולות האחריות הנדרשים בהסכם, בתוך 14 ימים ממועד מכתב זה.\n\n" +
        // שמירת זכויות — רק אחרי כמה תזכורות; ביחסים שוטפים המכתב רשמי ונקי.
        (prior.count >= 2 ? "מובהר כי אין באמור במכתב זה כדי לגרוע מכל זכות העומדת למשכירה על פי ההסכם ועל פי כל דין.\n\n" : "") +
        "בברכה,\n" + (ci.companyName || "הנהלת הנכס");
      var { data, error } = await supabase.from("letters").insert({
        contract_id: contract.id,
        letter_type: "demand",
        title: reminderTitle(prior, "דרישת אישור ביטוח — " + tName),
        content_json: letterContent(body, ci, { kind: "insurance_demand", issues: issues || [] }),
        status: "draft",
      }).select().single();
      if (error) throw error;
      await logAudit({ entity_type:"letter", entity_id:data.id, action:"insurance_demand" });
      if (confirm("✅ נוצרה טיוטת מכתב דרישת אישור ביטוח" + (prior.count ? " (תזכורת)" : "") + ".\nלעבור למסך המכתבים לשליחה?")) router.push("/letters");
    } catch (e:any) { alert("שגיאה: " + (e?.message || e)); }
  }

  // מכתב דרישת חידוש לפוליסה שעומדת לפוג — טיוטה במסך המכתבים. קיים
  // מכתב לביטוח שכבר אינו בתוקף (sendInsuranceDemand); זה המקביל המקדים.
  async function sendRenewalDemand(ins: any) {
    try {
      var c = ins.contracts || {};
      var tName = (c?.tenants as any)?.name || "";
      var propName = (c?.properties as any)?.name || "";
      var endTxt = ins.end_date ? new Date(ins.end_date).toLocaleDateString("he-IL") : "";
      var ci = await loadCompanyInfo((c as any)?.property_id);
      var prior = await priorSentOfKind(ins.contract_id, "insurance_renewal_demand");
      var body = "לכבוד\n" + tName + ",\n\n" +
        "הנדון: פוליסת הביטוח עומדת לפוג ביום " + endTxt + " — דרישה לחידוש אישור ביטוח" + (propName ? " — " + propName : "") + "\n\n" +
        reminderIntro(prior) +
        "הרינו להביא לידיעתכם כי אישור קיום הביטוחים שבידינו בגין המושכר" +
        (ins.insurer ? " (מבטח: " + ins.insurer + (ins.policy_number ? ", פוליסה מס' " + ins.policy_number : "") + ")" : "") +
        " עומד לפוג ביום " + endTxt + ".\n\n" +
        "בהתאם להוראות נספח האחריות והביטוח שבהסכם השכירות שביניכם לבין " + (ci.companyName || "המשכירה") + " (\"המשכירה\"), נבקשכם להמציא לנו אישור קיום ביטוחים מחודש ובתוקף בטרם מועד הפקיעה, באופן שתישמר רציפות הכיסוי הביטוחי, והכולל את כל הכיסויים וגבולות האחריות הנדרשים בהסכם.\n\n" +
        (prior.count >= 2 ? "מובהר כי אין באמור במכתב זה כדי לגרוע מכל זכות העומדת למשכירה על פי ההסכם ועל פי כל דין.\n\n" : "") +
        "בברכה,\n" + (ci.companyName || "הנהלת הנכס");
      var { data, error } = await supabase.from("letters").insert({
        contract_id: ins.contract_id,
        letter_type: "demand",
        title: reminderTitle(prior, "דרישת חידוש אישור ביטוח — " + tName),
        content_json: letterContent(body, ci, { kind: "insurance_renewal_demand", end_date: ins.end_date || null }),
        status: "draft",
      }).select().single();
      if (error) throw error;
      await logAudit({ entity_type: "letter", entity_id: data.id, action: "insurance_renewal_demand" });
      if (confirm("✅ נוצרה טיוטת מכתב דרישת חידוש ביטוח" + (prior.count ? " (תזכורת)" : "") + ".\nלעבור למסך המכתבים לשליחה?")) router.push("/letters");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
  }

  // פוליסה שפגה אבל כבר חודשה (קיימת פוליסה חדשה בתוקף לאותו נכס / לאותה
  // משפחת חוזה) היא היסטוריה — "עבר" — לא אזעקת "פג". רק כשאין מחליפה
  // בתוקף הפוליסה מוצגת באדום כפי שהיה.
  function successorKeyOf(ins: any, tab: string): string {
    if (tab === "building") return "p|" + (ins.property_id || "");
    return "c|" + ((ins.contracts as any)?.parent_contract_id || ins.contract_id || "");
  }
  function hasSuccessor(ins: any, tab: string): boolean {
    var pool = tab === "building" ? buildingIns : tenantIns;
    var key = successorKeyOf(ins, tab);
    return pool.some(function(other: any) {
      if (other.id === ins.id) return false;
      if (successorKeyOf(other, tab) !== key) return false;
      if (other.status !== "active" || !other.end_date || daysLeft(other.end_date) < 0) return false;
      return !ins.end_date || other.end_date > ins.end_date;
    });
  }
  type DisplayHealth = Health | "superseded";
  function displayHealthOf(ins: any): DisplayHealth {
    var h = healthOf(ins);
    if (h === "expired" && hasSuccessor(ins, activeTab)) return "superseded";
    return h;
  }

  // ─── Filtering + sorting ───────────────────────────────────────────
  const allList = activeTab==="building" ? buildingIns : tenantIns;
  // מיקוד לחוזה בקישור עמוק (ממסך החוזים): /insurances?contract=<id>
  const focusFiltered = !focusContract ? allList : allList.filter(function(ins: any) {
    return ((ins.contracts as any)?.parent_contract_id || ins.contract_id) === focusContract;
  });
  const propFiltered = filterPropIds.length===0 ? focusFiltered : focusFiltered.filter(function(ins) {
    const pid = activeTab==="building" ? ins.property_id : ins.contracts?.property_id;
    return filterPropIds.includes(pid);
  });
  const list = propFiltered.filter(function(ins) {
    var h = displayHealthOf(ins);
    if (filterSt === "all") return true;
    if (filterSt === "active")   return ins.status === "active" && h !== "superseded";
    if (filterSt === "expired")  return h === "expired";
    if (filterSt === "expiring") return h === "expiring30" || h === "expiring60";
    if (filterSt === "superseded") return h === "superseded";
    return true;
  });
  const sorted = list.slice().sort(function(a,b){
    var ordOf = function(x: any){ var dh = displayHealthOf(x); return dh === "superseded" ? 5 : healthOrder(dh as Health); };
    var ha = ordOf(a), hb = ordOf(b);
    if (ha !== hb) return ha - hb;
    var ea = a.end_date ? new Date(a.end_date).getTime() : Infinity;
    var eb = b.end_date ? new Date(b.end_date).getTime() : Infinity;
    return ea - eb;
  });

  const expiring = propFiltered.filter(function(ins) { var h=displayHealthOf(ins); return h==="expiring30"||h==="expiring60"; });
  const expired  = propFiltered.filter(function(ins) { return displayHealthOf(ins)==="expired"; });
  const superseded = propFiltered.filter(function(ins) { return displayHealthOf(ins)==="superseded"; });
  const active   = propFiltered.filter(function(ins) { return ins.status==="active" && displayHealthOf(ins) !== "superseded" && healthOf(ins) !== "expired"; });

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
  // Missing tenant insurance — evaluated per (tenant + property) so a base and
  // its amendments count as ONE group, and a group is covered if ANY contract in
  // it has an active certificate (matches lib/alerts-sync.ts, and is robust to
  // amendments whose parent_contract_id is unset). One row per uncovered group.
  const insGroups: Record<string, any[]> = {};
  contracts.forEach(function(c:any){
    if (filterPropIds.length>0 && !filterPropIds.includes(c.property_id)) return;
    const k = (c.tenant_id||"?") + "|" + (c.property_id||"?");
    (insGroups[k] = insGroups[k] || []).push(c);
  });
  const contractsMissingTenantIns = Object.keys(insGroups).map(function(k){
    const g = insGroups[k];
    return g.find(function(c:any){ return !c.is_amendment; }) || g[0];
  }).filter(function(rep:any){
    if (rep.no_tenant_insurance_required) return false;
    const g = insGroups[(rep.tenant_id||"?") + "|" + (rep.property_id||"?")];
    return !g.some(function(c:any){ return contractHasActiveTenantIns(c.id); });
  });
  const contractsExemptTenantIns = baseActiveContracts.filter(function(c:any){
    return c.no_tenant_insurance_required && !contractHasActiveTenantIns(c.id);
  });

  // Contracts that HAVE an active certificate but it doesn't meet the
  // contract's insurance requirements (missing coverage code or limit too low).
  const deficientContracts = baseActiveContracts
    .filter(function(c:any){ return !c.no_tenant_insurance_required; })
    .map(function(c:any){ return { c: c, comp: complianceFor(c) }; })
    .filter(function(x:any){ return x.comp.state === "deficient"; });

  // Sum of active building premium (feeds tenant insurance billing on /billing).
  const totalBuildingPremium = (activeTab==="building" ? active : [])
    .reduce(function(s:number,b:any){ return s + Number(b.annual_premium || b.total_premium || 0); }, 0);

  return (
    <div dir="rtl">
      {/* Straight after a building policy with a premium is saved: offer to
          bill the tenants for their share. Declining is safe — the same
          handoff sits on every building row ("צור חיוב"). */}
      {billPrompt && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setBillPrompt(null); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={function(e:any){e.stopPropagation();}}>
            <div className="text-lg font-bold text-slate-800 mb-1">💸 להוציא חיובי ביטוח לשוכרים?</div>
            <div className="text-sm text-slate-600 leading-relaxed mb-4">
              נשמרה פוליסת מבנה{billPrompt.propertyName ? " ל" + billPrompt.propertyName : ""} בפרמיה של {fmtMoney(billPrompt.premium)} לשנת {billPrompt.year}.
              <br />
              ניתן לחלק את הפרמיה בין השוכרים (פרו-רייט לפי מ&quot;ר-ימים), ליצור חיובים ומכתבי חיוב — עכשיו או בכל שלב מאוחר יותר.
            </div>
            <div className="flex gap-2 flex-wrap">
              <a href={billingLink(billPrompt.propertyId, billPrompt.year)}
                className="flex-1 text-center rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-700">
                כן — חשב ושלח עכשיו
              </a>
              <button onClick={function(){setBillPrompt(null);}}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                לא — אחר כך
              </button>
            </div>
            <div className="text-[11px] text-slate-400 mt-3 text-center">
              אחר כך: מסך הביטוחים ← שורת הפוליסה ← &quot;💸 צור חיוב&quot;
            </div>
          </div>
        </div>
      )}

      {/* Premium history — the whole point of keeping a renewed policy rather
          than overwriting it. */}
      {historyOf && (function(){
        var keyOf = function(x: any){ return activeTab === "building" ? x.property_id : x.contract_id; };
        var rows = allList.filter(function(x: any){ return keyOf(x) === keyOf(historyOf); })
          .slice().sort(function(a: any,b: any){
            return new Date(b.start_date || 0).getTime() - new Date(a.start_date || 0).getTime();
          });
        var name = activeTab === "building"
          ? (historyOf.properties?.name || "")
          : (historyOf.contracts?.tenants?.name || "");
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setHistoryOf(null); }}>
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[80vh] overflow-auto" onClick={function(e:any){e.stopPropagation();}}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-lg font-bold text-slate-800">📊 היסטוריית פוליסות ופרמיות</div>
                <button onClick={function(){setHistoryOf(null);}} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
              </div>
              <div className="text-sm text-slate-500 mb-3">{name}</div>
              {rows.length === 0 ? (
                <div className="text-sm text-slate-400">אין פוליסות</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">תקופת ביטוח</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">תאריכים מדויקים</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">מבטח / פוליסה</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">פרמיה</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">שינוי</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(function(x: any, i: number){
                      var prem = Number(x.annual_premium ?? x.total_premium) || 0;
                      var prev = rows[i+1] ? (Number(rows[i+1].annual_premium ?? rows[i+1].total_premium) || 0) : 0;
                      var pct = prev > 0 ? ((prem - prev) / prev) * 100 : null;
                      return (
                        <tr key={x.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-semibold text-slate-800">
                            {policyPeriod(x)}
                            {x.status !== "active" && <span className="mr-1 text-[10px] text-slate-400">(הסתיימה)</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-600 text-xs">{policyDates(x)}</td>
                          <td className="px-3 py-2 text-slate-600 text-xs">
                            {insurerOf(x)}{x.policy_number ? " · " + x.policy_number : ""}
                          </td>
                          <td className="px-3 py-2 font-bold text-slate-800">{fmtMoney(prem)}</td>
                          <td className={"px-3 py-2 font-semibold " + (pct == null ? "text-slate-400" : pct > 0 ? "text-red-600" : "text-green-600")}>
                            {pct == null ? "—" : (pct > 0 ? "+" : "") + pct.toFixed(1) + "%"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className="text-[11px] text-slate-400 mt-3">
                כל חידוש נשמר כפוליסה נפרדת. &quot;✏️ ערוך&quot; מתקן פוליסה קיימת; &quot;🔄 חידוש&quot; פותח תקופה חדשה ושומר את הקודמת.
              </div>
            </div>
          </div>
        );
      })()}

      <PageHero title="ביטוחים" icon="🛡️" tone="blue" actionLabel="+ ביטוח חדש" onAction={function(){openNew();}}
        subtitle={<>
          {active.length} פעילים
          {expiring.length>0 && <span className="text-amber-200 font-semibold"> | {expiring.length} פגות ב-60י</span>}
          {expired.length>0 && <span className="text-rose-200 font-semibold"> | {expired.length} פגו</span>}
          {activeTab==="building" && totalBuildingPremium>0 && <span> | סה&quot;כ פרמיה {fmtMoney(totalBuildingPremium)}</span>}
        </>} />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-5 border-b border-slate-200">
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
                    <button onClick={function(){sendInsuranceDemand(c, []);}} title="צור מכתב דרישה/תזכורת לשוכר להמצאת אישור ביטוח"
                      className="text-[11px] rounded border border-rose-300 text-rose-700 hover:bg-rose-100 px-2 py-1 font-semibold">✉ שלח בקשה</button>
                    <button onClick={function(){openReqEditor(c);}} title="הגדר אילו כיסויים וגבולות אחריות נדרשים בהסכם זה"
                      className="text-[11px] rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-1">⚙ דרישות</button>
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

      {/* Deficient certificates: cert exists but doesn't meet requirements */}
      {activeTab==="tenant" && deficientContracts.length>0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 mb-4">
          <div className="font-bold text-amber-800 text-sm">⚠ אישורים שאינם עומדים בדרישות ההסכם — {deficientContracts.length}</div>
          <div className="text-xs text-amber-700 mt-0.5">קיים אישור ביטוח בתוקף, אך הוא חסר כיסוי נדרש או שגבול האחריות נמוך מהנדרש בנספח הביטוח.</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {deficientContracts.map(function(x:any){
              var c = x.c;
              return (
                <div key={c.id} className="rounded-lg bg-white border border-amber-200 p-2.5 text-xs">
                  <div className="font-semibold text-slate-800">{(c.tenants as any)?.name}</div>
                  <div className="text-slate-500">{(c.properties as any)?.name} · יח&apos;: {spacesLabel(c)}</div>
                  <ul className="mt-1 space-y-0.5">
                    {x.comp.issues.map(function(iss:string,i:number){ return <li key={i} className="text-[11px] text-amber-700">• {iss}</li>; })}
                  </ul>
                  <div className="mt-1.5 flex gap-1 flex-wrap">
                    <button onClick={function(){sendInsuranceDemand(c, x.comp.issues);}} title="צור טיוטת מכתב דרישה לתיקון האישור"
                      className="text-[11px] rounded bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 font-semibold">✉ דרוש תיקון</button>
                    <button onClick={function(){openReqEditor(c);}} title="ערוך את דרישות הביטוח להסכם זה"
                      className="text-[11px] rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-1">⚙ דרישות</button>
                  </div>
                </div>
              );
            })}
          </div>
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
      {focusContract && (
        <div className="mb-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold px-3 py-1.5">
            📄 ביטוחי ההסכם של {(propFiltered[0] as any)?.contracts?.tenants?.name || "החוזה שנבחר"}
            <button onClick={function(){ setFocusContract(""); }} className="text-blue-400 hover:text-blue-700 font-bold" title="הצג את כל הביטוחים">✕</button>
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {[
          {f:"all",     label:"הכל",        value:propFiltered.length, color:"text-slate-600", bg:"bg-white"},
          {f:"active",  label:"פעילים",     value:active.length,       color:"text-green-700", bg:"bg-white"},
          {f:"expiring",label:"פגות בקרוב", value:expiring.length,     color:expiring.length>0?"text-yellow-700":"text-slate-400", bg:expiring.length>0?"bg-yellow-50":"bg-white"},
          {f:"expired", label:"פגו",        value:expired.length,      color:expired.length>0?"text-red-700":"text-slate-400", bg:expired.length>0?"bg-red-50":"bg-white"},
          ...(superseded.length>0?[{f:"superseded", label:"ביטוח עבר", value:superseded.length, color:"text-slate-500", bg:"bg-slate-50"}]:[]),
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
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🛡️</div><div>אין ביטוחים התואמים את הסינון</div>
          <button onClick={function(){openNew();}} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף ביטוח</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-right text-sm min-w-[640px]">
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
                const h = displayHealthOf(ins);
                const rowBg = h==="expired" ? "bg-red-50 border-r-4 border-red-500"
                  : h==="expiring30" ? "bg-orange-50 border-r-4 border-orange-400"
                  : h==="expiring60" ? "bg-yellow-50/40"
                  : h==="superseded" ? "opacity-60 hover:opacity-100"
                  : h==="inactive" ? "opacity-60" : "hover:bg-slate-50";
                const name = activeTab==="building" ? ins.properties?.name : ins.contracts?.tenants?.name;
                const sub  = activeTab==="tenant"   ? ins.contracts?.properties?.name : null;
                const docUrl = ins.document_url || ins.certificate_url;
                const docs = Array.isArray(ins.documents) ? ins.documents : [];
                return (
                  <tr key={ins.id} className={"border-t border-slate-100 " + rowBg}>
                    <td className="px-4 py-3">
                      <div className={"font-semibold text-slate-800 text-sm" + (activeTab === "tenant" && ins.contract_id ? " cursor-pointer hover:underline hover:text-blue-700" : "")}
                        title={activeTab === "tenant" && ins.contract_id ? "פתח את ההסכם במסך החוזים" : undefined}
                        onClick={function(){ if (activeTab === "tenant" && ins.contract_id) router.push("/contracts?select=" + ((ins.contracts as any)?.parent_contract_id || ins.contract_id)); }}>{name}</div>
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
                            var lim = (ins.coverage_limits && ins.coverage_limits[ct]) ? " " + fmtLimit(Number(ins.coverage_limits[ct])) : "";
                            return <span key={ct} title={info.desc+(lim?" — גבול"+lim:"")} className="text-[10px] bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5">{info.icon} {info.l}{lim}</span>;
                          })}
                          {(!ins.coverage_types || ins.coverage_types.length===0) && <span className="text-[10px] text-slate-300">—</span>}
                        </div>
                        {(function(){
                          var comp = complianceFor(ins.contracts);
                          if (comp.state==="compliant") return <div className="text-[10px] text-emerald-700 font-semibold mt-1">✓ עומד בדרישות</div>;
                          if (comp.state==="deficient") return <div className="text-[10px] text-amber-700 font-semibold mt-1" title={comp.issues.join("\n")}>⚠ {comp.issues.length} ליקויים מול הדרישות</div>;
                          return null;
                        })()}
                      </td>
                    )}
                    <td className="px-4 py-3">{fmtMoney(ins.coverage_amount)}</td>
                    {activeTab==="building" && <td className="px-4 py-3 text-slate-700">{fmtMoney(ins.annual_premium || ins.total_premium)}</td>}
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-slate-700">{fmtDate(ins.end_date)}</div>
                      {d!==null && ins.status==="active" && (
                        d<0 ? (h==="superseded"
                          ? <div className="text-slate-400 text-xs">הוחלפה בפוליסה חדשה</div>
                          : <div className="text-red-600 font-bold text-xs">פג לפני {Math.abs(d)} ימים</div>)
                        : d<=60 ? <div className={"text-xs font-bold " + (d<=30?"text-orange-600":"text-yellow-600")}>נותרו {d} ימים</div>
                        : null
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (h==="superseded"?"bg-slate-200 text-slate-600":h==="expired"?"bg-red-100 text-red-700":ins.status==="active"?"bg-green-100 text-green-700":"bg-slate-100 text-slate-600")}
                        title={h==="superseded"?"פוליסה קודמת — קיים ביטוח חדש בתוקף":undefined}>
                        {h==="superseded"?"עבר":h==="expired"?"פג":ins.status==="active"?"פעיל":"לא פעיל"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={function(){openEdit(ins);}} title="ערוך פרטי ביטוח (מתקן את הפוליסה הקיימת — לא לחידוש)" className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">✏️ ערוך</button>
                        <button onClick={function(){openRenew(ins);}}
                          title="חידוש — נוצרת פוליסה חדשה לתקופה הבאה, והפוליסה הנוכחית נשמרת כהיסטוריה עם הפרמיה ששולמה"
                          className="text-xs border border-indigo-200 bg-indigo-50 rounded px-2 py-1 text-indigo-700 font-semibold hover:bg-indigo-100">🔄 חידוש</button>
                        <button onClick={function(){setHistoryOf(ins);}}
                          title="כל הפוליסות שהיו לנכס/לחוזה — תקופות ופרמיות לאורך השנים"
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">📊 היסטוריה</button>
                        {activeTab==="tenant" && ins.contract_id && (h==="expiring30" || h==="expiring60" || h==="expired") && (
                          <button onClick={function(){sendRenewalDemand(ins);}}
                            title="צור מכתב לשוכר: הפוליסה עומדת לפוג בתאריך X — נא להמציא אישור ביטוח בתוקף"
                            className="text-xs border border-rose-300 bg-rose-50 rounded px-2 py-1 text-rose-700 font-semibold hover:bg-rose-100">✉ דרישת חידוש</button>
                        )}
                        {activeTab==="building" && (function(){
                          var yrs = policyYears(ins);
                          var n = insChargeCountFor(ins.property_id, yrs);
                          if (n > 0) {
                            return (
                              <a href={billingLink(ins.property_id, yrs[0])} title={"כבר נוצרו " + n + " חיובי ביטוח לנכס לשנת " + yrs.join("/") + " — לחץ לצפייה/תיקון. אין צורך ליצור שוב (מניעת כפילות)."}
                                className="text-xs border border-green-300 bg-green-100 rounded px-2 py-1 text-green-800 font-semibold hover:bg-green-200">✓ חיוב נוצר ({n}) · תיקון</a>
                            );
                          }
                          return (
                            <a href={billingLink(ins.property_id, yrs[0])} title={"עבור למסך חיובים ליצירת חיוב ביטוח לדיירים (פרו-רייט לפי מ\"ר-ימים)"}
                              className="text-xs border border-emerald-200 bg-emerald-50 rounded px-2 py-1 text-emerald-700 hover:bg-emerald-100">💸 צור חיוב</a>
                          );
                        })()}
                        {activeTab==="tenant" && (
                          <button onClick={function(){openReqEditor(ins.contracts);}} title="הגדר דרישות ביטוח להסכם זה" className="text-xs border border-indigo-200 bg-indigo-50 rounded px-2 py-1 text-indigo-700 hover:bg-indigo-100">⚙ דרישות</button>
                        )}
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setEditingId(""); }}>
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
                    : contracts.filter(function(c){ return !c.is_amendment; }).map(function(c){return <option key={c.id} value={c.id}>{(c.tenants as any)?.name} — {(c.properties as any)?.name} | יח&apos;: {spacesLabel(c)}{contractRange(c)?" | "+contractRange(c):""}</option>;})
                  }
                </select>
              </div>

              {activeTab==="tenant" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כיסויים כלולים באישור + גבול אחריות לכל כיסוי</label>
                  <div className="space-y-1.5">
                    {COVERAGE_TYPES.map(function(t){
                      var on = fCovTypes.includes(t.v);
                      return (
                        <div key={t.v} className="flex items-center gap-2">
                          <button type="button" title={t.desc} onClick={function(){ toggleCovType(t.v); }}
                            className={"flex-1 rounded-lg border p-2 text-right text-xs " + (on?"border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold":"border-slate-200 text-slate-600")}>
                            {t.icon} {t.l}
                          </button>
                          {on && (
                            <input type="number" value={fCovLimits[t.v]||""} placeholder="גבול ₪"
                              onChange={function(e){ setFCovLimits(Object.assign({}, fCovLimits, { [t.v]: e.target.value })); }}
                              className="w-32 rounded-lg border border-slate-300 px-2 py-2 text-right text-xs" dir="ltr"/>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">הזן גבול אחריות לכל כיסוי כדי שהמערכת תוכל לבדוק אם הוא עומד בנדרש בהסכם.</p>
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
                  <div className="text-[11px] text-emerald-700 flex items-center gap-2 flex-wrap">
                    ✓ מסמך מצורף — <a href={fDocUrl} target="_blank" rel="noopener noreferrer" className="underline">פתח</a>
                    <button type="button" onClick={function(){setFDocUrl("");}} className="text-rose-600 underline">הסר</button>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-200">
                  <button type="button" onClick={readDocIntoForm} disabled={docExtracting || !fDocUrl}
                    className="text-[11px] rounded bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 font-semibold disabled:opacity-50">
                    {docExtracting ? "קורא..." : "🤖 קרא נתונים מהמסמך"}
                  </button>
                  {docExtractMsg && <span className="text-[11px] text-slate-600">{docExtractMsg}</span>}
                </div>
                <p className="text-[10px] text-slate-400">המערכת תקרא את המסמך (PDF/DOCX) ותמלא אוטומטית את הכיסויים וגבולות האחריות. הקישור חייב להיות ציבורי/משותף או קובץ שהועלה למערכת.</p>
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

      {/* Requirements editor modal */}
      {reqEditContract && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setReqEditContract(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">⚙ דרישות ביטוח להסכם</h2>
              <button onClick={function(){setReqEditContract(null);}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
                <div className="font-semibold text-slate-800">{(reqEditContract.tenants as any)?.name}</div>
                <div className="text-slate-500">{(reqEditContract.properties as any)?.name} · יח&apos;: {spacesLabel(reqEditContract)}</div>
              </div>
              {/* Auto-read from the contract document in the cloud */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                <label className="block text-xs font-semibold text-emerald-800">🤖 קריאה אוטומטית מהמסמך בענן</label>
                <input type="text" value={reqDocUrl} onChange={function(e){setReqDocUrl(e.target.value);}}
                  placeholder="קישור למסמך ההסכם (PDF/DOCX) — Supabase / Dropbox / Drive ציבורי" className={ic} dir="ltr"/>
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={readRequirementsFromDoc} disabled={reqExtracting}
                    className="text-[11px] rounded bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 font-semibold disabled:opacity-50">
                    {reqExtracting ? "קורא..." : "קרא דרישות מהמסמך"}
                  </button>
                  {reqExtractMsg && <span className="text-[11px] text-slate-600">{reqExtractMsg}</span>}
                </div>
                <p className="text-[10px] text-emerald-700/70">המערכת מורידה את המסמך, קוראת אותו (כולל סריקה) ומחלצת את הכיסויים וגבולות האחריות הנדרשים בנספח הביטוח. בדוק ואשר לפני שמירה.</p>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">סמן אילו כיסויים נדרשים + גבול אחריות מינימלי</label>
                <button type="button" onClick={loadDefaultReqs} className="text-[11px] rounded border border-indigo-200 bg-indigo-50 text-indigo-700 px-2 py-1 hover:bg-indigo-100">טען ברירת מחדל מהנספח</button>
              </div>
              <div className="space-y-1.5">
                {COVERAGE_TYPES.map(function(t){
                  var on = Object.prototype.hasOwnProperty.call(reqMap, t.v);
                  return (
                    <div key={t.v} className="flex items-center gap-2">
                      <button type="button" title={t.desc} onClick={function(){ toggleReq(t.v); }}
                        className={"flex-1 rounded-lg border p-2 text-right text-xs " + (on?"border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold":"border-slate-200 text-slate-600")}>
                        {t.icon} {t.l}
                      </button>
                      {on && (
                        <input type="number" value={reqMap[t.v]||""} placeholder="מינ׳ ₪"
                          onChange={function(e){ setReqMap(Object.assign({}, reqMap, { [t.v]: e.target.value })); }}
                          className="w-32 rounded-lg border border-slate-300 px-2 py-2 text-right text-xs" dir="ltr"/>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400">השאר שדה גבול ריק = כיסוי נדרש ללא סכום מינימלי. המערכת תבדוק כל אישור שיוזן מול ההגדרות האלו ותתריע על ליקויים.</p>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setReqEditContract(null);}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={saveRequirements} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white">שמור דרישות</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
