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
      const { data } = await supabase.from("letters").insert({contract_id:fContractId,letter_type:fType,title:fSubject.trim(),content_json:JSON.stringify({body:fBody}),template_id:fTemplateId||null,status:"draft"}).select().single();
      await logAudit({entity_type:"letter",entity_id:data.id,action:"create"});
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  function handlePrint(l: any) {
    var title = l.title || l.subject || "מכתב";
    var bodyText = "";
    if (l.content_json) {
      var cj = typeof l.content_json === "string" ? JSON.parse(l.content_json) : l.content_json;
      bodyText = cj?.body || "";
    }
    bodyText = bodyText || l.body || "";

    // Parse the text into sections for professional formatting
    var sections = bodyText.split("═══════════════════════════════");
    var mainBody = (sections[0] || "").trim();
    var appendixBody = (sections[1] || "").trim();

    // Format main body: convert check table to HTML table
    var htmlMain = mainBody
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Convert checks table lines to HTML table
    var lines = htmlMain.split("\n");
    var inTable = false;
    var htmlLines: string[] = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.includes("המחאה") && line.includes("לתאריך") && line.includes("בסכום")) {
        inTable = true;
        htmlLines.push('<table class="checks"><thead><tr><th>המחאה</th><th>לתאריך</th><th>בסכום בש"ח</th></tr></thead><tbody>');
        continue;
      }
      if (line.match(/^─/) || line.trim() === "") { if (inTable && line.trim() === "") { continue; } if (!inTable) htmlLines.push("<br>"); continue; }
      if (inTable && line.match(/^\d+\t/)) {
        var parts = line.split("\t");
        htmlLines.push('<tr><td>' + parts[0] + '</td><td>' + (parts[1]||"") + '</td><td class="amount">' + (parts[2]||"") + '</td></tr>');
        continue;
      }
      if (inTable && line.includes("סה")) {
        htmlLines.push('</tbody><tfoot><tr><td colspan="2"><strong>סה"כ</strong></td><td class="amount total">' + line.replace(/.*סה"כ:?\s*/, "") + '</td></tr></tfoot></table>');
        inTable = false;
        continue;
      }
      if (inTable && !line.match(/^\d+\t/)) {
        htmlLines.push("</tbody></table>");
        inTable = false;
      }
      htmlLines.push(line + "<br>");
    }
    if (inTable) htmlLines.push("</tbody></table>");
    var htmlMainFormatted = htmlLines.join("\n");

    // Format appendix
    var htmlAppendix = "";
    if (appendixBody) {
      htmlAppendix = appendixBody
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>")
        .replace(/📐 (.+?)(<br>)/g, '<div class="unit-title">📐 $1</div>')
        .replace(/🅿️/g, "🅿️")
        .replace(/⬆/g, '<span style="color:#d97706">⬆</span>')
        .replace(/   /g, '&nbsp;&nbsp;&nbsp;');
    }

    var tenant = l.contracts?.tenants?.name || "";
    const w=window.open("","_blank","width=800,height=900");
    if (!w) return;
    w.document.write('<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><style>' +
      'body{font-family:"David","Arial","Helvetica";padding:40px 60px;direction:rtl;font-size:13px;line-height:1.6;color:#1e293b}' +
      'h1{text-align:center;font-size:18px;color:#1e40af;border-bottom:2px solid #3b82f6;padding-bottom:8px;margin-bottom:4px}' +
      '.meta{text-align:center;color:#64748b;font-size:11px;margin-bottom:30px}' +
      '.content{line-height:1.7;font-size:13px}' +
      '.checks{width:100%;border-collapse:collapse;margin:15px 0;font-size:12px}' +
      '.checks th{background:#1e40af;color:white;padding:8px 12px;text-align:right;font-weight:bold}' +
      '.checks td{padding:6px 12px;border-bottom:1px solid #e2e8f0}' +
      '.checks tr:nth-child(even){background:#f8fafc}' +
      '.checks .amount{font-weight:bold;color:#1e40af;font-family:monospace;direction:ltr;text-align:left}' +
      '.checks .total{font-size:14px;color:#059669;border-top:2px solid #059669}' +
      '.checks tfoot td{background:#f0fdf4;padding:10px 12px}' +
      '.appendix{margin-top:30px;border-top:2px solid #3b82f6;padding-top:15px}' +
      '.appendix h3{color:#1e40af;font-size:15px;margin-bottom:10px}' +
      '.unit-title{background:#eff6ff;border-right:3px solid #3b82f6;padding:6px 10px;margin:12px 0 6px 0;font-weight:bold;font-size:13px}' +
      '.footer{margin-top:40px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:9px;color:#94a3b8;text-align:center}' +
      '@media print{body{padding:15px 30px}.checks th{background:#1e40af !important;color:white !important;-webkit-print-color-adjust:exact}}' +
      '</style></head><body>' +
      '<h1>' + title + '</h1>' +
      '<div class="meta">' + tenant + ' | ' + fmtDate(l.created_at) + '</div>' +
      '<div class="content">' + htmlMainFormatted + '</div>' +
      (htmlAppendix ? '<div class="appendix"><h3>נספח א\' — פירוט חישוב מקדמות</h3>' + htmlAppendix + '</div>' : '') +
      '<div class="footer">PropManager v4</div>' +
      '<script>window.print();<\/script>' +
      '</body></html>');
    w.document.close();
  }

  async function deleteLetter(id: string) {
    if (!confirm("למחוק?")) return;
    await supabase.from("letters").delete().eq("id",id); await loadAll();
  }

  const typeInfo = function(v: string) { return LETTER_TYPES.find(function(t){return t.v===v;})??LETTER_TYPES[4]; };

  function handleEmail(l: any) {
    var title = l.title || l.subject || "מכתב";
    var tenant = l.contracts?.tenants?.name || "";
    var email = l.contracts?.tenants?.primary_email || "";
    var subject = encodeURIComponent(title);
    var emailBody = encodeURIComponent(
      "שלום " + tenant + ",\n\n" +
      "מצורף בזאת " + title + ".\n" +
      "נא לעיין ולפעול בהתאם.\n\n" +
      "בברכה,\n" +
      "הנהלת הנכס"
    );
    window.open("mailto:" + email + "?subject=" + subject + "&body=" + emailBody, "_self");
  }

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
                    <td className="px-4 py-3"><div className="font-semibold text-slate-800">{l.title || l.subject || "—"}</div></td>
                    <td className="px-4 py-3"><div className="font-medium text-slate-700">{l.contracts?.tenants?.name}</div><div className="text-xs text-slate-400">{l.contracts?.properties?.name}</div></td>
                    <td className="px-4 py-3"><span className="text-base">{ti.icon}</span><span className="text-xs text-slate-500 mr-1">{ti.l}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={function(){setPreview(l);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">👁</button>
                        <button onClick={function(){handlePrint(l);}} className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50">🖨</button>
                        <button onClick={function(){handleEmail(l);}} className="text-xs border border-green-200 rounded px-2 py-1 text-green-600 hover:bg-green-50">📧</button>
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
              <h2 className="font-bold text-slate-800">{preview.title || preview.subject || "מכתב"}</h2>
              <div className="flex gap-2">
                <button onClick={function(){handlePrint(preview);}} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">🖨 הדפס</button>
                <button onClick={function(){setPreview(null);}} className="text-2xl text-slate-400">×</button>
              </div>
            </div>
            <div className="p-6">
              <div className="text-xs text-slate-400 mb-4">{fmtDate(preview.created_at)} | {preview.contracts?.tenants?.name}</div>
              <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-xl p-4 border">{(typeof preview.content_json === "string" ? JSON.parse(preview.content_json)?.body : preview.content_json?.body) ?? preview.body ?? "אין תוכן"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
