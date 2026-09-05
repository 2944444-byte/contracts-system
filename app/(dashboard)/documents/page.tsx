"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';
import { logAudit } from '@/lib/audit-log';

// ─────────────────────────────────────────────────────────────────────────────
// Unified documents hub: ONE place that shows every document in the system —
// uploads made here (documents table) PLUS the cloud-linked files that live on
// the records themselves (contract scan, guarantee docs, insurance certs,
// safety certificates, revenue-report attachments) — with an in-app viewer.
// ─────────────────────────────────────────────────────────────────────────────

type VDoc = {
  key: string;
  source: "upload" | "contract" | "guarantee" | "insurance" | "safety" | "revenue";
  type: string;            // chip key
  icon: string;
  title: string;
  tenant?: string;
  property?: string;
  url: string;
  size?: number;
  date?: string;
  contractId?: string;
  dbId?: string;            // documents.id — only uploads are deletable
};

const TYPE_CHIPS = [
  { v: "all",        l: "הכל",            icon: "📚" },
  { v: "contract",   l: "חוזה",           icon: "📄" },
  { v: "guarantee",  l: "ערבות",          icon: "🏦" },
  { v: "insurance",  l: "ביטוח",          icon: "🛡️" },
  { v: "inspection", l: "בדיקת בטיחות",  icon: "🔒" },
  { v: "revenue",    l: "דוחות פדיון",    icon: "📊" },
  { v: "invoice",    l: "חשבונית",        icon: "🧾" },
  { v: "other",      l: "אחר",            icon: "📎" },
];
const chipInfo = function(v: string) { return TYPE_CHIPS.find(function(t){ return t.v === v; }) || TYPE_CHIPS[TYPE_CHIPS.length - 1]; };

const UPLOAD_TYPES = [
  { v: "contract",   l: "חוזה",          icon: "📄" },
  { v: "guarantee",  l: "ערבות",         icon: "🏦" },
  { v: "insurance",  l: "ביטוח",         icon: "🛡️" },
  { v: "inspection", l: "בדיקת בטיחות", icon: "🔒" },
  { v: "invoice",    l: "חשבונית",       icon: "🧾" },
  { v: "other",      l: "אחר",           icon: "📎" },
];

function fmtSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
function fmtDate(d?: string) { return d ? new Date(d).toLocaleDateString("he-IL") : ""; }
function isImage(url: string) { return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url); }

// Pull extra docs out of a `documents` jsonb array (guarantees/insurances/safety
// keep secondary files there). Tolerant to several shapes: {url|file_url,
// label|type|name}.
function jsonbDocs(raw: any): Array<{ url: string; label: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map(function(it: any){
    var url = it?.url || it?.file_url || "";
    var label = it?.label || it?.name || it?.type || "";
    return url ? { url: url, label: label } : null;
  }).filter(Boolean) as Array<{ url: string; label: string }>;
}

export default function DocumentsPage() {
  const [docs,      setDocs]      = useState<VDoc[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [filterContract, setFilterContract] = useState("");
  const [search,    setSearch]    = useState("");
  const [preview,   setPreview]   = useState<VDoc | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [fContractId, setFContractId] = useState("");
  const [fDocType,    setFDocType]    = useState("contract");
  const [fName,       setFName]       = useState("");
  // Missing-docs tripwire: active contracts without a scan, guarantees without a doc.
  const [missing, setMissing] = useState<Array<{ kind: string; label: string; contractId?: string; docType: string }>>([]);
  const [dragOver, setDragOver] = useState(false);
  const uploadRef = useRef<HTMLDivElement>(null);

  useEffect(function() {
    loadAll();
    // Deep link: /documents?contract=<id> opens the hub filtered to that contract.
    try {
      var c = new URLSearchParams(window.location.search).get("contract");
      if (c) setFilterContract(c);
    } catch (e) { /* noop */ }
  }, []);

  async function loadAll() {
    const scope = await getScopeIds();
    const [docRes, conRes, guarRes, insTRes, insBRes, safRes, revRes] = await Promise.all([
      supabase.from("documents").select("*, contracts(property_id, tenants(name), properties(name))").order("created_at", { ascending: false }),
      supabase.from("contracts").select("id, document_url, property_id, status, start_date, tenants(name), properties(name), contract_spaces(area_override,follows_contract_options,spaces(space_name))").in("status", ["active","expiring","extended","upcoming","ended"]),
      supabase.from("guarantees").select("id, status, document_url, documents, created_at, contract_id, contracts(property_id, tenants(name), properties(name))"),
      supabase.from("insurances_tenant").select("id, certificate_url, documents, created_at, end_date, contract_id, contracts(property_id, tenants(name), properties(name))"),
      supabase.from("insurances_building").select("id, document_url, documents, created_at, end_date, property_id, properties(name)"),
      supabase.from("safety_inspections").select("id, document_url, documents, created_at, property_id, inspection_type, properties(name)"),
      supabase.from("revenue_reports").select("id, attachment_url, attachment_name, attachment_size, report_month, contract_id, contracts(property_id, tenants(name), properties(name))").not("attachment_url", "is", null),
    ]);

    var out: VDoc[] = [];

    // 1) Uploads from this screen — contract-linked rows are scoped; general
    //    (unlinked) uploads stay shared, as before.
    var uploads = (docRes.data ?? []).filter(function(d: any){
      if (!d.contract_id) return true;
      return scopeRows([d], scope, function(r: any){ return r.contracts?.property_id; }).length > 0;
    });
    uploads.forEach(function(d: any){
      var url = d.file_url || d.external_url || "";
      if (!url) return;
      out.push({
        key: "up-" + d.id, source: "upload", dbId: d.id,
        type: d.doc_type || "other", icon: chipInfo(d.doc_type || "other").icon,
        title: d.title || "מסמך", url: url, size: d.file_size || undefined,
        tenant: d.contracts?.tenants?.name, property: d.contracts?.properties?.name,
        date: d.created_at, contractId: d.contract_id || undefined,
      });
    });

    // 2) Contract scans (contracts.document_url)
    var scopedContracts = scopeRows(conRes.data ?? [], scope, function(c: any){ return c.property_id; });
    setContracts(scopedContracts.filter(function(c: any){ return ["active","expiring","extended","upcoming"].indexOf(c.status) !== -1; }));
    scopedContracts.forEach(function(c: any){
      if (!c.document_url) return;
      var units = (c.contract_spaces ?? []).map(function(cs: any){ return cs?.spaces?.space_name; }).filter(Boolean).join(", ");
      out.push({
        key: "con-" + c.id, source: "contract", type: "contract", icon: "📄",
        title: "חוזה — " + (c.tenants?.name || "") + (units ? " (" + units + ")" : ""),
        tenant: c.tenants?.name, property: c.properties?.name,
        url: c.document_url, date: c.start_date, contractId: c.id,
      });
    });

    // 3) Guarantees (main doc + extra jsonb docs)
    scopeRows(guarRes.data ?? [], scope, function(g: any){ return g.contracts?.property_id; }).forEach(function(g: any){
      var tenant = g.contracts?.tenants?.name;
      var property = g.contracts?.properties?.name;
      if (g.document_url) out.push({ key: "gu-" + g.id, source: "guarantee", type: "guarantee", icon: "🏦", title: "ערבות — " + (tenant || ""), tenant: tenant, property: property, contractId: g.contract_id, date: g.created_at, url: g.document_url });
      jsonbDocs(g.documents).forEach(function(d, i){
        out.push({ key: "gu-" + g.id + "-" + i, source: "guarantee", type: "guarantee", icon: "🏦", title: "ערבות" + (d.label ? " (" + d.label + ")" : "") + " — " + (tenant || ""), tenant: tenant, property: property, contractId: g.contract_id, date: g.created_at, url: d.url });
      });
    });

    // 4) Tenant insurance certificates
    scopeRows(insTRes.data ?? [], scope, function(x: any){ return x.contracts?.property_id; }).forEach(function(x: any){
      var tenant = x.contracts?.tenants?.name;
      var property = x.contracts?.properties?.name;
      if (x.certificate_url) out.push({ key: "it-" + x.id, source: "insurance", type: "insurance", icon: "🛡️", title: "אישור ביטוח שוכר — " + (tenant || ""), tenant: tenant, property: property, contractId: x.contract_id, date: x.created_at, url: x.certificate_url });
      jsonbDocs(x.documents).forEach(function(d, i){
        out.push({ key: "it-" + x.id + "-" + i, source: "insurance", type: "insurance", icon: "🛡️", title: "ביטוח" + (d.label ? " (" + d.label + ")" : "") + " — " + (tenant || ""), tenant: tenant, property: property, contractId: x.contract_id, date: x.created_at, url: d.url });
      });
    });

    // 5) Building insurance
    scopeRows(insBRes.data ?? [], scope, function(x: any){ return x.property_id; }).forEach(function(x: any){
      var property = x.properties?.name;
      if (x.document_url) out.push({ key: "ib-" + x.id, source: "insurance", type: "insurance", icon: "🛡️", title: "ביטוח מבנה — " + (property || ""), property: property, date: x.created_at, url: x.document_url });
      jsonbDocs(x.documents).forEach(function(d, i){
        out.push({ key: "ib-" + x.id + "-" + i, source: "insurance", type: "insurance", icon: "🛡️", title: "ביטוח מבנה" + (d.label ? " (" + d.label + ")" : "") + " — " + (property || ""), property: property, date: x.created_at, url: d.url });
      });
    });

    // 6) Safety inspection certificates
    scopeRows(safRes.data ?? [], scope, function(x: any){ return x.property_id; }).forEach(function(x: any){
      var property = x.properties?.name;
      if (x.document_url) out.push({ key: "sf-" + x.id, source: "safety", type: "inspection", icon: "🔒", title: "אישור בטיחות — " + (property || ""), property: property, date: x.created_at, url: x.document_url });
      jsonbDocs(x.documents).forEach(function(d, i){
        out.push({ key: "sf-" + x.id + "-" + i, source: "safety", type: "inspection", icon: "🔒", title: "בטיחות" + (d.label ? " (" + d.label + ")" : "") + " — " + (property || ""), property: property, date: x.created_at, url: d.url });
      });
    });

    // 7) Revenue-report attachments
    scopeRows(revRes.data ?? [], scope, function(r: any){ return r.contracts?.property_id; }).forEach(function(r: any){
      var m = r.report_month ? new Date(r.report_month) : null;
      var label = m ? (m.getMonth() + 1) + "/" + m.getFullYear() : "";
      out.push({
        key: "rv-" + r.id, source: "revenue", type: "revenue", icon: "📊",
        title: "דוח פדיון " + label + " — " + (r.contracts?.tenants?.name || ""),
        tenant: r.contracts?.tenants?.name, property: r.contracts?.properties?.name,
        url: r.attachment_url, size: r.attachment_size || undefined, date: r.report_month, contractId: r.contract_id,
      });
    });

    // ── Missing-docs tripwire ──
    // Active contracts without a scanned contract (no document_url and no
    // 'contract' upload linked) + active guarantees without any document.
    var hasContractUpload: Record<string, boolean> = {};
    uploads.forEach(function(d: any){ if (d.contract_id && (d.doc_type === "contract")) hasContractUpload[d.contract_id] = true; });
    var miss: Array<{ kind: string; label: string; contractId?: string; docType: string }> = [];
    scopedContracts.forEach(function(c: any){
      if (["active","expiring","extended"].indexOf(c.status) === -1) return;
      if (c.document_url || hasContractUpload[c.id]) return;
      miss.push({ kind: "חוזה ללא סריקה", label: (c.tenants?.name || "") + " — " + (c.properties?.name || ""), contractId: c.id, docType: "contract" });
    });
    scopeRows(guarRes.data ?? [], scope, function(g: any){ return g.contracts?.property_id; }).forEach(function(g: any){
      if (g.status !== "active") return;
      if (g.document_url || jsonbDocs(g.documents).length > 0) return;
      miss.push({ kind: "ערבות ללא מסמך", label: (g.contracts?.tenants?.name || "") + " — " + (g.contracts?.properties?.name || ""), contractId: g.contract_id, docType: "guarantee" });
    });
    setMissing(miss);

    // Newest first; undated last.
    out.sort(function(a, b){
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    setDocs(out);
    setLoading(false);
  }

  // Upload one or more files (file picker AND drag&drop share this). The
  // descriptive name applies to a single file; multi-file uploads use each
  // file's own name.
  async function uploadFiles(files: FileList | File[]) {
    var arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      for (var i = 0; i < arr.length; i++) {
        var file = arr[i];
        const path = `docs/${Date.now()}_${i}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
        const { data: doc, error: insErr } = await supabase.from("documents").insert({
          contract_id: fContractId || null,
          doc_type: fDocType,
          title: (arr.length === 1 && fName.trim()) ? fName.trim() : file.name,
          file_url: urlData.publicUrl,
          file_size: file.size,
        }).select().single();
        if (insErr) throw insErr;
        await logAudit({ entity_type: "document", entity_id: doc.id, action: "upload" });
      }
      setFName("");
      if (fileRef.current) fileRef.current.value = "";
      await loadAll();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setUploading(false); }
  }
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) await uploadFiles(e.target.files);
  }
  // Click on a missing-doc chip: pre-fill the upload form and scroll to it.
  function fillUploadFor(m: { contractId?: string; docType: string }) {
    setFContractId(m.contractId || "");
    setFDocType(m.docType);
    uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function handleDelete(d: VDoc) {
    if (!d.dbId) return;
    if (!confirm("למחוק את \"" + d.title + "\"?")) return;
    // Best-effort storage cleanup — extract the object path from the public URL.
    var marker = "/object/public/documents/";
    var at = d.url.indexOf(marker);
    if (at !== -1) {
      await supabase.storage.from("documents").remove([decodeURIComponent(d.url.slice(at + marker.length))]);
    }
    await supabase.from("documents").delete().eq("id", d.dbId);
    await logAudit({ entity_type: "document", entity_id: d.dbId, action: "delete" });
    await loadAll();
  }

  const filtered = docs.filter(function(d) {
    if (filterType !== "all" && d.type !== filterType) return false;
    if (filterContract && d.contractId !== filterContract) return false;
    if (search) {
      var q = search.toLowerCase();
      var hay = (d.title + " " + (d.tenant || "") + " " + (d.property || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  const totalSize = docs.reduce(function(s, d){ return s + (d.size ?? 0); }, 0);

  return (
    <div dir="rtl">
      <PageHero title="מסמכים" icon="📁" tone="slate"
        subtitle={docs.length + " מסמכים מכל המקורות" + (totalSize ? " | " + fmtSize(totalSize) + " הועלו" : "")} />

      {/* Missing-docs tripwire */}
      {missing.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4">
          <div className="text-sm font-bold text-amber-800 mb-2">⚠ {missing.length} מסמכים חסרים</div>
          <div className="flex flex-wrap gap-1.5">
            {missing.slice(0, 12).map(function(m, i){
              return (
                <button key={i} onClick={function(){ fillUploadFor(m); }}
                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100"
                  title="לחץ למילוי טופס ההעלאה עבור פריט זה">
                  {m.kind === "חוזה ללא סריקה" ? "📄" : "🏦"} {m.kind}: {m.label}
                </button>
              );
            })}
            {missing.length > 12 && <span className="text-xs text-amber-600 self-center">+{missing.length - 12} נוספים</span>}
          </div>
        </div>
      )}

      {/* Upload Area — also a drag&drop target */}
      <div ref={uploadRef}
        onDragOver={function(e){ e.preventDefault(); setDragOver(true); }}
        onDragLeave={function(){ setDragOver(false); }}
        onDrop={function(e){ e.preventDefault(); setDragOver(false); if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files); }}
        className={"rounded-xl border-2 border-dashed p-5 mb-5 transition-colors " + (dragOver ? "border-blue-500 bg-blue-100" : "border-blue-200 bg-blue-50")}>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">⬆️</span>
          <h2 className="font-bold text-slate-800 text-sm">העלאת מסמכים <span className="font-normal text-slate-400">— בחר קבצים או גרור לכאן</span></h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">חוזה (אופציונלי)</label>
            <select value={fContractId} onChange={function(e){ setFContractId(e.target.value); }}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white">
              <option value="">-- ללא חוזה --</option>
              {contracts.map(function(c){ return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>; })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">סוג מסמך</label>
            <select value={fDocType} onChange={function(e){ setFDocType(e.target.value); }}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white">
              {UPLOAD_TYPES.map(function(t){ return <option key={t.v} value={t.v}>{t.icon} {t.l}</option>; })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">שם תיאורי</label>
            <input type="text" value={fName} onChange={function(e){ setFName(e.target.value); }}
              placeholder="שם הקובץ..."
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white" />
          </div>
          <div className="flex flex-col justify-end">
            <label className={"w-full rounded-lg bg-blue-700 px-4 py-1.5 text-center text-xs font-bold text-white cursor-pointer hover:bg-blue-800 " + (uploading ? "opacity-50 pointer-events-none" : "")}>
              {uploading ? "⏳ מעלה..." : "📎 בחר קבצים"}
              <input ref={fileRef} type="file" multiple className="hidden" onChange={handleUpload} disabled={uploading}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.zip,.rar" />
            </label>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <input type="text" value={search} onChange={function(e){ setSearch(e.target.value); }}
          placeholder="חיפוש לפי שם / שוכר / נכס..."
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-56" />
        <select value={filterContract} onChange={function(e){ setFilterContract(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">כל החוזים</option>
          {contracts.map(function(c){ return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>; })}
        </select>
        {TYPE_CHIPS.map(function(f) {
          var n = f.v === "all" ? docs.length : docs.filter(function(d){ return d.type === f.v; }).length;
          if (n === 0 && f.v !== "all" && filterType !== f.v) return null;
          return (
            <button key={f.v} onClick={function(){ setFilterType(f.v); }}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterType === f.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
              {f.icon} {f.l} ({n})
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📁</div><div>אין מסמכים התואמים את הסינון</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(function(d) {
            return (
              <div key={d.key} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <span className="text-3xl shrink-0">{d.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm truncate" title={d.title}>{d.title}</div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <span className="text-xs text-slate-400">{chipInfo(d.type).l}</span>
                      {d.source !== "upload" && <span className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full px-1.5 py-0.5" title="מסמך המקושר לרשומה במערכת">🔗 מקושר</span>}
                      {d.size ? <span className="text-xs text-slate-400">| {fmtSize(d.size)}</span> : null}
                    </div>
                    {(d.tenant || d.property) && (
                      <div className="text-xs text-blue-600 mt-0.5 truncate">{d.tenant ? "👤 " + d.tenant : ""}{d.tenant && d.property ? " · " : ""}{d.property ? "🏢 " + d.property : ""}</div>
                    )}
                    {d.date && <div className="text-xs text-slate-400 mt-0.5">{fmtDate(d.date)}</div>}
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={function(){ setPreview(d); }}
                    className="flex-1 text-center text-xs border border-blue-200 rounded-lg py-1.5 text-blue-600 hover:bg-blue-50 font-semibold">
                    👁 צפה
                  </button>
                  <a href={d.url} target="_blank" rel="noreferrer"
                    className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50" title="פתח בלשונית חדשה">
                    ↗
                  </a>
                  {d.dbId && (
                    <button onClick={function(){ handleDelete(d); }}
                      className="text-xs border border-red-100 rounded-lg px-3 py-1.5 text-red-400 hover:bg-red-50">
                      🗑
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── In-app viewer ── */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setPreview(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden" onClick={function(e){ e.stopPropagation(); }} dir="rtl">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xl shrink-0">{preview.icon}</span>
                <span className="font-bold text-slate-800 text-sm truncate">{preview.title}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs border border-blue-200 rounded-lg px-3 py-1.5 text-blue-600 hover:bg-blue-50 font-semibold">↗ פתח בלשונית</a>
                <button onClick={function(){ setPreview(null); }} className="text-slate-400 hover:text-slate-600 text-xl px-1">✕</button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100 min-h-0">
              {isImage(preview.url) ? (
                <div className="w-full h-full flex items-center justify-center overflow-auto p-4">
                  <img src={preview.url} alt={preview.title} className="max-w-full max-h-full object-contain rounded-lg shadow" />
                </div>
              ) : (
                <iframe src={preview.url} title={preview.title} className="w-full h-full border-0" />
              )}
            </div>
            <div className="px-5 py-2 border-t border-slate-100 text-[11px] text-slate-400 shrink-0">
              אם המסמך לא נטען כאן (קישורי ענן מסוימים חוסמים הטמעה) — השתמש ב"פתח בלשונית".
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
