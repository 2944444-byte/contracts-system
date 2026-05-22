"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
function fmtMoney(n: number) { return (n && Math.abs(n) > 0.001) ? "₪"+n.toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; }
function fmtNum(n: number, dec=2) { return (n && Math.abs(n) > 0.001) ? n.toLocaleString("he-IL",{minimumFractionDigits:dec,maximumFractionDigits:dec}) : "—"; }

// Bucket created via migration add_attachment_to_revenue_reports.
// Public so the link in the row works directly without signing.
const REVENUE_BUCKET = "revenue_attachments";

const HEB_MONTHS = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function monthKey(year: number, m: number): string {
  return year + "-" + String(m).padStart(2, "0") + "-01";
}

export default function RevenuePage() {
  const currentYear = new Date().getFullYear();
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [reports,    setReports]    = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [saving,     setSaving]     = useState(false);

  // Primary filters: tenant (contract) + year — drives a 12-month breakdown table.
  const [selContractId, setSelContractId] = useState<string>("");
  const [selYear,       setSelYear]       = useState<number>(currentYear);

  // Modal state
  const [fContractId,  setFContractId]  = useState("");
  const [fMonth,       setFMonth]       = useState<string>(""); // YYYY-MM
  const [fGrossRevenue,setFGrossRevenue]=useState("");
  const [fNotes,       setFNotes]       =useState("");
  const [fFile,        setFFile]        = useState<File|null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks per-row "attaching" state (the small 📎 button on each existing report)
  const [rowAttaching, setRowAttaching] = useState<string>("");

  // Uploads a file to the revenue_attachments bucket and returns the metadata
  // that should be written onto the revenue_reports row. Throws on failure.
  async function uploadAttachment(file: File): Promise<{ url: string; path: string; name: string; size: number; type: string; }> {
    var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    var path = "revenue/" + Date.now() + "_" + safeName;
    var upRes = await supabase.storage.from(REVENUE_BUCKET).upload(path, file, { upsert: false });
    if (upRes.error) throw upRes.error;
    var urlRes = supabase.storage.from(REVENUE_BUCKET).getPublicUrl(path);
    return {
      url: urlRes.data.publicUrl,
      path: path,
      name: file.name,
      size: file.size,
      type: file.type || "",
    };
  }

  // Attaches a file to an existing row (the 📎 / 🔄 buttons in the table).
  async function attachToRow(rowId: string, file: File) {
    setRowAttaching(rowId);
    try {
      var existing = reports.find(function(r) { return r.id === rowId; });
      if (existing?.attachment_path) {
        await supabase.storage.from(REVENUE_BUCKET).remove([existing.attachment_path]);
      }
      var meta = await uploadAttachment(file);
      var { error } = await supabase.from("revenue_reports").update({
        attachment_url: meta.url, attachment_path: meta.path,
        attachment_name: meta.name, attachment_size: meta.size, attachment_type: meta.type,
      }).eq("id", rowId);
      if (error) throw error;
      await logAudit({ entity_type: "revenue", entity_id: rowId, action: existing?.attachment_url ? "replace_attachment" : "add_attachment" });
      await loadAll();
    } catch (e: any) { alert("שגיאה בהעלאה: " + (e?.message || e)); }
    finally { setRowAttaching(""); }
  }

  async function removeAttachment(row: any) {
    if (!row.attachment_url) return;
    if (!confirm("למחוק את הקובץ המצורף?")) return;
    try {
      if (row.attachment_path) {
        await supabase.storage.from(REVENUE_BUCKET).remove([row.attachment_path]);
      }
      await supabase.from("revenue_reports").update({
        attachment_url: null, attachment_path: null, attachment_name: null, attachment_size: null, attachment_type: null,
      }).eq("id", row.id);
      await logAudit({ entity_type: "revenue", entity_id: row.id, action: "remove_attachment" });
      await loadAll();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
  }

  async function deleteRow(row: any) {
    if (!confirm("למחוק את הדיווח של " + HEB_MONTHS[new Date(row.report_month).getMonth()+1] + " " + new Date(row.report_month).getFullYear() + "?")) return;
    try {
      if (row.attachment_path) {
        await supabase.storage.from(REVENUE_BUCKET).remove([row.attachment_path]);
      }
      await supabase.from("revenue_reports").delete().eq("id", row.id);
      await logAudit({ entity_type: "revenue", entity_id: row.id, action: "delete" });
      await loadAll();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
  }

  useEffect(function() { loadAll(); }, [selYear]);

  async function loadAll() {
    // Load all year's reports for ALL contracts so switching the tenant filter is instant.
    // The 12-month table reads from this in-memory set, filtered by selContractId.
    var yearStart = selYear + "-01-01";
    var yearEnd   = (selYear + 1) + "-01-01"; // exclusive — avoids the Feb-31 bug entirely
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("contracts").select("id,status,rent_type,revenue_pct,min_rent_per_sqm,charged_area,rent_per_sqm,investment_addition,vat_type,mgmt_fee_per_sqm,mgmt_included_in_revenue,tenants(name),properties(name)").in("status",["active","expiring","extended"]),
      supabase.from("revenue_reports").select("*,contracts(tenants(name),properties(name))").gte("report_month",yearStart).lt("report_month",yearEnd).order("report_month",{ascending:true}),
    ]);
    var revenueContracts = (c??[]).filter(function(x){return x.rent_type==="revenue_based"||x.revenue_pct;});
    setContracts(revenueContracts);
    setReports(r??[]);
    // Default-select the first revenue contract on first load
    if (!selContractId && revenueContracts.length > 0) setSelContractId(revenueContracts[0].id);
    setLoading(false);
  }

  // Pure calc: given a contract + raw gross revenue, returns the full breakdown.
  // When mgmt_included_in_revenue=true AND mgmt_fee_per_sqm>0, subtract the monthly
  // mgmt amount from gross so the % rent is computed off the *net* turnover —
  // matching how the property actually charges the tenant.
  function calcRent(contractId: string, grossRevenue: number) {
    const c = contracts.find(function(x){return x.id===contractId;});
    if (!c) return null;
    const pct       = c.revenue_pct ?? 0;
    const mgmtMonthly = (c.mgmt_included_in_revenue && c.mgmt_fee_per_sqm && c.charged_area)
      ? Number(c.mgmt_fee_per_sqm) * Number(c.charged_area)
      : 0;
    const netGross  = grossRevenue - mgmtMonthly;
    const calcRent_ = Math.max(netGross, 0) * (pct/100);
    const minRent   = (c.min_rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
    const finalRent = Math.max(calcRent_, minRent);
    const vat       = c.vat_type==="taxable" ? finalRent*0.18 : 0;
    return { pct, mgmtMonthly, netGross, calcRent: calcRent_, minRent, finalRent, vat, total: finalRent+vat, area: Number(c.charged_area) || 0 };
  }

  const previewCalc = fContractId && fGrossRevenue ? calcRent(fContractId, Number(fGrossRevenue)) : null;

  async function handleSave() {
    if (!fContractId||!fGrossRevenue||!fMonth) { alert("חובה: חוזה + חודש + הכנסה ברוטו"); return; }
    const calc = calcRent(fContractId, Number(fGrossRevenue));
    if (!calc) return;
    setSaving(true);
    try {
      // Upload first — if upload fails, fail the whole save so we don't write
      // a row that "claims" an attachment that never landed in storage.
      var attachmentMeta: any = null;
      if (fFile) attachmentMeta = await uploadAttachment(fFile);

      const { data } = await supabase.from("revenue_reports").insert({
        contract_id: fContractId, report_month: fMonth + "-01",
        gross_revenue: Number(fGrossRevenue), revenue_pct: calc.pct,
        calculated_rent: calc.calcRent, min_rent: calc.minRent,
        final_rent: calc.finalRent, notes: fNotes || null,
        attachment_url:  attachmentMeta?.url  ?? null,
        attachment_path: attachmentMeta?.path ?? null,
        attachment_name: attachmentMeta?.name ?? null,
        attachment_size: attachmentMeta?.size ?? null,
        attachment_type: attachmentMeta?.type ?? null,
      }).select().single();
      await logAudit({entity_type:"revenue",entity_id:data.id,action:"create"});
      closeModal();
      await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  function openNewFor(contractId: string, monthYM: string) {
    setEditingId("new");
    setFContractId(contractId);
    setFMonth(monthYM);
    setFGrossRevenue("");
    setFNotes("");
    setFFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeModal() {
    setEditingId(""); setFContractId(""); setFMonth(""); setFGrossRevenue(""); setFNotes(""); setFFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ─── Build the 12-month table for the selected tenant ───
  const selContract = contracts.find(function(c){return c.id===selContractId;});
  const tenantReports = reports.filter(function(r){return r.contract_id===selContractId;});
  const area = Number(selContract?.charged_area) || 0;
  const pctLabel = selContract?.revenue_pct ?? 0;
  const mgmtIncluded = !!selContract?.mgmt_included_in_revenue;
  const mgmtMonthly = (mgmtIncluded && selContract?.mgmt_fee_per_sqm && area)
    ? Number(selContract.mgmt_fee_per_sqm) * area : 0;

  // Map month → report
  const reportByMonth: Record<number, any> = {};
  tenantReports.forEach(function(r) {
    var m = new Date(r.report_month).getMonth() + 1;
    reportByMonth[m] = r;
  });

  // 12 month rows with running averages
  type MonthRow = {
    m: number;
    label: string;
    report?: any;
    gross: number;
    mgmtDeduct: number;
    net: number;
    calcRent: number;
    finalRent: number;
    rentPerSqm: number;
    cumAvgRentPerSqm: number;
  };
  var rows: MonthRow[] = [];
  var sumFinalSoFar = 0;
  var reportsSoFar = 0;
  for (var m = 1; m <= 12; m++) {
    var rep = reportByMonth[m];
    if (rep) {
      var gross = Number(rep.gross_revenue) || 0;
      // Re-derive the deduction from the contract so it matches current settings
      // even for rows saved before this feature shipped (which stored full gross).
      var monthMgmt = mgmtMonthly; // contract-derived, constant per year
      var net = Math.max(gross - monthMgmt, 0);
      var finalR = Number(rep.final_rent) || 0;
      var rps = area > 0 ? finalR / area : 0;
      sumFinalSoFar += finalR;
      reportsSoFar++;
      var avgRps = (reportsSoFar > 0 && area > 0) ? (sumFinalSoFar / reportsSoFar) / area : 0;
      rows.push({
        m, label: HEB_MONTHS[m] + " " + String(selYear).slice(-2),
        report: rep, gross, mgmtDeduct: monthMgmt, net, calcRent: Number(rep.calculated_rent)||0,
        finalRent: finalR, rentPerSqm: rps, cumAvgRentPerSqm: avgRps,
      });
    } else {
      rows.push({
        m, label: HEB_MONTHS[m] + " " + String(selYear).slice(-2),
        gross: 0, mgmtDeduct: 0, net: 0, calcRent: 0, finalRent: 0, rentPerSqm: 0,
        cumAvgRentPerSqm: (reportsSoFar > 0 && area > 0) ? (sumFinalSoFar / reportsSoFar) / area : 0,
      });
    }
  }

  // Year totals
  var totGross = rows.reduce(function(s,r){return s+r.gross;},0);
  var totMgmt  = rows.reduce(function(s,r){return s+r.mgmtDeduct;},0);
  var totNet   = rows.reduce(function(s,r){return s+r.net;},0);
  var totFinal = rows.reduce(function(s,r){return s+r.finalRent;},0);
  var avgRpsYear = (reportsSoFar > 0 && area > 0) ? (totFinal / reportsSoFar) / area : 0;

  // Year options — current year ± 5
  var yearOptions: number[] = [];
  for (var y = currentYear + 1; y >= currentYear - 5; y--) yearOptions.push(y);

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">שכ"ד פידיון</h1>
        <p className="text-sm text-slate-500 mt-1">{contracts.length} חוזי פידיון פעילים</p>
      </div>

      {/* Tenant + year filters */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר</label>
          <select value={selContractId} onChange={function(e){setSelContractId(e.target.value);}} className={ic}>
            <option value="">-- בחר שוכר --</option>
            {contracts.map(function(c){return (
              <option key={c.id} value={c.id}>
                {c.tenants?.name} — {c.properties?.name} ({c.revenue_pct}%)
              </option>
            );})}
          </select>
        </div>
        <div className="w-32">
          <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
          <select value={selYear} onChange={function(e){setSelYear(Number(e.target.value));}} className={ic}>
            {yearOptions.map(function(y){return <option key={y} value={y}>{y}</option>;})}
          </select>
        </div>
      </div>

      {/* Contract context bar */}
      {selContract && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
          <span><span className="text-slate-500">שטח:</span> <span className="font-semibold">{area} מ"ר</span></span>
          <span><span className="text-slate-500">% פידיון:</span> <span className="font-semibold">{pctLabel}%</span></span>
          {selContract.min_rent_per_sqm && (
            <span><span className="text-slate-500">מינ' למ"ר:</span> <span className="font-semibold">{fmtMoney(Number(selContract.min_rent_per_sqm))}</span></span>
          )}
          {mgmtIncluded && (
            <span className="rounded-md bg-amber-100 text-amber-900 px-2 py-0.5 font-semibold">
              ⚙️ ניהול כלול במחזור — מנוטרל אוטומטית
              {mgmtMonthly > 0 && <span className="text-amber-700"> ({fmtMoney(mgmtMonthly)}/חודש)</span>}
            </span>
          )}
          {!selContract.mgmt_fee_per_sqm && mgmtIncluded && (
            <span className="text-amber-700 text-[10px]">⚠ אין הגדרת mgmt_fee_per_sqm — בדוק את החוזה</span>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : contracts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📊</div><div>אין חוזי פידיון</div>
          <div className="text-xs mt-2">הגדר חוזי פידיון בעמוד חוזים</div>
        </div>
      ) : !selContractId ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400 text-sm">
          בחר שוכר כדי להציג את הדיווחים החודשיים
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 text-center">
              <div className="text-2xl font-black text-slate-700">{fmtMoney(totGross)}</div>
              <div className="text-xs text-slate-400 mt-1">מחזור ברוטו {selYear}</div>
            </div>
            {mgmtMonthly > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 shadow-sm p-4 text-center">
                <div className="text-2xl font-black text-amber-700">{fmtMoney(totMgmt)}</div>
                <div className="text-xs text-amber-700 mt-1">דמי ניהול בתוך המחזור</div>
              </div>
            )}
            <div className="rounded-xl border border-blue-200 bg-blue-50 shadow-sm p-4 text-center">
              <div className="text-2xl font-black text-blue-700">{fmtMoney(totFinal)}</div>
              <div className="text-xs text-blue-700 mt-1">שכ"ד סה"כ {selYear}</div>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 shadow-sm p-4 text-center">
              <div className="text-2xl font-black text-green-700">{fmtNum(avgRpsYear)}</div>
              <div className="text-xs text-green-700 mt-1">ממוצע שכ"ד למ"ר</div>
            </div>
          </div>

          {/* 12-month table */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-4">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-3 font-semibold text-slate-700">חודש</th>
                  <th className="px-3 py-3 font-semibold text-slate-700">מחזור ברוטו</th>
                  {mgmtMonthly > 0 && <th className="px-3 py-3 font-semibold text-amber-700">דמי ניהול</th>}
                  {mgmtMonthly > 0 && <th className="px-3 py-3 font-semibold text-slate-700">נטו מחזור</th>}
                  <th className="px-3 py-3 font-semibold text-slate-700">שכ"ד {pctLabel}%</th>
                  <th className="px-3 py-3 font-semibold text-slate-700">סופי</th>
                  <th className="px-3 py-3 font-semibold text-green-700">שכ"ד/מ"ר</th>
                  <th className="px-3 py-3 font-semibold text-slate-500">ממוצע מצטבר/מ"ר</th>
                  <th className="px-3 py-3 font-semibold text-slate-700">דיווח השוכר</th>
                  <th className="px-3 py-3 font-semibold text-slate-700"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(function(row) {
                  var isThisRowAttaching = row.report && rowAttaching === row.report.id;
                  var hasReport = !!row.report;
                  var hasAttachment = !!row.report?.attachment_url;
                  return (
                    <tr key={row.m} className={"border-t border-slate-100 " + (hasReport ? "hover:bg-slate-50" : "bg-slate-50/40 text-slate-400")}>
                      <td className="px-3 py-2.5 font-semibold whitespace-nowrap">{row.label}</td>
                      <td className="px-3 py-2.5 font-mono">{fmtMoney(row.gross)}</td>
                      {mgmtMonthly > 0 && <td className="px-3 py-2.5 font-mono text-amber-700">{row.mgmtDeduct > 0 ? "−" + fmtMoney(row.mgmtDeduct) : "—"}</td>}
                      {mgmtMonthly > 0 && <td className="px-3 py-2.5 font-mono">{fmtMoney(row.net)}</td>}
                      <td className="px-3 py-2.5 font-mono">{fmtMoney(row.calcRent)}</td>
                      <td className="px-3 py-2.5 font-mono font-black text-blue-700">{fmtMoney(row.finalRent)}</td>
                      <td className="px-3 py-2.5 font-mono text-green-700">{row.rentPerSqm > 0 ? fmtNum(row.rentPerSqm) : "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-slate-500 text-xs">{row.cumAvgRentPerSqm > 0 ? fmtNum(row.cumAvgRentPerSqm) : "—"}</td>
                      <td className="px-3 py-2.5">
                        {hasAttachment ? (
                          <div className="flex items-center gap-1">
                            <a
                              href={row.report.attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-700 hover:text-blue-900 underline truncate max-w-[120px]"
                              title={row.report.attachment_name || "הצג קובץ"}
                            >📎 {row.report.attachment_name || "קובץ"}</a>
                            <button
                              onClick={function(){
                                var inp = document.createElement("input");
                                inp.type = "file";
                                inp.accept = ".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf";
                                inp.onchange = function(e: any) { var f = e.target.files?.[0]; if (f) attachToRow(row.report.id, f); };
                                inp.click();
                              }}
                              disabled={isThisRowAttaching}
                              className="text-xs border border-slate-200 rounded px-1 py-0.5 text-slate-500 hover:bg-slate-50"
                              title="החלף קובץ"
                            >🔄</button>
                            <button
                              onClick={function(){ removeAttachment(row.report); }}
                              className="text-xs border border-red-100 rounded px-1 py-0.5 text-red-400 hover:bg-red-50"
                              title="מחק קובץ"
                            >🗑</button>
                          </div>
                        ) : hasReport ? (
                          <button
                            onClick={function(){
                              var inp = document.createElement("input");
                              inp.type = "file";
                              inp.accept = ".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf";
                              inp.onchange = function(e: any) { var f = e.target.files?.[0]; if (f) attachToRow(row.report.id, f); };
                              inp.click();
                            }}
                            disabled={isThisRowAttaching}
                            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50 disabled:opacity-50"
                            title="צרף דיווח מהשוכר"
                          >
                            {isThisRowAttaching ? "מעלה..." : "📎 צרף"}
                          </button>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {hasReport ? (
                          <button
                            onClick={function(){ deleteRow(row.report); }}
                            className="text-xs text-red-400 hover:text-red-600"
                            title="מחק דיווח"
                          >🗑 מחק</button>
                        ) : (
                          <button
                            onClick={function(){ openNewFor(selContractId, monthKey(selYear, row.m).slice(0,7)); }}
                            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-1 hover:bg-blue-50"
                          >+ הוסף</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <tr>
                  <td className="px-3 py-3 text-slate-700">סה"כ {selYear}</td>
                  <td className="px-3 py-3 font-mono text-slate-800">{fmtMoney(totGross)}</td>
                  {mgmtMonthly > 0 && <td className="px-3 py-3 font-mono text-amber-700">{fmtMoney(totMgmt)}</td>}
                  {mgmtMonthly > 0 && <td className="px-3 py-3 font-mono text-slate-800">{fmtMoney(totNet)}</td>}
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 font-mono font-black text-blue-700">{fmtMoney(totFinal)}</td>
                  <td className="px-3 py-3 font-mono text-green-700">{avgRpsYear > 0 ? fmtNum(avgRpsYear) : "—"}</td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Bottom "add report" button — user explicitly asked it be at the bottom */}
          <div className="flex justify-center mb-4">
            <button
              onClick={function(){
                // Default to current month if it's in the selected year, else January
                var defaultMonth = (selYear === currentYear)
                  ? (selYear + "-" + String(new Date().getMonth()+1).padStart(2,"0"))
                  : (selYear + "-01");
                openNewFor(selContractId || (contracts[0]?.id || ""), defaultMonth);
              }}
              className="rounded-lg bg-blue-700 px-6 py-3 font-bold text-white hover:bg-blue-800 shadow-sm"
            >
              + דיווח הכנסה
            </button>
          </div>
        </>
      )}

      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">דיווח הכנסה {fMonth && "— " + (HEB_MONTHS[Number(fMonth.split("-")[1])] + " " + fMonth.split("-")[0])}</h2>
              <button onClick={closeModal} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                  <select value={fContractId} onChange={function(e){setFContractId(e.target.value);}} className={ic}>
                    <option value="">-- בחר --</option>
                    {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name} ({c.revenue_pct}%)</option>;})}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חודש *</label>
                  <input type="month" value={fMonth} onChange={function(e){setFMonth(e.target.value);}} className={ic}/>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הכנסה ברוטו (₪) *</label>
                <input type="number" value={fGrossRevenue} onChange={function(e){setFGrossRevenue(e.target.value);}} className={ic} placeholder="לדוגמה: 500000"/>
              </div>
              {previewCalc && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm space-y-1.5">
                  <div className="font-bold text-blue-700 mb-2">חישוב אוטומטי</div>
                  <div className="flex justify-between text-xs"><span className="text-slate-500">הכנסה ברוטו</span><span className="font-medium">{fmtMoney(Number(fGrossRevenue))}</span></div>
                  {previewCalc.mgmtMonthly > 0 && (
                    <>
                      <div className="flex justify-between text-xs text-amber-700"><span>− דמי ניהול בתוך המחזור</span><span className="font-medium">−{fmtMoney(previewCalc.mgmtMonthly)}</span></div>
                      <div className="flex justify-between text-xs font-semibold border-t border-blue-200 pt-1"><span className="text-slate-700">נטו מחזור</span><span>{fmtMoney(previewCalc.netGross)}</span></div>
                    </>
                  )}
                  <div className="flex justify-between text-xs"><span className="text-slate-500">{`שכ"ד ${previewCalc.pct}%`}</span><span className="font-medium">{fmtMoney(previewCalc.calcRent)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-slate-500">מינימום</span><span className="font-medium">{fmtMoney(previewCalc.minRent)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-slate-500">מע"מ</span><span className="font-medium">{fmtMoney(previewCalc.vat)}</span></div>
                  <div className="flex justify-between font-black text-blue-800 text-base pt-2 border-t border-blue-200">
                    <span>שכ"ד סופי</span><span>{fmtMoney(previewCalc.finalRent)}</span>
                  </div>
                  {previewCalc.area > 0 && previewCalc.finalRent > 0 && (
                    <div className="flex justify-between text-xs text-green-700 pt-1"><span>שכ"ד למ"ר</span><span className="font-medium">{fmtNum(previewCalc.finalRent / previewCalc.area)}</span></div>
                  )}
                  {previewCalc.calcRent < previewCalc.minRent && previewCalc.minRent > 0 && (
                    <div className="text-xs text-orange-600 font-semibold">⚠️ פידיון נמוך ממינימום — יחויב מינימום</div>
                  )}
                </div>
              )}
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic}/></div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">📎 צרף דיווח מהשוכר (PDF / תמונה)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
                  onChange={function(e){ setFFile(e.target.files?.[0] || null); }}
                  className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                />
                {fFile && (
                  <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
                    <span>{fFile.name}</span>
                    <span className="text-slate-400">({(fFile.size/1024).toFixed(0)} KB)</span>
                    <button type="button" onClick={function(){setFFile(null); if (fileInputRef.current) fileInputRef.current.value="";}} className="text-red-500 hover:text-red-700">× הסר</button>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={closeModal} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving||!previewCalc} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"שומר...":"שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
