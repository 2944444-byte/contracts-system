"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

const DOC_TYPES: Record<string, string> = {
  contract:    "חוזה",
  amendment:   "תיקון/נספח",
  insurance:   "ביטוח",
  safety:      "בטיחות",
  financial:   "פיננסי",
  letter:      "מכתב",
  other:       "אחר",
};

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function DocumentsPage() {
  const [documents, setDocuments]   = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [editingId, setEditingId]   = useState("");
  const [isNew, setIsNew]           = useState(false);
  const [saving, setSaving]         = useState(false);

  const [properties, setProperties] = useState<any[]>([]);
  const [tenants,    setTenants]    = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);

  // שדות
  const [docType,     setDocType]     = useState("contract");
  const [docTitle,    setDocTitle]    = useState("");
  const [docPropId,   setDocPropId]   = useState("");
  const [docTenantId, setDocTenantId] = useState("");
  const [docContractId, setDocContractId] = useState("");
  const [docFileUrl,  setDocFileUrl]  = useState("");
  const [docExtUrl,   setDocExtUrl]   = useState("");
  const [docNotes,    setDocNotes]    = useState("");

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [{ data: docs }, { data: props }, { data: tens }, { data: cons }] = await Promise.all([
      supabase.from("documents").select("*, properties(name), tenants(name), contracts(tenant_id, tenants(name), properties(name))").order("created_at", { ascending: false }),
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("tenants").select("id, name").order("name"),
      supabase.from("contracts").select("id, tenant_id, tenants(name), properties(name)").in("status",["active","expiring","extended"]),
    ]);
    setDocuments(docs ?? []);
    setProperties(props ?? []);
    setTenants(tens ?? []);
    setContracts(cons ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setDocType("contract"); setDocTitle(""); setDocPropId("");
    setDocTenantId(""); setDocContractId(""); setDocFileUrl("");
    setDocExtUrl(""); setDocNotes("");
  }

  function openEdit(d: any) {
    setIsNew(false); setEditingId(d.id);
    setDocType(d.doc_type ?? "other"); setDocTitle(d.title ?? "");
    setDocPropId(d.property_id ?? ""); setDocTenantId(d.tenant_id ?? "");
    setDocContractId(d.contract_id ?? ""); setDocFileUrl(d.file_url ?? "");
    setDocExtUrl(d.external_url ?? ""); setDocNotes(d.notes ?? "");
  }

  async function handleSave() {
    if (!docTitle.trim()) { alert("חובה: כותרת מסמך"); return; }
    setSaving(true);
    try {
      const payload = {
        doc_type: docType, title: docTitle.trim(),
        property_id: docPropId || null, tenant_id: docTenantId || null,
        contract_id: docContractId || null,
        file_url: docFileUrl || null, external_url: docExtUrl || null,
        notes: docNotes || null,
      };
      if (isNew) {
        await supabase.from("documents").insert(payload);
      } else {
        await supabase.from("documents").update(payload).eq("id", editingId);
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק מסמך זה?")) return;
    await supabase.from("documents").delete().eq("id", id);
    await loadAll();
  }

  const filtered = documents.filter(d => {
    const matchType   = typeFilter === "all" || d.doc_type === typeFilter;
    const matchSearch = !search || d.title?.includes(search) ||
      d.properties?.name?.includes(search) || d.tenants?.name?.includes(search);
    return matchType && matchSearch;
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">מסמכים</h1>
          <p className="text-sm text-slate-500 mt-1">{documents.length} מסמכים במערכת</p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + מסמך חדש
        </button>
      </div>

      {/* פילטרים */}
      <div className="mb-4 flex gap-3 flex-wrap">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="חיפוש..."
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 flex-1 min-w-48" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
          <option value="all">כל הסוגים</option>
          {Object.entries(DOC_TYPES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* רשימה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🗂</div>
          <div>{search ? "לא נמצאו מסמכים" : "אין מסמכים עדיין"}</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold">כותרת</th>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">נכס</th>
                <th className="px-4 py-3 font-semibold">שוכר</th>
                <th className="px-4 py-3 font-semibold">תאריך</th>
                <th className="px-4 py-3 font-semibold">קישור</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{d.title}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      {DOC_TYPES[d.doc_type] ?? d.doc_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{d.properties?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{d.tenants?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(d.created_at?.split("T")[0])}</td>
                  <td className="px-4 py-3">
                    {(d.external_url || d.file_url) ? (
                      <a href={d.external_url || d.file_url} target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs font-medium">פתח ↗</a>
                    ) : <span className="text-slate-300 text-xs">אין</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(d)}
                        className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">עריכה</button>
                      <button onClick={() => handleDelete(d.id)}
                        className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">מחיקה</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingId("")}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">{isNew ? "מסמך חדש" : "עריכת מסמך"}</h2>
              <button onClick={() => setEditingId("")} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">כותרת *</label>
                <input type="text" value={docTitle} onChange={e => setDocTitle(e.target.value)} className={ic} placeholder="שם המסמך" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג מסמך</label>
                <select value={docType} onChange={e => setDocType(e.target.value)} className={ic}>
                  {Object.entries(DOC_TYPES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
                  <select value={docPropId} onChange={e => setDocPropId(e.target.value)} className={ic}>
                    <option value="">—</option>
                    {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר</label>
                  <select value={docTenantId} onChange={e => setDocTenantId(e.target.value)} className={ic}>
                    <option value="">—</option>
                    {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה</label>
                <select value={docContractId} onChange={e => setDocContractId(e.target.value)} className={ic}>
                  <option value="">—</option>
                  {contracts.map(c => <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">קישור חיצוני (Dropbox/Drive)</label>
                <input type="url" value={docExtUrl} onChange={e => setDocExtUrl(e.target.value)} className={ic} placeholder="https://..." />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={docNotes} onChange={e => setDocNotes(e.target.value)} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingId("")} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
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
