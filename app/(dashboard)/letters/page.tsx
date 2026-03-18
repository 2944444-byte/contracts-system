"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const LETTER_TYPES = [
  {v:"demand",    l:"מכתב דרישה",    icon:"⚠️"},
  {v:"notice",    l:"הודעה",          icon:"📢"},
  {v:"indexation",l:"עדכון הצמדה",  icon:"📈"},
  {v:"renewal",   l:"חידוש חוזה",   icon:"🔄"},
  {v:"other",     l:"אחר",           icon:"📄"},
];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

export default function LettersPage() {
  const [letters,   setLetters]   = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editingId, setEditingId] = useState("");
  const [preview,   setPreview]   = useState<any|null>(null);
  const [saving,    setSaving]    = useState(false);

  const [fContractId,setFContractId]=useState("");
  const [fType,      setFType]      =useState("notice");
  const [fSubject,   setFSubject]   =useState("");
  const [fBody,      setFBody]      =useState("");
  const [fTemplateId,setFTemplateId]=useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: l }, { data: c }, { data: t }] = await Promise.all([
      supabase.from("letters").select("*, contracts(tenants(name),properties(name))").order("created_at",{ascending:false}),
      supabase.from("contracts").select("id,tenants(name,contact_name),properties(name,address)").in("status",["active","expiring","extended"]),
      supabase.from("document_templates").select("*").eq("is_active",true).order("name"),
    ]);
    setLetters(l??[]); setContracts(c??[]); setTemplates(t??[]); setLoading(false);
  }

  function openNew() { setEditingId("new"); setFContractId(""); setFType("notice"); setFSubject(""); setFBody(""); setFTemplateId(""); }

  function fillTemplate(tid: string, cid: string) {
    const tpl=templates.find(function(t){return t.id===tid;});
    const con=contracts.find(function(c){return c.id===cid;});
    if (!tpl||!con) return;
    let body=tpl.body_template??"";
    body=body.replace(/\{\{tenant_name\}\}/g,con.tenants?.name??"").replace(/\{\{property_name\}\}/g,con.properties?.name??"").replace(/\{\{date\}\}/g,new Date().toLocaleDateString("he-IL"));
    setFBody(body);
  }

  async function handleSave() {
    if (!fContractId||!fSubject.trim()) { alert("חובה: חוזה + נושא"); return; }
    setSaving(true);
    try {
      const { data } = await supabase.from("letters").insert({contract_id:fContractId,letter_type:fType,subject:fSubject.trim(),body:fBody,template_id:fTemplateId||null,status:"draft"}).select().single();
      await logAudit({entity_type:"letter",entity_id:data.id,action:"create"});
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  function handlePrint(l: any) {
    const w=window.open("","_blank","width=800,height=900");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><style>body{font-family:Arial;padding:40px;direction:rtl}h2{border-bottom:2px solid #3b82f6;padding-bottom:8px}.body{line-height:1.8;white-space:pre-wrap}.footer{margin-top:40px;border-top:1px solid #e2e8f0;padding-top:12px;font-size:11px;color:#94a3b8}@media print{body{padding:20px}}</style></head><body><h2>${l.subject}</h2><div class="meta" style="color:#64748b;font-size:12px;margin-bottom:24px">תאריך: ${fmtDate(l.created_at)} | ${l.contracts?.tenants?.name} | ${l.contracts?.properties?.name}</div><div class="body">${l.body??""}</div><div class="footer">PropManager v4</div><script>window.print();<\/script></body></html>`);
    w.document.close();
  }

  async function deleteLetter(id: string) {
    if (!confirm("למחוק?")) return;
    await supabase.from("letters").delete().eq("id",id); await loadAll();
  }

  const typeInfo = function(v: string) { return LETTER_TYPES.find(function(t){return t.v===v;})??LETTER_TYPES[4]; };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div><h1 className="text-3xl font-bold text-slate-800">מכתבים</h1><p className="text-sm text-slate-500 mt-1">{letters.length} מכתבים</p></div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">+ מכתב חדש</button>
      </div>

      {loading ? <div className="text-center py-12 text-slate-400">טוען...</div> : letters.length===0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">✉️</div><div>אין מכתבים</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ מכתב חדש</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b"><tr><th className="px-4 py-3 font-semibold text-slate-700">נושא</th><th className="px-4 py-3 font-semibold text-slate-700">שוכר/נכס</th><th className="px-4 py-3 font-semibold text-slate-700">סוג</th><th className="px-4 py-3 font-semibold text-slate-700">תאריך</th><th className="px-4 py-3 font-semibold text-slate-700">פעולות</th></tr></thead>
            <tbody>
              {letters.map(function(l) {
                const ti=typeInfo(l.letter_type);
                return (
                  <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3"><div className="font-semibold text-slate-800">{l.subject}</div>{l.body&&<div className="text-xs text-slate-400 truncate max-w-xs">{l.body.substring(0,50)}...</div>}</td>
                    <td className="px-4 py-3"><div className="font-medium text-slate-700">{l.contracts?.tenants?.name}</div><div className="text-xs text-slate-400">{l.contracts?.properties?.name}</div></td>
                    <td className="px-4 py-3"><span className="text-base">{ti.icon}</span><span className="text-xs text-slate-500 mr-1">{ti.l}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={function(){setPreview(l);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">👁</button>
                        <button onClick={function(){handlePrint(l);}} className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50">🖨</button>
                        <button onClick={function(){deleteLetter(l.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">מכתב חדש</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                  <select value={fContractId} onChange={function(e){setFContractId(e.target.value);if(fTemplateId)fillTemplate(fTemplateId,e.target.value);}} className={ic}>
                    <option value="">-- בחר --</option>
                    {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;})}
                  </select>
                </div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">תבנית</label>
                  <select value={fTemplateId} onChange={function(e){setFTemplateId(e.target.value);if(fContractId)fillTemplate(e.target.value,fContractId);}} className={ic}>
                    <option value="">-- ללא --</option>
                    {templates.map(function(t){return <option key={t.id} value={t.id}>{t.name}</option>;})}
                  </select>
                </div>
              </div>
              <div><div className="flex gap-2 flex-wrap">
                {LETTER_TYPES.map(function(t){return <button key={t.v} type="button" onClick={function(){setFType(t.v);}} className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(fType===t.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>{t.icon} {t.l}</button>;})}
              </div></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">נושא *</label><input type="text" value={fSubject} onChange={function(e){setFSubject(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">תוכן</label><textarea value={fBody} onChange={function(e){setFBody(e.target.value);}} rows={10} className={ic+" font-mono text-xs"}/></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"שומר...":"שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setPreview(null);}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">{preview.subject}</h2>
              <div className="flex gap-2">
                <button onClick={function(){handlePrint(preview);}} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">🖨 הדפס</button>
                <button onClick={function(){setPreview(null);}} className="text-2xl text-slate-400">×</button>
              </div>
            </div>
            <div className="p-6">
              <div className="text-xs text-slate-400 mb-4">{fmtDate(preview.created_at)} | {preview.contracts?.tenants?.name}</div>
              <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-xl p-4 border">{preview.body??"אין תוכן"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
