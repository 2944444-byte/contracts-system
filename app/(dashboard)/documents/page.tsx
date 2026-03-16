"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const DOC_TYPES = [
  { v: "contract",  l: "חוזה",           icon: "📄" },
  { v: "guarantee", l: "ערבות",           icon: "🏦" },
  { v: "insurance", l: "ביטוח",           icon: "🛡️" },
  { v: "safety",    l: "בטיחות",          icon: "🔒" },
  { v: "invoice",   l: "חשבונית",         icon: "🧾" },
  { v: "permit",    l: "היתר / רישיון",   icon: "📋" },
  { v: "other",     l: "אחר",             icon: "📁" },
];

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}
function fmtSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + " KB";
  return (bytes/1048576).toFixed(1) + " MB";
}

export default function DocumentsPage() {
  const [docs,       setDocs]       = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [search,     setSearch]     = useState("");

  const [fTitle,      setFTitle]      = useState("");
  const [fType,       setFType]       = useState("other");
  const [fContractId, setFContractId] = useState("");
  const [fPropertyId, setFPropertyId] = useState("");
  const [fFileUrl,    setFFileUrl]    = useState("");
  const [fFileName,   setFFileName]   = useState("");
  const [fNotes,      setFNotes]      = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: d }, { data: c }, { data: p }] = await Promise.all([
      supabase.from("documents")
        .select("*, contracts(tenants(name)), properties(name)")
        .order("created_at", { ascending: false }),
      supabase.from("contracts").select("id, tenants(name)").in("status",["active","expiring","extended"]),
      supabase.from("properties").select("id, name").order("name"),
    ]);
    setDocs(d ?? []);
    setContracts(c ?? []);
    setProperties(p ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFTitle(""); setFType("other"); setFContractId(""); setFPropertyId("");
    setFFileUrl(""); setFFileName(""); setFNotes("");
  }

  function openEdit(doc: any) {
    setIsNew(false); setEditingId(doc.id);
    setFTitle(doc.title ?? ""); setFType(doc.document_type ?? "other");
    setFContractId(doc.contract_id ?? ""); setFPropertyId(doc.property_id ?? "");
    setFFileUrl(doc.file_url ?? ""); setFFileName(doc.file_name ?? ""); setFNotes(doc.notes ?? "");
  }

  async function handleSave() {
    if (!fTitle.trim()) { alert("חובה: שם מסמך"); return; }
    setSaving(true);
    try {
      const payload = {
        title:         fTitle.trim(),
        document_type: fType,
        contract_id:   fContractId || null,
        property_id:   fPropertyId || null,
        file_url:      fFileUrl || null,
        file_name:     fFileName || null,
        notes:         fNotes || null,
      };
      if (isNew) {
        const { data } = await supabase.from("documents").insert(payload).select().single();
        await logAudit({ entity_type: "document", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("documents").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "document", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק מסמך?")) return;
    await supabase.from("documents").delete().eq("id", id);
    await loadAll();
  }

  // העלאת קובץ ל-Supabase Storage
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const path = `documents/${Date.now()}_${file.name.replace(/\s/g,"_")}`;
    const { data, error } = await supabase.storage.from("documents").upload(path, file);
    if (error) { alert("שגיאת העלאה: " + error.message); return; }
    const { data: url } = supabase.storage.from("documents").getPublicUrl(path);
    setFFileUrl(url.publicUrl);
    setFFileName(file.name);
  }

  const filtered = docs.filter(function(d) {
    const mt = filterType === "all" || d.document_type === filterType;
    const mq = !search || d.title?.includes(search) || d.file_name?.includes(search);
    return mt && mq;
  });

  const typeInfo = function(v: string) {
    return DOC_TYPES.find(function(t) { return t.v === v; }) ?? DOC_TYPES[6];
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">מסמכים</h1>
          <p className="text-sm text-slate-500 mt-1">{docs.length} מסמכים</p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + מסמך חדש
        </button>
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-5 flex-wrap">
        <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
          placeholder="חיפוש..." className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm" />
        <button onClick={function(){setFilterType("all");}}
          className={"rounded-xl border px-3 py-2 text-xs font-semibold " +
            (filterType === "all" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
          הכל ({docs.length})
        </button>
        {DOC_TYPES.map(function(t) {
          const cnt = docs.filter(function(d) { return d.document_type === t.v; }).length;
          if (!cnt) return null;
          return (
            <button key={t.v} onClick={function(){setFilterType(t.v);}}
              className={"rounded-xl border px-3 py-2 text-xs font-semibold " +
                (filterType === t.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
              {t.icon} {t.l} ({cnt})
            </button>
          );
        })}
      </div>

      {/* רשימה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📁</div>
          <div>אין מסמכים</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף מסמך</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(function(doc) {
            const ti = typeInfo(doc.document_type);
            return (
              <div key={doc.id} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{ti.icon}</span>
                    <div>
                      <div className="font-semibold text-slate-800 text-sm">{doc.title}</div>
                      <div className="text-xs text-slate-400">{ti.l}</div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noreferrer"
                        className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50">
                        📥
                      </a>
                    )}
                    <button onClick={function(){openEdit(doc);}}
                      className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">✏️</button>
                    <button onClick={function(){handleDelete(doc.id);}}
                      className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                  </div>
                </div>
                {doc.contracts?.tenants?.name && (
                  <div className="text-xs text-slate-500">👤 {doc.contracts.tenants.name}</div>
                )}
                {doc.properties?.name && (
                  <div className="text-xs text-slate-500">🏢 {doc.properties.name}</div>
                )}
                {doc.file_name && (
                  <div className="text-xs text-slate-400 mt-1 truncate">📎 {doc.file_name}</div>
                )}
                <div className="text-xs text-slate-300 mt-1">{fmtDate(doc.created_at)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "מסמך חדש" : "עריכת מסמך"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם מסמך *</label>
                <input type="text" value={fTitle} onChange={function(e){setFTitle(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג</label>
                <div className="grid grid-cols-4 gap-2">
                  {DOC_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFType(t.v);}}
                        className={"rounded-lg border p-2 text-center " +
                          (fType === t.v ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType === t.v ? "text-blue-700" : "text-slate-600")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה</label>
                  <select value={fContractId} onChange={function(e){setFContractId(e.target.value);}} className={ic}>
                    <option value="">-- ללא חוזה --</option>
                    {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name}</option>;})}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
                  <select value={fPropertyId} onChange={function(e){setFPropertyId(e.target.value);}} className={ic}>
                    <option value="">-- ללא נכס --</option>
                    {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
                  </select>
                </div>
              </div>
              {/* העלאת קובץ */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">העלאת קובץ</label>
                <input type="file" onChange={handleUpload}
                  className="w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-semibold hover:file:bg-blue-100" />
                {fFileName && <div className="text-xs text-green-600 mt-1">✅ {fFileName}</div>}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">או קישור URL</label>
                <input type="url" value={fFileUrl} onChange={function(e){setFFileUrl(e.target.value);}}
                  className={ic} placeholder="https://..." dir="ltr" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
