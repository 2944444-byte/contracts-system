"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import PropertyHierarchyFilter from '@/components/PropertyHierarchyFilter';

// Minimum months of rent that a guarantee should cover. Below this, the
// row is flagged "underinsured". Industry norm in Israel is ~3 months.
const MIN_COVERAGE_MONTHS = 3;

// Doc types stored inside guarantees.documents (jsonb array).
const DOC_TYPES: Array<{v: string; l: string; icon: string}> = [
  { v: "original",    l: "מקור",       icon: "📄" },
  { v: "extension",   l: "הארכה",      icon: "⏰" },
  { v: "replacement", l: "החלפה",      icon: "🔄" },
  { v: "amendment",   l: "תיקון",      icon: "✏️" },
  { v: "other",       l: "אחר",        icon: "📎" },
];
function docTypeInfo(v: string) { return DOC_TYPES.find(function(d) { return d.v === v; }) || DOC_TYPES[4]; }

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
const GUARANTEE_TYPES = [
  { v: "bank",      l: "ערבות בנקאית", icon: "🏦" },
  { v: "check",     l: "שיקים",         icon: "📝" },
  { v: "cash",      l: "מזומן",         icon: "💵" },
  { v: "insurance", l: "ביטוח",         icon: "🛡️" },
  { v: "personal",  l: "ערבות אישית",   icon: "👤" },
  { v: "other",     l: "אחר",           icon: "📋" },
];

function daysLeft(d: string) { return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return n ? "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"; }

// Determines display health of a guarantee: expired (past end_date but still
// "active"), gap (actual < required), expiring30/60, ok.
type Health = "expired" | "gap" | "expiring30" | "expiring60" | "ok" | "inactive";
function healthOf(g: any): Health {
  if (g.status !== "active") return "inactive";
  if (g.end_date && daysLeft(g.end_date) < 0) return "expired";
  if ((g.amount_actual ?? 0) < (g.amount_required ?? 0) && (g.amount_required ?? 0) > 0) return "gap";
  if (g.end_date && daysLeft(g.end_date) <= 30) return "expiring30";
  if (g.end_date && daysLeft(g.end_date) <= 60) return "expiring60";
  return "ok";
}
// Sort priority: lower number = more urgent → appears first.
function healthOrder(h: Health): number {
  return { expired: 0, gap: 1, expiring30: 2, expiring60: 3, ok: 4, inactive: 5 }[h];
}

export default function GuaranteesPage() {
  const [guarantees, setGuarantees] = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterSt,   setFilterSt]   = useState<"active" | "expired" | "gap" | "expiring" | "returned" | "forfeited" | "all" | "underinsured">("active");
  const [filterPropIds, setFilterPropIds] = useState<string[]>([]);

  // Form state — used for both create and edit
  const [fContractId,  setFContractId]  = useState("");
  const [fType,        setFType]        = useState("bank");
  const [fRequired,    setFRequired]    = useState("");
  const [fActual,      setFActual]      = useState("");
  const [fBank,        setFBank]        = useState("");
  const [fRef,         setFRef]         = useState("");
  const [fStartDate,   setFStartDate]   = useState("");
  const [fEndDate,     setFEndDate]     = useState("");
  const [fStatus,      setFStatus]      = useState("active");
  const [fNotes,       setFNotes]       = useState("");
  const [fPrevGuaranteeId, setFPrevGuaranteeId] = useState<string | null>(null);

  // Extend dialog state
  const [extendingId, setExtendingId] = useState("");
  const [extNewEndDate, setExtNewEndDate] = useState("");
  const [extNotes,    setExtNotes]    = useState("");
  const [extDocUrl,   setExtDocUrl]   = useState("");
  const [extDocLabel, setExtDocLabel] = useState("");
  const extFileRef = useRef<HTMLInputElement>(null);
  const [extUploading, setExtUploading] = useState(false);

  // Upload state for the new/edit modal main document.
  const [fDocUrl,     setFDocUrl]     = useState("");
  const newFileRef = useRef<HTMLInputElement>(null);
  const [fUploading, setFUploading] = useState(false);

  useEffect(function () { loadAll(); }, []);

  async function loadAll() {
    const [{ data: g }, { data: c }] = await Promise.all([
      supabase.from("guarantees")
        .select("*, contracts(id, property_id, start_date, end_date, status, tenants(name), properties(name), contract_spaces(charge_method, fixed_rent, price_per_sqm, revenue_pct, min_rent, spaces(space_name, area)))")
        .order("end_date"),
      supabase.from("contracts")
        .select("id, property_id, start_date, end_date, status, is_amendment, parent_contract_id, guarantee_type, guarantee_amount, guarantee_months, tenants(name), properties(name), contract_spaces(charge_method, fixed_rent, price_per_sqm, revenue_pct, min_rent, spaces(space_name, area)), guarantees(id, status, end_date)")
        .in("status", ["active", "expiring", "extended", "upcoming"])
        .order("start_date", { ascending: false }),
    ]);
    setGuarantees(g ?? []); setContracts(c ?? []); setLoading(false);
  }

  // Estimated monthly rent for a contract — sum of contract_spaces rent.
  // Returns null when nothing can be inferred (e.g. fully revenue-based with
  // no min_rent).
  function monthlyRentOf(contract: any): number | null {
    if (!contract?.contract_spaces?.length) return null;
    var total = 0; var counted = 0;
    contract.contract_spaces.forEach(function(cs: any) {
      var area = cs?.spaces?.area ?? 0;
      if (cs.charge_method === "fixed" || (cs.fixed_rent && cs.fixed_rent > 0)) {
        total += Number(cs.fixed_rent || 0); counted++;
      } else if (cs.charge_method === "per_sqm" || (cs.price_per_sqm && cs.price_per_sqm > 0)) {
        total += Number(cs.price_per_sqm || 0) * Number(area); counted++;
      } else if (cs.min_rent && cs.min_rent > 0) {
        // revenue-based; min_rent is the floor
        total += Number(cs.min_rent); counted++;
      }
    });
    return counted > 0 ? total : null;
  }

  // Upload a file to the documents bucket; returns the public URL.
  async function uploadDocFile(file: File, prefix: string): Promise<string> {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = "guarantees/" + prefix + "_" + Date.now() + "_" + safe;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
    if (upErr) throw upErr;
    const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
    return urlData.publicUrl;
  }

  // Build a unit-list string from contract_spaces relations.
  function spacesLabel(contract: any): string {
    var arr = contract?.contract_spaces || [];
    var names = arr.map(function(cs: any) { return cs?.spaces?.space_name; }).filter(Boolean);
    if (names.length === 0) return "—";
    if (names.length <= 3) return names.join(" · ");
    return names.slice(0, 3).join(" · ") + " +" + (names.length - 3);
  }
  // Short date range like "1/2024–12/2026" for contract identification.
  function contractRange(c: any): string {
    var s = c?.start_date ? new Date(c.start_date) : null;
    var e = c?.end_date ? new Date(c.end_date) : null;
    var fmt = function(d: Date) { return (d.getMonth() + 1) + "/" + d.getFullYear(); };
    if (s && e) return fmt(s) + "–" + fmt(e);
    if (s) return "מ-" + fmt(s);
    if (e) return "עד " + fmt(e);
    return "";
  }

  function openNew(prefillFromGuarantee?: any, prefillContractId?: string) {
    setIsNew(true); setEditingId("new");
    setFDocUrl("");
    if (newFileRef.current) newFileRef.current.value = "";
    if (prefillFromGuarantee) {
      // "Replace" flow — copy contract + type from old, blank everything else
      setFContractId(prefillFromGuarantee.contract_id ?? "");
      setFType(prefillFromGuarantee.guarantee_type ?? "bank");
      setFRequired(prefillFromGuarantee.amount_required?.toString() ?? "");
      setFActual("");
      setFBank("");
      setFRef("");
      setFStartDate(new Date().toISOString().slice(0, 10));
      setFEndDate("");
      setFStatus("active");
      setFNotes("מחליפה ערבות " + (prefillFromGuarantee.reference_number || prefillFromGuarantee.bank || "קודמת"));
      setFPrevGuaranteeId(prefillFromGuarantee.id);
    } else {
      setFContractId(prefillContractId || ""); setFType("bank"); setFRequired(""); setFActual("");
      setFBank(""); setFRef(""); setFStartDate(""); setFEndDate("");
      setFStatus("active"); setFNotes(""); setFPrevGuaranteeId(null);
    }
  }

  function openEdit(g: any) {
    setIsNew(false); setEditingId(g.id);
    setFContractId(g.contract_id ?? ""); setFType(g.guarantee_type ?? "bank");
    setFRequired(g.amount_required?.toString() ?? ""); setFActual(g.amount_actual?.toString() ?? "");
    setFBank(g.bank ?? ""); setFRef(g.reference_number ?? "");
    setFStartDate(g.start_date?.split("T")[0] ?? ""); setFEndDate(g.end_date?.split("T")[0] ?? "");
    setFStatus(g.status ?? "active"); setFNotes(g.notes ?? "");
    setFPrevGuaranteeId(g.previous_guarantee_id ?? null);
    setFDocUrl(g.document_url ?? "");
    if (newFileRef.current) newFileRef.current.value = "";
  }

  // File upload from the new/edit modal.
  async function handleNewFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFUploading(true);
    try {
      const url = await uploadDocFile(file, isNew ? "new" : (editingId || "edit"));
      setFDocUrl(url);
    } catch (err: any) { alert("שגיאה בהעלאה: " + (err?.message || err)); }
    finally { setFUploading(false); }
  }

  async function handleSave() {
    if (!fContractId) { alert("חובה: חוזה"); return; }
    setSaving(true);
    try {
      const existing = !isNew ? guarantees.find(function(x) { return x.id === editingId; }) : null;
      const prevDocs: any[] = Array.isArray(existing?.documents) ? existing.documents : [];
      const docs = prevDocs.slice();
      // If a new doc URL was provided, append it to the history. We tag the
      // first ever doc as "original", subsequent ones as "replacement" (in
      // the dedicated replace flow we tag the new guarantee's doc as
      // "original" because the OLD one keeps its own history).
      if (fDocUrl && fDocUrl !== existing?.document_url) {
        var typ = (isNew || prevDocs.length === 0) ? "original" : "replacement";
        docs.push({ type: typ, url: fDocUrl, uploaded_at: new Date().toISOString() });
      }

      const payload: any = {
        contract_id: fContractId,
        guarantee_type: fType,
        amount_required: fRequired ? Number(fRequired) : null,
        amount_actual:   fActual   ? Number(fActual)   : null,
        bank:             fBank || null,
        reference_number: fRef || null,
        start_date:       fStartDate || null,
        end_date:         fEndDate || null,
        status:           fStatus,
        notes:            fNotes || null,
        document_url:     fDocUrl || null,
        documents:        docs,
      };
      if (fPrevGuaranteeId) payload.previous_guarantee_id = fPrevGuaranteeId;

      if (isNew) {
        const { data, error: ie } = await supabase.from("guarantees").insert(payload).select().single();
        if (ie) throw new Error(ie.message);
        if (!data?.id) throw new Error("שגיאה בשמירה");
        await logAudit({ entity_type: "guarantee", entity_id: data.id, action: "create" });
        // If this is a replacement, close the previous one
        if (fPrevGuaranteeId) {
          await supabase.from("guarantees").update({
            status: "returned",
            return_date: new Date().toISOString().slice(0, 10),
          }).eq("id", fPrevGuaranteeId);
          await logAudit({ entity_type: "guarantee", entity_id: fPrevGuaranteeId, action: "replaced", notes: "החלפה ל-" + data.id });
        }
      } else {
        await supabase.from("guarantees").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "guarantee", entity_id: editingId, action: "update" });
      }
      setEditingId(""); await loadAll();
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  // Extension: just shift the end_date. Stores the previous end_date so the
  // history of extensions is auditable.
  function openExtend(g: any) {
    setExtendingId(g.id);
    setExtNewEndDate(g.end_date || "");
    setExtNotes("");
    setExtDocUrl("");
    setExtDocLabel("");
    if (extFileRef.current) extFileRef.current.value = "";
  }
  async function handleExtFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtUploading(true);
    try {
      const url = await uploadDocFile(file, "ext_" + extendingId);
      setExtDocUrl(url);
    } catch (err: any) { alert("שגיאה בהעלאה: " + (err?.message || err)); }
    finally { setExtUploading(false); }
  }
  async function handleExtend() {
    if (!extendingId || !extNewEndDate) { alert("חובה: תאריך חדש"); return; }
    var g = guarantees.find(function(x) { return x.id === extendingId; });
    var prevEnd = g?.end_date || null;
    var prevDocs: any[] = Array.isArray(g?.documents) ? g.documents : [];
    var newDocs = prevDocs.slice();
    if (extDocUrl) {
      newDocs.push({
        type: "extension",
        url: extDocUrl,
        label: extDocLabel || ("הארכה עד " + extNewEndDate),
        uploaded_at: new Date().toISOString(),
        prev_end_date: prevEnd,
        new_end_date: extNewEndDate,
      });
    }
    try {
      await supabase.from("guarantees").update({
        end_date: extNewEndDate,
        previous_end_date: prevEnd,
        extended_at: new Date().toISOString(),
        documents: newDocs,
        notes: g?.notes
          ? g.notes + "\n[הארכה " + new Date().toLocaleDateString("he-IL") + ": " + (prevEnd || "—") + " → " + extNewEndDate + (extNotes ? ", " + extNotes : "") + (extDocUrl ? " (מסמך מצורף)" : "") + "]"
          : "[הארכה: " + (prevEnd || "—") + " → " + extNewEndDate + (extNotes ? ", " + extNotes : "") + (extDocUrl ? " (מסמך מצורף)" : "") + "]",
      }).eq("id", extendingId);
      await logAudit({ entity_type: "guarantee", entity_id: extendingId, action: "extend", notes: "ל-" + extNewEndDate + (extDocUrl ? " + מסמך" : "") });
      setExtendingId(""); setExtNewEndDate(""); setExtNotes("");
      setExtDocUrl(""); setExtDocLabel("");
      await loadAll();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
  }

  async function handleReturn(id: string) {
    if (!confirm("לסמן כהוחזרה?")) return;
    await supabase.from("guarantees").update({
      status: "returned", return_date: new Date().toISOString().slice(0, 10),
    }).eq("id", id);
    await logAudit({ entity_type: "guarantee", entity_id: id, action: "returned" });
    await loadAll();
  }
  async function handleForfeit(id: string) {
    if (!confirm("לסמן כמומשה?")) return;
    await supabase.from("guarantees").update({ status: "forfeited" }).eq("id", id);
    await logAudit({ entity_type: "guarantee", entity_id: id, action: "forfeited" });
    await loadAll();
  }

  // ─── Compute filtered + sorted list ────────────────────────────────
  const filtered = guarantees.filter(function (g) {
    var h = healthOf(g);
    if (filterPropIds.length > 0 && !filterPropIds.includes(g.contracts?.property_id)) return false;
    if (filterSt === "all") return true;
    if (filterSt === "expired")   return h === "expired";
    if (filterSt === "gap")       return h === "gap";
    if (filterSt === "expiring")  return h === "expiring30" || h === "expiring60";
    if (filterSt === "returned")  return g.status === "returned";
    if (filterSt === "forfeited") return g.status === "forfeited";
    if (filterSt === "underinsured") {
      if (g.status !== "active") return false;
      var m = coverageMonths(g);
      return m !== null && m < expectedCoverageMonths(g);
    }
    // "active" — includes all health states that are still in-play
    return g.status === "active";
  });
  // Sort: urgent first, then by end_date ascending
  const sorted = filtered.slice().sort(function (a, b) {
    var ha = healthOrder(healthOf(a));
    var hb = healthOrder(healthOf(b));
    if (ha !== hb) return ha - hb;
    var ea = a.end_date ? new Date(a.end_date).getTime() : Infinity;
    var eb = b.end_date ? new Date(b.end_date).getTime() : Infinity;
    return ea - eb;
  });

  // ─── KPIs ──────────────────────────────────────────────────────────
  const active        = guarantees.filter(function (g) { return g.status === "active"; });
  const expired       = active.filter(function (g) { return healthOf(g) === "expired"; });
  const expiring30    = active.filter(function (g) { return healthOf(g) === "expiring30"; });
  const expiring60    = active.filter(function (g) { return healthOf(g) === "expiring60"; });
  const hasGap        = active.filter(function (g) { return healthOf(g) === "gap"; });
  const totalActive   = active.reduce(function (s, g) { return s + (g.amount_actual ?? 0); }, 0);
  const totalRequired = active.reduce(function (s, g) { return s + (g.amount_required ?? 0); }, 0);
  const typeInfo = function (v: string) { return GUARANTEE_TYPES.find(function (t) { return t.v === v; }) ?? GUARANTEE_TYPES[5]; };

  // Contract is treated as "no guarantee required" when its guarantee
  // definition is explicitly empty or marked 'none'. The user told us this
  // happens when the parties agreed there's no guarantee/other security —
  // these should NOT be flagged as missing, just listed informatively.
  function contractRequiresGuarantee(c: any): boolean {
    var typ = (c.guarantee_type || "").toString().trim().toLowerCase();
    if (typ === "" || typ === "none" || typ === "no" || typ === "ללא") return false;
    var amt    = Number(c.guarantee_amount || 0);
    var months = Number(c.guarantee_months || 0);
    // If both the amount and months are zero AND there's no type that
    // signals "yes" — also treat as no requirement.
    if (amt === 0 && months === 0 && typ === "") return false;
    return true;
  }

  // Build a map: parent-or-self id → array of guarantees on the whole
  // family (parent + amendments). An amendment that doesn't touch the
  // guarantee inherits whatever the parent has.
  function familyGuarantees(c: any): any[] {
    var pid = c.parent_contract_id || c.id;
    var family = contracts.filter(function(x: any) {
      return x.id === pid || x.parent_contract_id === pid;
    });
    var gs: any[] = [];
    family.forEach(function(x: any) { (x.guarantees || []).forEach(function(g: any) { gs.push(g); }); });
    // Also check standalone guarantees that point at any family member
    guarantees.forEach(function(g: any) {
      if (family.some(function(x){ return x.id === g.contract_id; }) && !gs.some(function(y){ return y.id === g.id; })) {
        gs.push(g);
      }
    });
    return gs;
  }

  // Only base contracts (skip amendments — they inherit their parent's
  // guarantee unless they explicitly registered a new one).
  const baseContractsForReport = contracts.filter(function(c: any) {
    if (filterPropIds.length > 0 && !filterPropIds.includes(c.property_id)) return false;
    if (c.is_amendment === true) return false;
    if (c.parent_contract_id) return false;
    return true;
  });

  // Three buckets: contracts that need a guarantee but don't have an
  // active one; contracts whose contract explicitly defines no guarantee
  // (informational only); and the rest (covered).
  const missingGuarantees   = baseContractsForReport.filter(function(c: any) {
    if (!contractRequiresGuarantee(c)) return false;
    var hasActive = familyGuarantees(c).some(function(gg: any) {
      return gg.status === "active" && (!gg.end_date || daysLeft(gg.end_date) >= 0);
    });
    return !hasActive;
  });
  const noGuaranteeDefined  = baseContractsForReport.filter(function(c: any) {
    return !contractRequiresGuarantee(c);
  });

  // Underinsured: amount_required < expected months × monthly rent.
  // The expected floor comes from contract.guarantee_months when set
  // (some contracts agree on 6 months, some on 3, etc.) and falls back
  // to the platform-wide MIN_COVERAGE_MONTHS otherwise.
  function expectedCoverageMonths(g: any): number {
    var m = Number(g?.contracts?.guarantee_months || 0);
    return m > 0 ? m : MIN_COVERAGE_MONTHS;
  }
  function coverageMonths(g: any): number | null {
    var rent = monthlyRentOf(g.contracts);
    if (!rent || rent <= 0) return null;
    var amt = Number(g.amount_required || g.amount_actual || 0);
    if (!amt) return 0;
    return amt / rent;
  }
  const underinsured = active.filter(function(g) {
    var m = coverageMonths(g);
    return m !== null && m < expectedCoverageMonths(g);
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ערבויות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {active.length} פעילות | סה&quot;כ בפועל {fmtMoney(totalActive)} / נדרש {fmtMoney(totalRequired)}
          </p>
        </div>
        <button onClick={function() { openNew(); }} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800" title="צור ערבות חדשה לשוכר">+ ערבות חדשה</button>
      </div>

      {/* KPIs — clickable filters */}
      <div className="grid grid-cols-6 gap-3 mb-5">
        {[
          { f: "all",       label: "הכל",        value: guarantees.length, sub: "כל הערבויות",            color: "text-slate-600",  bg: "bg-white" },
          { f: "active",    label: "פעילות",     value: active.length,     sub: fmtMoney(totalActive),    color: "text-slate-800",  bg: "bg-white" },
          { f: "expired",   label: "פג תוקף",    value: expired.length,    sub: "בתוקף 'פעיל' אך עברה תקפותם", color: expired.length > 0 ? "text-red-700" : "text-slate-400", bg: expired.length > 0 ? "bg-red-50" : "bg-white" },
          { f: "expiring",  label: "פגות בקרוב", value: expiring30.length + expiring60.length, sub: "ב-60 הימים הקרובים", color: (expiring30.length + expiring60.length) > 0 ? "text-yellow-700" : "text-slate-400", bg: (expiring30.length + expiring60.length) > 0 ? "bg-yellow-50" : "bg-white" },
          { f: "gap",       label: "עם פער",     value: hasGap.length,     sub: "בפועל < נדרש",            color: hasGap.length > 0 ? "text-orange-700" : "text-slate-400", bg: hasGap.length > 0 ? "bg-orange-50" : "bg-white" },
          { f: "underinsured", label: "כיסוי נמוך", value: underinsured.length, sub: "מתחת לסף שבהסכם", color: underinsured.length > 0 ? "text-amber-700" : "text-slate-400", bg: underinsured.length > 0 ? "bg-amber-50" : "bg-white" },
        ].map(function (k) {
          return (
            <button key={k.label} onClick={function () { setFilterSt(k.f as any); }}
              className={"rounded-xl border p-3 text-center transition-all " + k.bg + (filterSt === k.f ? " border-blue-500 ring-2 ring-blue-300" : " border-slate-200")}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
              {k.sub && <div className="text-[10px] text-slate-400 mt-0.5">{k.sub}</div>}
            </button>
          );
        })}
      </div>

      <div className="mb-4">
        <PropertyHierarchyFilter onChange={function (f) { setFilterPropIds(f.propertyIds); }} />
      </div>

      {/* Missing-guarantees alert: active contracts without an active guarantee */}
      {missingGuarantees.length > 0 && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 mb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-bold text-rose-800 text-sm">⚠ הסכמים פעילים ללא ערבות בתוקף — {missingGuarantees.length}</div>
              <div className="text-xs text-rose-600 mt-0.5">חוזים פעילים שאין להם אף ערבות במצב "פעילה" שתאריך הסיום שלה לא עבר.</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {missingGuarantees.slice(0, 12).map(function(c: any) {
              return (
                <div key={c.id} className="rounded-lg bg-white border border-rose-200 p-2.5 text-xs">
                  <div className="font-semibold text-slate-800">{(c.tenants as any)?.name}</div>
                  <div className="text-slate-500">{(c.properties as any)?.name}</div>
                  <div className="text-[10px] text-indigo-700 mt-0.5">יח&apos;: {spacesLabel(c)}</div>
                  <div className="text-[10px] text-slate-400">{contractRange(c)}</div>
                  <button onClick={function() { openNew(undefined, c.id); }} title="צור ערבות חדשה עבור הסכם זה"
                    className="mt-1.5 text-[11px] rounded bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 font-semibold">
                    + צור ערבות לחוזה
                  </button>
                </div>
              );
            })}
          </div>
          {missingGuarantees.length > 12 && (
            <div className="text-[11px] text-rose-600 mt-2">ועוד {missingGuarantees.length - 12} הסכמים...</div>
          )}
        </div>
      )}

      {/* Contracts with no guarantee defined — informational only */}
      {noGuaranteeDefined.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4">
          <div className="font-bold text-slate-700 text-sm">ℹ️ אין הגדרה של ערבות בהסכם — {noGuaranteeDefined.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            בהסכמים האלו לא הוגדרה דרישת ערבות (סוכם בין הצדדים שאין ערבות / ביטחון אחר). אין צורך לדרוש ערבות עבורם.
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {noGuaranteeDefined.slice(0, 12).map(function(c: any) {
              return (
                <div key={c.id} className="rounded-lg bg-white border border-slate-200 p-2.5 text-xs">
                  <div className="font-semibold text-slate-800">{(c.tenants as any)?.name}</div>
                  <div className="text-slate-500">{(c.properties as any)?.name}</div>
                  <div className="text-[10px] text-indigo-700 mt-0.5">יח&apos;: {spacesLabel(c)}</div>
                  <div className="text-[10px] text-slate-400">{contractRange(c)}</div>
                </div>
              );
            })}
          </div>
          {noGuaranteeDefined.length > 12 && (
            <div className="text-[11px] text-slate-500 mt-2">ועוד {noGuaranteeDefined.length - 12} הסכמים...</div>
          )}
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { v: "active",    l: "פעילות" },
          { v: "expired",   l: "פג תוקף" },
          { v: "expiring",  l: "פגות בקרוב" },
          { v: "gap",       l: "עם פער" },
          { v: "underinsured", l: "כיסוי נמוך" },
          { v: "returned",  l: "הוחזרו" },
          { v: "forfeited", l: "מומשו" },
          { v: "all",       l: "הכל" },
        ].map(function (s) {
          return (
            <button key={s.v} onClick={function () { setFilterSt(s.v as any); }}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " + (filterSt === s.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
              {s.l}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🏦</div><div>אין ערבויות התואמות את הסינון</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">סטטוס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">סוג</th>
                <th className="px-4 py-3 font-semibold text-slate-700">שוכר / נכס / יחידות / הסכם</th>
                <th className="px-4 py-3 font-semibold text-slate-700">נדרש</th>
                <th className="px-4 py-3 font-semibold text-slate-700">בפועל</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פער</th>
                <th className="px-4 py-3 font-semibold text-slate-700">תוקף</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(function (g) {
                const ti = typeInfo(g.guarantee_type);
                const diff = (g.amount_actual ?? 0) - (g.amount_required ?? 0);
                const d = g.end_date ? daysLeft(g.end_date) : null;
                const h = healthOf(g);
                const rowColor = h === "expired" ? "bg-red-50 border-r-4 border-red-500"
                  : h === "gap" ? "bg-orange-50 border-r-4 border-orange-500"
                  : h === "expiring30" ? "bg-yellow-50 border-r-4 border-yellow-400"
                  : h === "expiring60" ? "bg-yellow-50/40"
                  : h === "inactive" ? "opacity-60"
                  : "hover:bg-slate-50";
                return (
                  <tr key={g.id} className={"border-t border-slate-100 " + rowColor}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {h === "expired"   && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-bold">⚠ פג תוקף</span>}
                      {h === "gap"       && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-bold">⚠ פער</span>}
                      {h === "expiring30"&& <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-bold">⏰ ≤30 ימים</span>}
                      {h === "expiring60"&& <span className="text-[10px] bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded-full font-semibold">⏰ ≤60 ימים</span>}
                      {h === "ok"        && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">✓ תקין</span>}
                      {g.status === "returned"  && <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">הוחזרה</span>}
                      {g.status === "forfeited" && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">מומשה</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2"><span className="text-xl">{ti.icon}</span><span className="font-semibold text-slate-800 text-xs">{ti.l}</span></div>
                      {g.bank && <div className="text-xs text-slate-400 mt-0.5">{g.bank}</div>}
                      {g.reference_number && <div className="text-[10px] text-slate-400 font-mono">{g.reference_number}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{g.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-500">{g.contracts?.properties?.name}</div>
                      <div className="text-xs text-indigo-700 font-semibold mt-0.5" title="היחידות הכלולות בהסכם זה">
                        יח&apos;: {spacesLabel(g.contracts)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5" title="תקופת ההסכם המקושר לערבות">
                        הסכם: {contractRange(g.contracts)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{fmtMoney(g.amount_required)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{fmtMoney(g.amount_actual)}</td>
                    <td className="px-4 py-3">
                      {g.amount_required && g.amount_actual && (
                        <span className={diff < 0 ? "text-red-600 font-bold" : "text-green-600 font-semibold"}>
                          {diff < 0 ? "-₪" + Math.abs(Math.round(diff)).toLocaleString() : "✓ תקין"}
                        </span>
                      )}
                      {(function() {
                        var m = coverageMonths(g);
                        if (m === null) return null;
                        var floor = expectedCoverageMonths(g);
                        var lo = m < floor;
                        return (
                          <div className={"text-[10px] mt-0.5 font-semibold " + (lo ? "text-amber-700" : "text-emerald-700")}
                               title={"נדרש ÷ שכ\"ד חודשי משוער (≈₪" + Math.round(monthlyRentOf(g.contracts) || 0).toLocaleString() + "). הסף בהסכם: " + floor + " חוד'"}>
                            {lo ? "⚠ " : "✓ "}≈{m.toFixed(1)}/{floor} חוד&apos; שכ&quot;ד
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {fmtDate(g.end_date)}
                      {d !== null && g.status === "active" && (
                        d < 0 ? <div className="text-red-600 font-bold">פג לפני {Math.abs(d)} ימים</div>
                        : d <= 60 ? <div className={"font-bold " + (d <= 30 ? "text-red-600" : "text-yellow-600")}>נותרו {d} ימים</div>
                        : null
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={function () { openEdit(g); }} title="ערוך פרטי ערבות"
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">
                          ✏️ ערוך
                        </button>
                        {g.status === "active" && (
                          <button onClick={function () { openExtend(g); }} title="הארך תוקף — שנה רק את תאריך הסיום"
                            className="text-xs border border-blue-200 bg-blue-50 rounded px-2 py-1 text-blue-700 hover:bg-blue-100">
                            ⏰ הארכה
                          </button>
                        )}
                        {g.status === "active" && (
                          <button onClick={function () { openNew(g); }} title="החלף — סגור את הנוכחית ופתח ערבות חדשה לאותו שוכר"
                            className="text-xs border border-indigo-200 bg-indigo-50 rounded px-2 py-1 text-indigo-700 hover:bg-indigo-100">
                            🔄 החלפה
                          </button>
                        )}
                        {/* Documents list — original + every extension/replacement attachment */}
                        {(function() {
                          var docs: any[] = Array.isArray(g.documents) ? g.documents.slice() : [];
                          // Back-compat: include document_url if not already represented in docs.
                          if (g.document_url && !docs.some(function(d){ return d.url === g.document_url; })) {
                            docs.unshift({ type: "original", url: g.document_url });
                          }
                          if (docs.length === 0) return null;
                          return docs.map(function(d, i) {
                            var info = docTypeInfo(d.type || "other");
                            return (
                              <a key={i} href={d.url} target="_blank" rel="noopener noreferrer"
                                title={"פתח מסמך — " + info.l + (d.label ? ": " + d.label : "")}
                                className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50">
                                {info.icon} {info.l}
                              </a>
                            );
                          });
                        })()}
                        {g.status === "active" && (
                          <>
                            <button onClick={function () { handleReturn(g.id); }} title="סמן שהערבות הוחזרה לשוכר"
                              className="text-xs border border-green-200 rounded px-2 py-1 text-green-700 hover:bg-green-50">
                              ↩ הוחזרה
                            </button>
                            <button onClick={function () { handleForfeit(g.id); }} title="סמן שהערבות חולטה (מומשה)"
                              className="text-xs border border-red-200 rounded px-2 py-1 text-red-600 hover:bg-red-50">
                              💸 מימוש
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit / replace modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function () { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function (e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">
                {fPrevGuaranteeId ? "🔄 החלפת ערבות — ערבות חדשה" : isNew ? "ערבות חדשה" : "עריכת ערבות"}
              </h2>
              <button onClick={function () { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              {fPrevGuaranteeId && (
                <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-3 text-xs text-indigo-800">
                  בעת שמירה, הערבות הקודמת תיסומן אוטומטית כ"הוחזרה" וערבות זו תתפוס את מקומה.
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                <select value={fContractId} onChange={function (e) { setFContractId(e.target.value); }} className={ic}>
                  <option value="">-- בחר --</option>
                  {contracts.map(function (c) {
                    var tenantName = (c.tenants as any)?.name || "—";
                    var propName   = (c.properties as any)?.name || "—";
                    var units      = spacesLabel(c);
                    var range      = contractRange(c);
                    return (
                      <option key={c.id} value={c.id}>
                        {tenantName} — {propName} | יח&apos;: {units}{range ? " | " + range : ""}
                      </option>
                    );
                  })}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  אם לאותו שוכר ונכס יש כמה הסכמים — בחר לפי היחידות והתאריכים.
                </p>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג</label>
                <div className="grid grid-cols-3 gap-2">
                  {GUARANTEE_TYPES.map(function (t) {
                    return (
                      <button key={t.v} type="button" onClick={function () { setFType(t.v); }}
                        className={"rounded-lg border p-2 text-center " + (fType === t.v ? "border-blue-500 bg-blue-50" : "border-slate-200")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType === t.v ? "text-blue-700" : "text-slate-600")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">נדרש (₪)</label><input type="number" value={fRequired} onChange={function (e) { setFRequired(e.target.value); }} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">בפועל (₪)</label><input type="number" value={fActual} onChange={function (e) { setFActual(e.target.value); }} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">בנק/מוציא</label><input type="text" value={fBank} onChange={function (e) { setFBank(e.target.value); }} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">אסמכתא</label><input type="text" value={fRef} onChange={function (e) { setFRef(e.target.value); }} className={ic} dir="ltr"/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">תחילה</label><input type="date" value={fStartDate} onChange={function (e) { setFStartDate(e.target.value); }} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">סיום</label><input type="date" value={fEndDate} onChange={function (e) { setFEndDate(e.target.value); }} className={ic}/></div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function (e) { setFStatus(e.target.value); }} className={ic}>
                  <option value="active">פעילה</option>
                  <option value="returned">הוחזרה</option>
                  <option value="forfeited">מומשה</option>
                </select>
              </div>
              {/* Document attachment — cloud upload or paste a URL */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                <label className="block text-xs font-semibold text-slate-700">📄 מסמך ערבות (עליה לענן או קישור)</label>
                <div className="flex gap-2 items-center flex-wrap">
                  <input ref={newFileRef} type="file" onChange={handleNewFileChange}
                    className="text-xs file:rounded file:border-0 file:bg-blue-600 file:text-white file:px-3 file:py-1.5 file:font-semibold file:cursor-pointer file:ml-2"/>
                  {fUploading && <span className="text-xs text-blue-600">מעלה...</span>}
                </div>
                <input type="text" value={fDocUrl} onChange={function(e){ setFDocUrl(e.target.value); }}
                  placeholder="או הדבק קישור (Drive / Dropbox / כל URL)"
                  className={ic} dir="ltr"/>
                {fDocUrl && (
                  <div className="text-[11px] text-emerald-700 flex items-center gap-2">
                    ✓ מסמך מצורף — <a href={fDocUrl} target="_blank" rel="noopener noreferrer" className="underline">פתח</a>
                    <button type="button" onClick={function(){ setFDocUrl(""); }} className="text-rose-600 underline">הסר</button>
                  </div>
                )}
              </div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><textarea value={fNotes} onChange={function (e) { setFNotes(e.target.value); }} rows={2} className={ic}/></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function () { setEditingId(""); }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : fPrevGuaranteeId ? "שמור והחלף" : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Extend dialog — only changes end_date */}
      {extendingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function () { setExtendingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={function (e) { e.stopPropagation(); }} dir="rtl">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">⏰ הארכת תוקף הערבות</h2>
              <button onClick={function () { setExtendingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              {(function () {
                var g = guarantees.find(function(x) { return x.id === extendingId; });
                if (!g) return null;
                return (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 space-y-1">
                    <div><span className="text-slate-500">שוכר:</span> <span className="font-semibold">{g.contracts?.tenants?.name}</span></div>
                    <div><span className="text-slate-500">נכס:</span> <span className="font-semibold">{g.contracts?.properties?.name}</span></div>
                    <div><span className="text-slate-500">יחידות:</span> <span className="font-semibold text-indigo-700">{spacesLabel(g.contracts)}</span></div>
                    <div><span className="text-slate-500">הסכם:</span> <span className="font-semibold">{contractRange(g.contracts)}</span></div>
                    <div><span className="text-slate-500">תוקף נוכחי:</span> <span className="font-semibold">{fmtDate(g.end_date)}</span></div>
                    {g.previous_end_date && <div><span className="text-slate-500">תוקף קודם (לפני הארכה):</span> <span className="font-semibold">{fmtDate(g.previous_end_date)}</span></div>}
                  </div>
                );
              })()}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך תוקף חדש *</label>
                <input type="date" value={extNewEndDate} onChange={function (e) { setExtNewEndDate(e.target.value); }} className={ic}/>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות (אופציונלי)</label>
                <input type="text" value={extNotes} onChange={function (e) { setExtNotes(e.target.value); }} className={ic} placeholder="למשל: הסכמה טלפונית עם הבנק"/>
              </div>
              {/* Extension document — cloud upload or URL */}
              <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
                <label className="block text-xs font-semibold text-slate-700">📎 מסמך הארכה (אופציונלי — עליה לענן או קישור)</label>
                <div className="flex gap-2 items-center flex-wrap">
                  <input ref={extFileRef} type="file" onChange={handleExtFileChange}
                    className="text-xs file:rounded file:border-0 file:bg-blue-600 file:text-white file:px-3 file:py-1.5 file:font-semibold file:cursor-pointer file:ml-2"/>
                  {extUploading && <span className="text-xs text-blue-600">מעלה...</span>}
                </div>
                <input type="text" value={extDocUrl} onChange={function(e){ setExtDocUrl(e.target.value); }}
                  placeholder="או הדבק קישור (Drive / Dropbox / כל URL)"
                  className={ic} dir="ltr"/>
                <input type="text" value={extDocLabel} onChange={function(e){ setExtDocLabel(e.target.value); }}
                  placeholder="תיאור (לדוגמה: אישור הארכה מבנק לאומי)"
                  className={ic}/>
                {extDocUrl && (
                  <div className="text-[11px] text-emerald-700 flex items-center gap-2">
                    ✓ מסמך הארכה מצורף — <a href={extDocUrl} target="_blank" rel="noopener noreferrer" className="underline">פתח</a>
                    <button type="button" onClick={function(){ setExtDocUrl(""); }} className="text-rose-600 underline">הסר</button>
                  </div>
                )}
              </div>
              <div className="text-[11px] text-slate-500">
                💡 ההארכה תישמר על הערבות הקיימת. התוקף הקודם יישמר לצורך מעקב.
                אם הערבות הוחלפה (מסמך חדש מהבנק עם מספר אסמכתא חדש) — השתמש ב-&quot;🔄 החלפה&quot; במקום.
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function () { setExtendingId(""); }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleExtend} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white">⏰ הארך</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
