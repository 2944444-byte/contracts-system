"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const DOC_TYPES = [
  { value: "contract",       label: "חוזה שכירות",    icon: "📄" },
  { value: "appendix",       label: "נספח",           icon: "📎" },
  { value: "guarantee",      label: "ערבות",          icon: "🏦" },
  { value: "insurance",      label: "ביטוח",          icon: "🛡️" },
  { value: "correspondence", label: "התכתבות",        icon: "✉️" },
  { value: "legal",          label: "משפטי",          icon: "⚖️" },
  { value: "permit",         label: "היתר / רישיון",  icon: "📋" },
  { value: "other",          label: "אחר",            icon: "📁" },
];

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}
function fmtSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024*1024) return Math.round(bytes/1024) + " KB";
  return (bytes/1024/1024).toFixed(1) + " MB";
}

export default function DocumentsPage() {
  const [docs,       setDocs]       = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [uploading,  setUploading]  = useState(false);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [search,     setSearch]     = useState("");
  const [filterType, setFilterType] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const [fTitle,      setFTitle]      = useState("");
  const [fDocType,    setFDocType]    = useState("contract");
  const [fContractId, setFContractId] = useState("");
  const [fPropertyId, setFPropertyId] = useState("");
  const [fNotes,      setFNotes]      = useState("");
  const [fFile,       setFFile]       = useState<File|null>(null);
  const [fUrl,        setFUrl]        = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: d }, { data: c }, { data: p }] = await Promise.all([
      supabase.from("documents")
        .select("*, contracts(tenant_id, property_id, tenants(name), properties(name)), properties(name)")
        .order("created_at", { ascending: false }),
      supabase.from("contracts").select("id, tenants(name), properties(name)").in("status", ["active","expiring","extended"]),
      supabase.from("properties").select("id, name").order("name"),
    ]);
    setDocs(d ?? []);
    setContracts(c ?? []);
    setProperties(p ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFTitle(""); setFDocType("contract"); setFContractId("");
    setFPropertyId(""); setFNotes(""); setFFile(null); setFUrl("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function openEdit(d: any) {
    setIsNew(false); setEditingId(d.id);
    setFTitle(d.title ?? ""); setFDocType(d.document_type ?? "contract");
    setFContractId(d.contract_id ?? ""); setFPropertyId(d.property_id ?? "");
    setFNotes(d.notes ?? ""); setFFile(null); setFUrl(d.file_url ?? "");
  }

  async function handleSave() {
    if (!fTitle.trim()) { alert("חובה: כותרת מסמך"); return; }
    setSaving(true);
    try {
      let fileUrl = fUrl;
      let fileSize = null;
      let fileName = null;

      // העלאת קובץ ל-Supabase Storage אם נבחר
      if (fFile) {
        setUploading(true);
        const ext = fFile.name.split('.').pop();
        const path = `documents/${Date.now()}_${fFile.name}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from("documents")
          .upload(path, fFile, { upsert: true });
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
        fileUrl  = urlData.publicUrl;
        fileSize = fFile.size;
        fileName = fFile.name;
        setUploading(false);
      }

      const payload = {
        title:         fTitle.trim(),
        document_type: fDocType,
        contract_id:   fContractId || null,
        property_id:   fPropertyId || null,
        file_url:      fileUrl || null,
        file_size:     fileSize,
        file_name:     fileName,
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
    finally { setSaving(false); setUploading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק מסמך?")) return;
    await supabase.from("documents").delete().eq("id", id);
    await loadAll();
  }

  const filtered = docs.filter(function(d) {
    const mt = filterType === "all" || d.document_type === filterType;
    const ms = !search || d.title?.includes(search) ||
      d.contracts?.tenants?.name?.includes(search) ||
      d.properties?.name?.includes(search) ||
      d.contracts?.properties?.name?.includes(search);
    return mt && ms;
  });

  const typeInfo = function(v: string) {
    return DOC_TYPES.find(function(t) { return t.value === v; }) ?? DOC_TYPES[7];
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
      <div className="mb-4 flex gap-3 flex-wrap items-center">
        <input type="text" value={search} onChange={function(e) { setSearch(e.target.value); }}
          placeholder="🔍 חיפוש מסמך..." className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm w-56" />
        <div className="flex gap-1 flex-wrap">
          <button onClick={function() { setFilterType("all"); }}
            className={"rounded-lg border px-3 py-1.5 text-xs font-semibold " +
              (filterType === "all" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
            הכל ({docs.length})
          </button>
          {DOC_TYPES.map(function(t) {
            const cnt = docs.filter(function(d) { return d.document_type === t.value; }).length;
            if (!cnt) return null;
            return (
              <button key={t.value} onClick={function() { setFilterType(t.value); }}
                className={"rounded-lg border px-3 py-1.5 text-xs font-semibold " +
                  (filterType === t.value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
                {t.icon} {t.label} ({cnt})
              </button>
            );
          })}
        </div>
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
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">מסמך</th>
                <th className="px-4 py-3 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold">תאריך</th>
                <th className="px-4 py-3 font-semibold">גודל</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(d) {
                const ti = typeInfo(d.document_type);
                const entityName = d.contracts?.tenants?.name ??
                  d.contracts?.properties?.name ??
                  d.properties?.name ?? "—";
                return (
                  <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl shrink-0">{ti.icon}</span>
                        <div>
                          <div className="font-semibold text-slate-800">{d.title}</div>
                          <div className="text-xs text-slate-400">{ti.label}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{entityName}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(d.created_at)}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmtSize(d.file_size)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {d.file_url && (
                          <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700 font-semibold">
                            📥 פתח
                          </a>
                        )}
                        <button onClick={function() { openEdit(d); }}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">
                          עריכה
                        </button>
                        <button onClick={function() { handleDelete(d.id); }}
                          className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "מסמך חדש" : "עריכת מסמך"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">כותרת *</label>
                <input type="text" value={fTitle} onChange={function(e) { setFTitle(e.target.value); }}
                  className={ic} placeholder="לדוגמה: חוזה שכירות יהונתן בכור" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג מסמך</label>
                <div className="grid grid-cols-4 gap-2">
                  {DOC_TYPES.map(function(t) {
                    return (
                      <button key={t.value} type="button" onClick={function() { setFDocType(t.value); }}
                        className={"rounded-lg border p-2 text-center transition-all " +
                          (fDocType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fDocType === t.value ? "text-blue-700" : "text-slate-600")}>{t.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה קשור</label>
                  <select value={fContractId} onChange={function(e) { setFContractId(e.target.value); }} className={ic}>
                    <option value="">-- אין --</option>
                    {contracts.map(function(c) {
                      return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;
                    })}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">נכס קשור</label>
                  <select value={fPropertyId} onChange={function(e) { setFPropertyId(e.target.value); }} className={ic}>
                    <option value="">-- אין --</option>
                    {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">העלאת קובץ</label>
                <input ref={fileRef} type="file" onChange={function(e) { setFFile(e.target.files?.[0] ?? null); }}
                  className="w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png" />
                {fUrl && !fFile && (
                  <a href={fUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 block">
                    📎 קובץ קיים — לחץ לצפייה
                  </a>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">קישור חיצוני (URL)</label>
                <input type="url" value={fUrl} onChange={function(e) { setFUrl(e.target.value); }}
                  className={ic} placeholder="https://drive.google.com/..." />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving || uploading}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {uploading ? "מעלה קובץ..." : saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
