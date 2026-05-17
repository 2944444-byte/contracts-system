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

  // Listing filters + grouping
  const [search,       setSearch]       = useState("");
  const [filterYear,   setFilterYear]   = useState<string>("");
  const [filterType,   setFilterType]   = useState<string>("");
  const [filterProp,   setFilterProp]   = useState<string>("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  function toggleGroup(key: string) {
    setCollapsedGroups(function(prev) { return { ...prev, [key]: !prev[key] }; });
  }

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: l }, { data: c }, { data: t }] = await Promise.all([
      supabase.from("letters").select("*, contracts(tenants(name),properties(id,name))").order("created_at",{ascending:false}),
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
    var cj = l.content_json ? (typeof l.content_json === "string" ? JSON.parse(l.content_json) : l.content_json) : {};
    var bodyText = cj.body || l.body || "";
    var companyName = cj.companyName || "";
    var companyAddress = cj.companyAddress || "";
    var companyPhone = cj.companyPhone || "";
    var logoUrl = cj.logoUrl || "";
    var appendixRaw = cj.appendix || "";
    var tenant = l.contracts?.tenants?.name || cj.tenant || "";

    // Build header: logo + company name (both shown), then address small below
    var headerHtml = '<div class="header">';
    if (logoUrl) {
      headerHtml += '<img src="' + logoUrl + '" class="logo" id="company-logo">';
    }
    headerHtml += '<div class="company-name">' + companyName + '</div>';
    headerHtml += '</div>';
    var detailParts = [];
    if (companyAddress) detailParts.push(companyAddress);
    if (companyPhone) detailParts.push('טל: ' + companyPhone);
    if (detailParts.length > 0) {
      headerHtml += '<div class="company-details">' + detailParts.join(' | ') + '</div>';
    }

    // Parse body: convert checks table to HTML
    var bodyHtml = bodyText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    var lines = bodyHtml.split("\n");
    var htmlParts: string[] = [];
    var inTable = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { if (!inTable) htmlParts.push("<br>"); continue; }
      if (line.startsWith("הנדון:")) { htmlParts.push('<div class="subject">' + line + '</div>'); continue; }
      if (line.includes("המחאה") && line.includes("לתאריך")) {
        inTable = true;
        htmlParts.push('<table class="checks"><thead><tr><th>המחאה</th><th>לתאריך</th><th>בסכום בש"ח</th></tr></thead><tbody>');
        continue;
      }
      if (inTable && /^\d+\t/.test(line)) {
        var p = line.split("\t");
        htmlParts.push('<tr><td>' + p[0] + '</td><td>' + (p[1]||"") + '</td><td class="amount">' + (p[2]||"") + '</td></tr>');
        continue;
      }
      if (inTable && line.includes("סה\"כ")) {
        var totalVal = line.replace(/.*סה"כ:?\s*/, "");
        htmlParts.push('</tbody><tfoot><tr><td colspan="2"><strong>סה"כ</strong></td><td class="amount total">' + totalVal + '</td></tr></tfoot></table>');
        inTable = false;
        continue;
      }
      if (inTable && !/^\d+\t/.test(line)) { htmlParts.push("</tbody></table>"); inTable = false; }
      // Signature lines → align left
      if (line.includes("בכבוד רב") || line.includes("בברכה") || line === companyName.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")) {
        htmlParts.push('<p class="signature-line">' + line + '</p>');
      } else {
        htmlParts.push('<p>' + line + '</p>');
      }
    }
    if (inTable) htmlParts.push("</tbody></table>");

    // Parse appendix — two formats supported:
    //   1) NEW structured: SECTION / KV / TABLE_HEADER / TABLE_ROW / TABLE_FOOTER
    //      Used by combined letters (advances + CPI diff). Renders compact tables.
    //   2) LEGACY: UNIT_START / UNIT_END blocks. Renders per-unit/per-period cards.
    //      Still produced by AdvancesTab and older letters — kept for backward compat.
    var appendixHtml = "";
    function esc(s: string) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
    if (appendixRaw) {
      var hasStructured = /^\s*SECTION\|/m.test(appendixRaw);
      if (hasStructured) {
        // ─── NEW format ───
        appendixHtml = '<div class="appendix">';
        var lines = appendixRaw.split("\n");
        var inSection = false;
        var inTable = false;
        var inKvBlock = false;
        var pendingHeader = "";
        var closeTable = function() {
          if (inTable) { appendixHtml += '</tbody></table>'; inTable = false; }
        };
        var closeKv = function() {
          if (inKvBlock) { appendixHtml += '</div>'; inKvBlock = false; }
        };
        for (var li = 0; li < lines.length; li++) {
          var raw = lines[li];
          if (!raw.trim()) continue;
          var parts = raw.split("|");
          var tag = parts[0];
          if (tag === "SECTION") {
            closeTable(); closeKv();
            if (inSection) appendixHtml += '</div>'; // close prior section
            inSection = true;
            var sectionTitle = esc(parts[2] || "נספח");
            appendixHtml += '<div class="apx-section"><h3 class="apx-title">' + sectionTitle + '</h3>';
            continue;
          }
          if (tag === "KV") {
            closeTable();
            if (!inKvBlock) { appendixHtml += '<div class="apx-kv">'; inKvBlock = true; }
            appendixHtml += '<div class="apx-kv-row"><span class="apx-kv-label">' + esc(parts[1]) + '</span><span class="apx-kv-value">' + esc(parts[2]) + '</span></div>';
            continue;
          }
          if (tag === "TABLE_HEADER") {
            closeKv(); closeTable();
            appendixHtml += '<table class="apx-table"><thead><tr>';
            for (var hi = 1; hi < parts.length; hi++) appendixHtml += '<th>' + esc(parts[hi]) + '</th>';
            appendixHtml += '</tr></thead><tbody>';
            inTable = true;
            continue;
          }
          if (tag === "TABLE_ROW" && inTable) {
            appendixHtml += '<tr>';
            for (var ri = 1; ri < parts.length; ri++) appendixHtml += '<td>' + esc(parts[ri]) + '</td>';
            appendixHtml += '</tr>';
            continue;
          }
          if (tag === "TABLE_FOOTER" && inTable) {
            appendixHtml += '</tbody><tfoot><tr>';
            // Find the first non-empty cell as label (will span empties), last as value
            var label = "";
            var labelSpan = 1;
            var fi = 1;
            for (; fi < parts.length; fi++) {
              if (parts[fi]) { label = parts[fi]; break; }
            }
            // count empty cells after the label until last value
            var lastIdx = parts.length - 1;
            for (var ei = fi + 1; ei < lastIdx; ei++) {
              if (parts[ei] === "") labelSpan++;
              else break;
            }
            // Build: [label colspan=labelSpan+1] [remaining values...]
            var totalCols = parts.length - 1;
            var spanForLabel = totalCols - 1; // label takes all but last
            appendixHtml += '<td colspan="' + spanForLabel + '" class="apx-foot-label">' + esc(label) + '</td>';
            appendixHtml += '<td class="apx-foot-value">' + esc(parts[lastIdx]) + '</td>';
            appendixHtml += '</tr></tfoot></table>';
            inTable = false;
            continue;
          }
        }
        closeTable(); closeKv();
        if (inSection) appendixHtml += '</div>';
        appendixHtml += '</div>';
      } else {
        // ─── LEGACY UNIT_START format (advances-only letters from AdvancesTab) ───
        var isCpiDiff = (cj.body || "").includes("הפרשי הצמדה") || cj.body?.includes("נספח א'");
        var blocks = appendixRaw.split("UNIT_END").filter(Boolean);
        var appendixTitle = isCpiDiff ? "נספח א' — פירוט חישוב הפרשי הצמדה" : "נספח א' — פירוט חישוב מקדמות";
        appendixHtml = '<div class="appendix"><h3 class="apx-title">' + appendixTitle + '</h3>';
        blocks.forEach(function(block: string) {
          var match = block.match(/UNIT_START\|(.+?)\|(.+)/);
          if (!match) return;
          var header1 = match[1];
          var header2 = match[2].trim();
          var details = block.split("\n").filter(function(l) { return l && !l.includes("UNIT_START"); });
          var icon = isCpiDiff ? "📅" : "📐";
          var headerExtra = isCpiDiff ? "תשלום: " + header2 : header2 + ' מ"ר';
          appendixHtml += '<div class="unit-card"><div class="unit-header">' + icon + ' ' + header1 + ' | ' + headerExtra + '</div>';
          appendixHtml += '<div class="unit-details">';
          details.forEach(function(d: string) {
            d = d.trim();
            if (!d) return;
            appendixHtml += '<div class="detail-row">' + esc(d) + '</div>';
          });
          appendixHtml += '</div></div>';
        });
        appendixHtml += '</div>';
      }
    }

    const w=window.open("","_blank","width=800,height=1000");
    if (!w) return;
    w.document.write('<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><style>' +
      '@page{margin:12mm 18mm}' +
      'body{font-family:"David","Arial";padding:0;direction:rtl;font-size:11.5px;line-height:1.4;color:#1e293b;margin:0}' +
      '.page{padding:0 30px}' +
      '.header{text-align:center;margin-bottom:3px;display:flex;align-items:center;justify-content:center;gap:12px}' +
      '.logo{max-height:55px;max-width:120px}' +
      '.company-name{font-size:20px;font-weight:bold;color:#1e3a5f}' +
      '.company-details{text-align:center;font-size:10px;color:#64748b;margin-bottom:10px;border-bottom:2px solid #1e3a5f;padding-bottom:6px}' +
      '.date{text-align:left;font-size:10px;color:#64748b;margin-bottom:8px}' +
      'p{margin:2px 0;font-size:12px}' +
      '.subject{text-align:center;font-weight:bold;font-size:14px;margin:10px 0;text-decoration:underline}' +
      '.checks{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}' +
      '.checks th{background:#1e3a5f;color:white;padding:5px 10px;text-align:right}' +
      '.checks td{padding:3px 10px;border-bottom:1px solid #e2e8f0}' +
      '.checks tr:nth-child(even){background:#f8fafc}' +
      '.checks .amount{font-weight:bold;color:#1e3a5f;direction:ltr;text-align:left}' +
      '.checks .total{font-size:12px;color:#059669;border-top:2px solid #059669}' +
      '.checks tfoot td{background:#f0fdf4;padding:5px 10px}' +
      '.appendix{page-break-before:always;padding:15px 30px 0}' +
      '.appendix h3,.apx-title{color:#1e3a5f;font-size:15px;border-bottom:2px solid #1e3a5f;padding-bottom:5px;margin:0 0 10px 0}' +
      '.apx-section{margin-bottom:18px;page-break-inside:avoid}' +
      '.apx-section+.apx-section{page-break-before:auto;margin-top:18px}' +
      '.apx-kv{display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 0 10px 0;font-size:11px;background:#f8fafc;border-radius:6px;padding:8px 12px}' +
      '.apx-kv-row{display:flex;gap:6px}' +
      '.apx-kv-label{color:#64748b}' +
      '.apx-kv-value{font-weight:bold;color:#1e3a5f}' +
      '.apx-table{width:100%;border-collapse:collapse;margin:6px 0;font-size:10.5px}' +
      '.apx-table th{background:#1e3a5f;color:white;padding:5px 6px;text-align:right;font-weight:bold;white-space:nowrap}' +
      '.apx-table td{padding:4px 6px;border-bottom:1px solid #e2e8f0;color:#334155}' +
      '.apx-table tbody tr:nth-child(even){background:#f8fafc}' +
      '.apx-table tfoot td{background:#f0fdf4;padding:6px;border-top:2px solid #059669;font-weight:bold;color:#059669}' +
      '.apx-foot-label{text-align:right}' +
      '.apx-foot-value{text-align:left;direction:ltr}' +
      '.unit-card{border:1px solid #e2e8f0;border-radius:8px;margin:10px 0;overflow:hidden}' +
      '.unit-header{background:#eff6ff;border-right:4px solid #3b82f6;padding:8px 12px;font-weight:bold;font-size:13px;color:#1e3a5f}' +
      '.unit-details{padding:8px 15px;font-size:11px;line-height:1.8}' +
      '.detail-row{color:#334155}' +
      '.signature-line{text-align:left;margin:2px 0}' +
      '.footer-bar{margin-top:30px;border-top:1px solid #cbd5e1;padding-top:6px;text-align:center;font-size:9px;color:#94a3b8}' +
      '@media print{.checks th,.apx-table th{background:#1e3a5f !important;color:white !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.unit-header{background:#eff6ff !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.checks tr:nth-child(even),.apx-table tbody tr:nth-child(even){background:#f8fafc !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.checks tfoot td,.apx-table tfoot td{background:#f0fdf4 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.apx-kv{background:#f8fafc !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
      '</style></head><body><div class="page">' +
      headerHtml +
      '<div class="date">' + fmtDate(l.created_at) + '</div>' +
      '<div class="content">' + htmlParts.join("\n") + '</div>' +
      '</div>' +
      appendixHtml +
      '<div class="footer-bar">' + (companyAddress ? companyAddress + ' | ' : '') + (companyPhone ? 'טל: ' + companyPhone : '') + '</div>' +
      '<script>' +
      'function doPrint(){window.print();}' +
      'var img = document.getElementById("company-logo");' +
      'if (img) { if (img.complete) doPrint(); else { img.onload = doPrint; img.onerror = doPrint; setTimeout(doPrint, 3000); } } else { setTimeout(doPrint, 200); }' +
      '<\/script>' +
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
      ) : (() => {
        // ─── Build filter options + apply filters ───
        var allYears: number[] = [];
        var allProps: Record<string, string> = {};
        letters.forEach(function(l: any) {
          var y = l.billing_year || (l.created_at ? new Date(l.created_at).getFullYear() : 0);
          if (y && allYears.indexOf(y) === -1) allYears.push(y);
          var pid = l.property_id || l.contracts?.properties?.id || "";
          var pname = l.contracts?.properties?.name || "ללא נכס";
          if (pid || pname) allProps[pid || pname] = pname;
        });
        allYears.sort(function(a, b) { return b - a; });

        var filtered = letters.filter(function(l: any) {
          if (filterType && l.letter_type !== filterType) return false;
          var ly = l.billing_year || (l.created_at ? new Date(l.created_at).getFullYear() : 0);
          if (filterYear && String(ly) !== filterYear) return false;
          var pid = l.property_id || l.contracts?.properties?.id || "";
          var pname = l.contracts?.properties?.name || "ללא נכס";
          if (filterProp && (pid || pname) !== filterProp) return false;
          if (search) {
            var q = search.toLowerCase();
            var hay = ((l.title || "") + " " + (l.contracts?.tenants?.name || "") + " " + (l.contracts?.properties?.name || "")).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
          }
          return true;
        });

        // Group by property
        var groups: Record<string, { name: string; key: string; items: any[] }> = {};
        filtered.forEach(function(l: any) {
          var pid = l.property_id || l.contracts?.properties?.id || "";
          var pname = l.contracts?.properties?.name || "ללא נכס";
          var key = pid || pname;
          if (!groups[key]) groups[key] = { name: pname, key: key, items: [] };
          groups[key].items.push(l);
        });
        var groupList = Object.values(groups).sort(function(a, b) { return a.name.localeCompare(b.name, "he"); });

        return (
          <>
            {/* Filter bar */}
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <input
                  type="text"
                  value={search}
                  onChange={function(e){setSearch(e.target.value);}}
                  placeholder="🔍 חיפוש לפי נושא / שוכר / נכס"
                  className={ic}
                />
              </div>
              <select value={filterYear} onChange={function(e){setFilterYear(e.target.value);}} className={ic + " w-32"}>
                <option value="">📅 שנה: הכל</option>
                {allYears.map(function(y){ return <option key={y} value={String(y)}>{y}</option>; })}
              </select>
              <select value={filterType} onChange={function(e){setFilterType(e.target.value);}} className={ic + " w-40"}>
                <option value="">📋 סוג: הכל</option>
                {LETTER_TYPES.map(function(t){ return <option key={t.v} value={t.v}>{t.icon} {t.l}</option>; })}
              </select>
              <select value={filterProp} onChange={function(e){setFilterProp(e.target.value);}} className={ic + " w-44"}>
                <option value="">🏢 נכס: הכל</option>
                {Object.keys(allProps).map(function(k){ return <option key={k} value={k}>{allProps[k]}</option>; })}
              </select>
              {(search||filterYear||filterType||filterProp) && (
                <button onClick={function(){setSearch("");setFilterYear("");setFilterType("");setFilterProp("");}} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 border border-slate-200 rounded">✕ נקה</button>
              )}
              <div className="text-xs text-slate-500 mr-auto">
                {filtered.length} מתוך {letters.length}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-8 text-center text-slate-400 text-sm">
                לא נמצאו מכתבים התואמים את הסינון
              </div>
            ) : (
              <div className="space-y-3">
                {groupList.map(function(g) {
                  var collapsed = !!collapsedGroups[g.key];
                  return (
                    <div key={g.key} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                      <button
                        onClick={function(){toggleGroup(g.key);}}
                        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-right"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🏢</span>
                          <span className="font-bold text-slate-800">{g.name}</span>
                          <span className="text-xs text-slate-500">— {g.items.length} מכתבים</span>
                        </div>
                        <span className="text-slate-400 text-sm">{collapsed ? "▶" : "▼"}</span>
                      </button>
                      {!collapsed && (
                        <table className="w-full text-right text-sm">
                          <tbody>
                            {g.items.map(function(l: any) {
                              const ti = typeInfo(l.letter_type);
                              return (
                                <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                                  <td className="px-4 py-2.5 w-10 text-base">{ti.icon}</td>
                                  <td className="px-2 py-2.5">
                                    <div className="font-semibold text-slate-800">{l.title || "—"}</div>
                                    <div className="text-xs text-slate-500">{l.contracts?.tenants?.name}</div>
                                  </td>
                                  <td className="px-2 py-2.5 text-xs text-slate-500 whitespace-nowrap w-24">{fmtDate(l.created_at)}</td>
                                  <td className="px-4 py-2.5 w-44">
                                    <div className="flex gap-1 justify-end">
                                      <button onClick={function(){setPreview(l);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50" title="תצוגה">👁</button>
                                      <button onClick={function(){handlePrint(l);}} className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50" title="הדפסה">🖨</button>
                                      <button onClick={function(){handleEmail(l);}} className="text-xs border border-green-200 rounded px-2 py-1 text-green-600 hover:bg-green-50" title="אימייל">📧</button>
                                      <button onClick={function(){deleteLetter(l.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50" title="מחק">🗑</button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

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
