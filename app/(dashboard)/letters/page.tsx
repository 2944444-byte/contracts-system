"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const LETTER_TYPES = [
  { value: "rent_demand",     label: "דרישת תשלום",      icon: "💰" },
  { value: "indexation",      label: "הודעת הצמדה",      icon: "📈" },
  { value: "option_notice",   label: "הודעת אופציה",     icon: "📋" },
  { value: "termination",     label: "הודעת סיום",       icon: "🔴" },
  { value: "general",         label: "כללי",             icon: "✉️" },
  { value: "warning",         label: "אזהרה",            icon: "⚠️" },
];

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function LettersPage() {
  const [letters,   setLetters]   = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editingId, setEditingId] = useState("");
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [preview,   setPreview]   = useState<any>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const [fContractId, setFContractId] = useState("");
  const [fType,       setFType]       = useState("general");
  const [fSubject,    setFSubject]    = useState("");
  const [fBody,       setFBody]       = useState("");
  const [fTemplateId, setFTemplateId] = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: l }, { data: c }, { data: t }] = await Promise.all([
      supabase.from("letters")
        .select("*, contracts(tenant_id, property_id, tenants(name, contact_email), properties(name))")
        .order("created_at", { ascending: false }),
      supabase.from("contracts")
        .select("id, tenants(name, contact_email, contact_name), properties(name)")
        .in("status", ["active","expiring","extended"]),
      supabase.from("document_templates").select("*").eq("is_active", true),
    ]);
    setLetters(l ?? []);
    setContracts(c ?? []);
    setTemplates(t ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFContractId(""); setFType("general"); setFSubject(""); setFBody(""); setFTemplateId("");
  }

  function openEdit(l: any) {
    setIsNew(false); setEditingId(l.id);
    setFContractId(l.contract_id ?? ""); setFType(l.letter_type ?? "general");
    setFSubject(l.subject ?? ""); setFBody(l.body ?? "");
  }

  function applyTemplate(templateId: string) {
    const t = templates.find(function(x) { return x.id === templateId; });
    if (!t) return;
    const c = contracts.find(function(x) { return x.id === fContractId; });
    let body = t.body_template ?? "";
    if (c) {
      body = body
        .replace(/\{\{tenant_name\}\}/g, c.tenants?.name ?? "")
        .replace(/\{\{property_name\}\}/g, c.properties?.name ?? "")
        .replace(/\{\{date\}\}/g, new Date().toLocaleDateString("he-IL"))
        .replace(/\{\{contact_name\}\}/g, c.tenants?.contact_name ?? "");
    }
    setFSubject(t.name ?? "");
    setFBody(body);
    setFTemplateId(templateId);
  }

  async function handleSave(send?: boolean) {
    if (!fContractId) { alert("חובה: חוזה"); return; }
    if (!fBody.trim()) { alert("חובה: תוכן המכתב"); return; }
    setSaving(true);
    try {
      const payload = {
        contract_id:  fContractId,
        letter_type:  fType,
        subject:      fSubject || null,
        body:         fBody,
        status:       send ? "sent" : "draft",
        sent_at:      send ? new Date().toISOString() : null,
      };
      let id = editingId;
      if (isNew) {
        const { data } = await supabase.from("letters").insert(payload).select().single();
        id = data.id;
        await logAudit({ entity_type: "letter", entity_id: id, action: "create" });
      } else {
        await supabase.from("letters").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "letter", entity_id: editingId, action: send ? "send" : "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק מכתב?")) return;
    await supabase.from("letters").delete().eq("id", id);
    await loadAll();
  }

  async function handleExportPDF(l: any) {
    const html = `
      <div class="header">
        <h1>${l.subject ?? 'מכתב'}</h1>
        <div class="meta">תאריך: ${fmtDate(l.created_at)} | שוכר: ${l.contracts?.tenants?.name ?? ''} | נכס: ${l.contracts?.properties?.name ?? ''}</div>
      </div>
      <div class="content">${l.body}</div>
      <div class="footer">PropManager v4 | הופק ב-${new Date().toLocaleDateString('he-IL')}</div>
    `;
    const res = await fetch('/api/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, filename: (l.subject ?? 'letter').replace(/[^a-zA-Z0-9]/g, '_') }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (l.subject ?? 'letter') + '.html';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint(l: any) {
    setPreview(l);
    setTimeout(function() {
      if (printRef.current) {
        const w = window.open("", "_blank");
        if (w) {
          w.document.write("<html dir='rtl'><head><title>" + (l.subject ?? "מכתב") + "</title>");
          w.document.write("<style>body{font-family:Arial,sans-serif;padding:40px;direction:rtl;} pre{white-space:pre-wrap;font-family:inherit;}</style></head><body>");
          w.document.write(printRef.current.innerHTML);
          w.document.write("</body></html>");
          w.document.close();
          w.print();
        }
      }
    }, 100);
  }

  const typeInfo = function(v: string) {
    return LETTER_TYPES.find(function(t) { return t.value === v; }) ?? LETTER_TYPES[4];
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">מכתבים</h1>
          <p className="text-sm text-slate-500 mt-1">
            {letters.filter(function(l) { return l.status === "sent"; }).length} נשלחו |{" "}
            {letters.filter(function(l) { return l.status === "draft"; }).length} טיוטות
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + מכתב חדש
        </button>
      </div>

      {/* רשימה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : letters.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">✉️</div>
          <div>אין מכתבים</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ צור מכתב</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">נושא / סוג</th>
                <th className="px-4 py-3 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold">תאריך</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {letters.map(function(l) {
                const ti = typeInfo(l.letter_type);
                return (
                  <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{ti.icon}</span>
                        <div>
                          <div className="font-semibold text-slate-800 truncate max-w-xs">{l.subject ?? ti.label}</div>
                          <div className="text-xs text-slate-400">{ti.label}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-700">{l.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{l.contracts?.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (l.status === "sent" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                        {l.status === "sent" ? "✓ נשלח" : "טיוטה"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={function() { handlePrint(l); }}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">
                          🖨 הדפס
                        </button>
                        <button onClick={function() { handleExportPDF(l); }}
                          className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50">
                          📄 PDF
                        </button>
                        <button onClick={function() { openEdit(l); }}
                          className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">
                          עריכה
                        </button>
                        <button onClick={function() { handleDelete(l.id); }}
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

      {/* Print preview div — hidden */}
      <div ref={printRef} style={{ display: "none" }}>
        {preview && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 30 }}>
              <h2>{preview.subject ?? ""}</h2>
              <p>{fmtDate(preview.created_at)}</p>
            </div>
            <div style={{ marginBottom: 20 }}>
              <strong>לכבוד:</strong> {preview.contracts?.tenants?.name}<br />
              <strong>נכס:</strong> {preview.contracts?.properties?.name}
            </div>
            <pre>{preview.body}</pre>
          </div>
        )}
      </div>

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "מכתב חדש" : "עריכת מכתב"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                  <select value={fContractId} onChange={function(e) { setFContractId(e.target.value); }} className={ic}>
                    <option value="">-- בחר חוזה --</option>
                    {contracts.map(function(c) { return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>; })}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סוג מכתב</label>
                  <select value={fType} onChange={function(e) { setFType(e.target.value); }} className={ic}>
                    {LETTER_TYPES.map(function(t) { return <option key={t.value} value={t.value}>{t.icon} {t.label}</option>; })}
                  </select>
                </div>
              </div>

              {templates.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">טעינה מתבנית</label>
                  <select value={fTemplateId}
                    onChange={function(e) { setFTemplateId(e.target.value); applyTemplate(e.target.value); }}
                    className={ic}>
                    <option value="">-- בחר תבנית --</option>
                    {templates.map(function(t) { return <option key={t.id} value={t.id}>{t.name}</option>; })}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נושא</label>
                <input type="text" value={fSubject} onChange={function(e) { setFSubject(e.target.value); }} className={ic} />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תוכן המכתב *</label>
                <textarea value={fBody} onChange={function(e) { setFBody(e.target.value); }}
                  rows={12} className={ic + " font-mono text-xs"} placeholder="תוכן המכתב..." />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
                  className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={function() { handleSave(false); }} disabled={saving}
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50">
                  {saving ? "..." : "💾 שמור טיוטה"}
                </button>
                <button onClick={function() { handleSave(true); }} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שולח..." : "✉️ שלח / סמן כנשלח"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
