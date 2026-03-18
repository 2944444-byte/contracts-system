"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function daysLeft(d: string) { return Math.ceil((new Date(d).getTime()-Date.now())/86400000); }
function fmtMoney(n: number) { return n ? "₪"+Math.round(n).toLocaleString() : "—"; }

export default function InsurancesPage() {
  const [buildingIns, setBuildingIns] = useState<any[]>([]);
  const [tenantIns,   setTenantIns]   = useState<any[]>([]);
  const [properties,  setProperties]  = useState<any[]>([]);
  const [contracts,   setContracts]   = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState<"building"|"tenant">("building");
  const [editingId,   setEditingId]   = useState("");
  const [isNew,       setIsNew]       = useState(false);
  const [saving,      setSaving]      = useState(false);

  // form
  const [fRefId,      setFRefId]      = useState("");
  const [fInsurer,    setFInsurer]    = useState("");
  const [fPolicyNum,  setFPolicyNum]  = useState("");
  const [fCoverage,   setFCoverage]   = useState("");
  const [fPremium,    setFPremium]    = useState("");
  const [fStartDate,  setFStartDate]  = useState("");
  const [fEndDate,    setFEndDate]    = useState("");
  const [fStatus,     setFStatus]     = useState("active");
  const [fNotes,      setFNotes]      = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: b }, { data: t }, { data: p }, { data: c }] = await Promise.all([
      supabase.from("insurances_building").select("*, properties(name)").order("end_date"),
      supabase.from("insurances_tenant").select("*, contracts(tenants(name), properties(name))").order("end_date"),
      supabase.from("properties").select("id,name").order("name"),
      supabase.from("contracts").select("id, tenants(name), properties(name)").in("status",["active","expiring","extended"]),
    ]);
    setBuildingIns(b ?? []);
    setTenantIns(t ?? []);
    setProperties(p ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFRefId(""); setFInsurer(""); setFPolicyNum(""); setFCoverage("");
    setFPremium(""); setFStartDate(""); setFEndDate(""); setFStatus("active"); setFNotes("");
  }

  function openEdit(ins: any) {
    setIsNew(false); setEditingId(ins.id);
    setFRefId(ins.property_id ?? ins.contract_id ?? "");
    setFInsurer(ins.insurer_name??""); setFPolicyNum(ins.policy_number??"");
    setFCoverage(ins.coverage_amount?.toString()??""); setFPremium(ins.annual_premium?.toString()??"");
    setFStartDate(ins.start_date?.split("T")[0]??""); setFEndDate(ins.end_date?.split("T")[0]??"");
    setFStatus(ins.status??"active"); setFNotes(ins.notes??"");
  }

  async function handleSave() {
    if (!fRefId) { alert("חובה: " + (activeTab==="building"?"נכס":"חוזה")); return; }
    setSaving(true);
    try {
      const table = activeTab==="building" ? "insurances_building" : "insurances_tenant";
      const refKey = activeTab==="building" ? "property_id" : "contract_id";
      const payload: any = {
        [refKey]: fRefId,
        insurer_name:    fInsurer||null,
        policy_number:   fPolicyNum||null,
        coverage_amount: fCoverage ? Number(fCoverage) : null,
        annual_premium:  fPremium  ? Number(fPremium)  : null,
        start_date:      fStartDate||null,
        end_date:        fEndDate||null,
        status:          fStatus,
        notes:           fNotes||null,
      };
      if (isNew) {
        const { data } = await supabase.from(table).insert(payload).select().single();
        await logAudit({ entity_type:"insurance", entity_id:data.id, action:"create" });
      } else {
        await supabase.from(table).update(payload).eq("id", editingId);
        await logAudit({ entity_type:"insurance", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק ביטוח?")) return;
    const table = activeTab==="building" ? "insurances_building" : "insurances_tenant";
    await supabase.from(table).delete().eq("id", id);
    await loadAll();
  }

  const list     = activeTab==="building" ? buildingIns : tenantIns;
  const expiring = list.filter(function(ins) { return ins.end_date && daysLeft(ins.end_date)<=60 && ins.status==="active"; });
  const expired  = list.filter(function(ins) { return ins.status==="expired"; });
  const active   = list.filter(function(ins) { return ins.status==="active"; });

  function InsRow({ ins }: { ins: any }) {
    const d = ins.end_date ? daysLeft(ins.end_date) : null;
    const rowBg = ins.status==="expired" ? "bg-red-50" : d!==null&&d<=30 ? "bg-orange-50" : d!==null&&d<=60 ? "bg-yellow-50" : "hover:bg-slate-50";
    const name  = activeTab==="building" ? ins.properties?.name : ins.contracts?.tenants?.name;
    const sub   = activeTab==="tenant"   ? ins.contracts?.properties?.name : null;
    return (
      <tr className={"border-t border-slate-100 " + rowBg}>
        <td className="px-4 py-3">
          <div className="font-semibold text-slate-800 text-sm">{name}</div>
          {sub && <div className="text-xs text-slate-400">{sub}</div>}
        </td>
        <td className="px-4 py-3 text-slate-700 text-sm">{ins.insurer_name||"—"}</td>
        <td className="px-4 py-3 text-xs font-mono text-slate-500">{ins.policy_number||"—"}</td>
        <td className="px-4 py-3">{fmtMoney(ins.coverage_amount)}</td>
        <td className="px-4 py-3">
          <div className="text-xs font-medium text-slate-700">{fmtDate(ins.end_date)}</div>
          {d!==null && d<=60 && ins.status==="active" && (
            <div className={"text-xs font-bold " + (d<=0?"text-red-600":d<=30?"text-orange-600":"text-yellow-600")}>
              {d<=0?"פג!":d+" יום"}
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
            (ins.status==="active"?"bg-green-100 text-green-700":ins.status==="expired"?"bg-red-100 text-red-700":"bg-slate-100 text-slate-600")}>
            {ins.status==="active"?"פעיל":ins.status==="expired"?"פג":"לא פעיל"}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-1">
            <button onClick={function(){openEdit(ins);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">✏️</button>
            <button onClick={function(){handleDelete(ins.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ביטוחים</h1>
          <p className="text-sm text-slate-500 mt-1">
            {active.length} פעילים
            {expiring.length>0 && <span className="text-yellow-600 font-semibold"> | {expiring.length} פגות ב-60י</span>}
            {expired.length>0 && <span className="text-red-600 font-semibold"> | {expired.length} פגו</span>}
          </p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + ביטוח חדש
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {[{v:"building",l:"🏢 ביטוח מבנה"},{v:"tenant",l:"👤 ביטוח שוכר"}].map(function(t) {
          return (
            <button key={t.v} onClick={function(){setActiveTab(t.v as any);}}
              className={"px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px " +
                (activeTab===t.v?"border-blue-600 text-blue-700":"border-transparent text-slate-500 hover:text-slate-700")}>
              {t.l}
              <span className="mr-2 text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5">
                {t.v==="building" ? buildingIns.length : tenantIns.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          {label:"פעילים",   value:active.length,    color:"text-green-700",  bg:"bg-green-50"},
          {label:"פגים ב-60",value:expiring.length,  color:"text-yellow-700", bg:expiring.length>0?"bg-yellow-50":"bg-white"},
          {label:"פגו",      value:expired.length,   color:"text-red-700",    bg:expired.length>0?"bg-red-50":"bg-white"},
        ].map(function(k) {
          return (
            <div key={k.label} className={"rounded-xl border border-slate-200 p-3 text-center " + k.bg}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🛡️</div><div>אין ביטוחים</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף ביטוח</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">{activeTab==="building"?"נכס":"שוכר"}</th>
                <th className="px-4 py-3 font-semibold text-slate-700">מבטח</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פוליסה</th>
                <th className="px-4 py-3 font-semibold text-slate-700">סכום כיסוי</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פקיעה</th>
                <th className="px-4 py-3 font-semibold text-slate-700">סטטוס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {list.map(function(ins) { return <InsRow key={ins.id} ins={ins} />; })}
            </tbody>
          </table>
        </div>
      )}

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew?"ביטוח חדש":"עריכת ביטוח"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  {activeTab==="building"?"נכס *":"חוזה *"}
                </label>
                <select value={fRefId} onChange={function(e){setFRefId(e.target.value);}} className={ic}>
                  <option value="">-- בחר --</option>
                  {activeTab==="building"
                    ? properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})
                    : contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;})
                  }
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חברת ביטוח</label>
                  <input type="text" value={fInsurer} onChange={function(e){setFInsurer(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר פוליסה</label>
                  <input type="text" value={fPolicyNum} onChange={function(e){setFPolicyNum(e.target.value);}} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום כיסוי (₪)</label>
                  <input type="number" value={fCoverage} onChange={function(e){setFCoverage(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">פרמיה שנתית (₪)</label>
                  <input type="number" value={fPremium} onChange={function(e){setFPremium(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תחילה</label>
                  <input type="date" value={fStartDate} onChange={function(e){setFStartDate(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">פקיעה</label>
                  <input type="date" value={fEndDate} onChange={function(e){setFEndDate(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}>
                  <option value="active">פעיל</option>
                  <option value="expired">פג</option>
                  <option value="inactive">לא פעיל</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving?"שומר...":"שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
