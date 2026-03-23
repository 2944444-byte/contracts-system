"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const FILE_ICONS: Record<string,string> = {
  pdf: "📄", doc: "📝", docx: "📝", xls: "📊", xlsx: "📊",
  jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️",
  zip: "🗜️", rar: "🗜️", default: "📎",
};

function getIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? FILE_ICONS.default;
}

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024*1024) return Math.round(bytes/1024) + " KB";
  return (bytes/(1024*1024)).toFixed(1) + " MB";
}

function fmtDate(d: string) {
  return d ? new Date(d).toLocaleDateString("he-IL") : "—";
}

const DOC_TYPES = [
  { v:"contract",    l:"חוזה",          icon:"📄" },
  { v:"guarantee",   l:"ערבות",         icon:"🏦" },
  { v:"insurance",   l:"ביטוח",         icon:"🛡️" },
  { v:"inspection",  l:"בדיקת בטיחות", icon:"🔒" },
  { v:"invoice",     l:"חשבונית",       icon:"🧾" },
  { v:"other",       l:"אחר",           icon:"📎" },
];

export default function DocumentsPage() {
  const [docs,      setDocs]      = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filterType,setFilterType]= useState("all");
  const [search,    setSearch]    = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [fContractId, setFContractId] = useState("");
  const [fDocType,    setFDocType]    = useState("contract");
  const [fName,       setFName]       = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: d }, { data: c }] = await Promise.all([
      supabase.from("documents")
        .select("*, contracts(tenants(name), properties(name))")
        .order("created_at", { ascending: false }),
      supabase.from("contracts")
        .select("id, tenants(name), properties(name)")
        .in("status",["active","expiring","extended","upcoming"]),
    ]);
    setDocs(d ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext  = file.name.split(".").pop();
      const path = `docs/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
      const { data: doc } = await supabase.from("documents").insert({
        contract_id:   fContractId || null,
        doc_type: fDocType,
        title:     fName.trim() || file.name,
        file_url:      urlData.publicUrl,
        file_size:     file.size,
        file_type:     file.type,
        file_url:  path,
      }).select().single();
      await logAudit({ entity_type:"document", entity_id:doc.id, action:"upload" });
      setFName(""); setFContractId(""); setFDocType("contract");
      if (fileRef.current) fileRef.current.value = "";
      await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setUploading(false); }
  }

  async function handleDelete(id: string, storagePath: string) {
    if (!confirm("למחוק מסמך?")) return;
    await supabase.storage.from("documents").remove([storagePath]);
    await supabase.from("documents").delete().eq("id", id);
    await logAudit({ entity_type:"document", entity_id:id, action:"delete" });
    await loadAll();
  }

  const filtered = docs.filter(function(d) {
    const mt = filterType==="all" || d.document_type===filterType;
    const ms = !search || d.file_name?.includes(search) || d.contracts?.tenants?.name?.includes(search);
    return mt && ms;
  });

  const typeInfo = function(v: string) {
    return DOC_TYPES.find(function(t){return t.v===v;}) ?? DOC_TYPES[5];
  };

  const totalSize = docs.reduce(function(s,d){return s+(d.file_size??0);},0);

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">מסמכים</h1>
          <p className="text-sm text-slate-500 mt-1">{docs.length} קבצים | {fmtSize(totalSize)}</p>
        </div>
      </div>

      {/* Upload Area */}
      <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 p-5 mb-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">⬆️</span>
          <h2 className="font-bold text-slate-800 text-sm">העלאת מסמך חדש</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">חוזה (אופציונלי)</label>
            <select value={fContractId} onChange={function(e){setFContractId(e.target.value);}}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white">
              <option value="">-- ללא חוזה --</option>
              {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;})}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">סוג מסמך</label>
            <select value={fDocType} onChange={function(e){setFDocType(e.target.value);}}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white">
              {DOC_TYPES.map(function(t){return <option key={t.v} value={t.v}>{t.icon} {t.l}</option>;})}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">שם תיאורי</label>
            <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}}
              placeholder="שם הקובץ..."
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white" />
          </div>
          <div className="flex flex-col justify-end">
            <label className={"w-full rounded-lg bg-blue-700 px-4 py-1.5 text-center text-xs font-bold text-white cursor-pointer hover:bg-blue-800 " + (uploading?"opacity-50 pointer-events-none":"")}>
              {uploading ? "⏳ מעלה..." : "📎 בחר קובץ"}
              <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} disabled={uploading}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.zip,.rar" />
            </label>
          </div>
        </div>
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
          placeholder="חיפוש..."
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
        {[{v:"all",l:"הכל"}, ...DOC_TYPES.map(function(t){return {v:t.v,l:t.icon+" "+t.l};})].map(function(f) {
          return (
            <button key={f.v} onClick={function(){setFilterType(f.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterType===f.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {f.l}
            </button>
          );
        })}
      </div>

      {/* רשימה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📁</div><div>אין מסמכים</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(function(d) {
            const ti = typeInfo(d.document_type);
            return (
              <div key={d.id} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <span className="text-3xl shrink-0">{getIcon(d.file_name??d.file_url??"")}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm truncate">{d.file_name}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-xs text-slate-400">{ti.icon} {ti.l}</span>
                      <span className="text-slate-200">|</span>
                      <span className="text-xs text-slate-400">{fmtSize(d.file_size)}</span>
                    </div>
                    {d.contracts?.tenants?.name && (
                      <div className="text-xs text-blue-600 mt-0.5 truncate">👤 {d.contracts.tenants.name}</div>
                    )}
                    <div className="text-xs text-slate-400 mt-0.5">{fmtDate(d.created_at)}</div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <a href={d.file_url} target="_blank" rel="noreferrer"
                    className="flex-1 text-center text-xs border border-blue-200 rounded-lg py-1.5 text-blue-600 hover:bg-blue-50 font-semibold">
                    👁 פתח
                  </a>
                  <a href={d.file_url} download
                    className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50">
                    ⬇
                  </a>
                  <button onClick={function(){handleDelete(d.id, d.storage_path);}}
                    className="text-xs border border-red-100 rounded-lg px-3 py-1.5 text-red-400 hover:bg-red-50">
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
