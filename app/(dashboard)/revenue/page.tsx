"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL",{month:"short",year:"numeric"}) : "—"; }
function fmtMoney(n: number) { return n ? "₪"+Math.round(n).toLocaleString() : "—"; }

export default function RevenuePage() {
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [reports,    setReports]    = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [saving,     setSaving]     = useState(false);
  const [selMonth,   setSelMonth]   = useState(new Date().toISOString().slice(0,7));

  const [fContractId,  setFContractId]  = useState("");
  const [fGrossRevenue,setFGrossRevenue]=useState("");
  const [fNotes,       setFNotes]       =useState("");

  useEffect(function() { loadAll(); }, [selMonth]);

  async function loadAll() {
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("contracts").select("id,status,rent_type,revenue_pct,min_rent_per_sqm,charged_area,rent_per_sqm,investment_addition,vat_type,tenants(name),properties(name)").in("status",["active","expiring","extended"]),
      supabase.from("revenue_reports").select("*,contracts(tenants(name),properties(name))").gte("report_month",selMonth+"-01").lte("report_month",selMonth+"-31").order("created_at",{ascending:false}),
    ]);
    setContracts((c??[]).filter(function(x){return x.rent_type==="revenue_based"||x.revenue_pct;}));
    setReports(r??[]);
    setLoading(false);
  }

  function calcRent(contractId: string, grossRevenue: number) {
    const c = contracts.find(function(x){return x.id===contractId;});
    if (!c) return null;
    const pct         = c.revenue_pct ?? 0;
    const calcRent_   = grossRevenue * (pct/100);
    const minRent     = (c.min_rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
    const finalRent   = Math.max(calcRent_, minRent);
    const vat         = c.vat_type==="taxable" ? finalRent*0.18 : 0;
    return { pct, calcRent: calcRent_, minRent, finalRent, vat, total: finalRent+vat };
  }

  const preview = fContractId && fGrossRevenue ? calcRent(fContractId, Number(fGrossRevenue)) : null;

  async function handleSave() {
    if (!fContractId||!fGrossRevenue) { alert("חובה: חוזה + הכנסה ברוטו"); return; }
    const calc = calcRent(fContractId, Number(fGrossRevenue));
    if (!calc) return;
    setSaving(true);
    try {
      const c = contracts.find(function(x){return x.id===fContractId;});
      const { data } = await supabase.from("revenue_reports").insert({
        contract_id:fContractId, report_month:selMonth+"-01",
        gross_revenue:Number(fGrossRevenue), revenue_pct:calc.pct,
        calculated_rent:calc.calcRent, min_rent:calc.minRent,
        final_rent:calc.finalRent, notes:fNotes||null,
      }).select().single();
      await logAudit({entity_type:"revenue",entity_id:data.id,action:"create"});
      setEditingId(""); setFContractId(""); setFGrossRevenue(""); setFNotes("");
      await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  const totalFinal = reports.reduce(function(s,r){return s+(r.final_rent??0);},0);
  const totalGross = reports.reduce(function(s,r){return s+(r.gross_revenue??0);},0);

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">שכ"ד פידיון</h1>
          <p className="text-sm text-slate-500 mt-1">{contracts.length} חוזי פידיון | {selMonth}</p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="month" value={selMonth} onChange={function(e){setSelMonth(e.target.value);}}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"/>
          <button onClick={function(){setEditingId("new");setFContractId("");setFGrossRevenue("");setFNotes("");}}
            className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800">
            + דיווח הכנסה
          </button>
        </div>
      </div>

      {/* KPI */}
      {reports.length>0&&(
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            {l:"הכנסה ברוטו סה\"כ", v:fmtMoney(totalGross), c:"text-slate-700"},
            {l:"שכ\"ד פידיון סה\"כ", v:fmtMoney(totalFinal), c:"text-blue-700"},
            {l:"% ממוצע",           v:totalGross>0 ? (totalFinal/totalGross*100).toFixed(1)+"%" : "—", c:"text-green-700"},
          ].map(function(k){return (
            <div key={k.l} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 text-center">
              <div className={"text-2xl font-black "+k.c}>{k.v}</div>
              <div className="text-xs text-slate-400">{k.l}</div>
            </div>
          );})}
        </div>
      )}

      {/* חוזי פידיון */}
      {contracts.length>0&&(
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 mb-5">
          <div className="text-xs font-bold text-blue-700 mb-2">חוזי פידיון פעילים</div>
          <div className="flex flex-wrap gap-2">
            {contracts.map(function(c){return (
              <div key={c.id} className="rounded-lg bg-white border border-blue-200 px-3 py-1.5 text-xs">
                <span className="font-semibold text-slate-800">{c.tenants?.name}</span>
                <span className="text-slate-400 mr-1">— {c.revenue_pct??0}% | מינימום {fmtMoney((c.min_rent_per_sqm??0)*(c.charged_area??0))}</span>
              </div>
            );})}
          </div>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-slate-400">טוען...</div> : reports.length===0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📊</div><div>אין דיווחי הכנסה לחודש זה</div>
          {contracts.length>0&&<button onClick={function(){setEditingId("new");}} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף דיווח</button>}
          {contracts.length===0&&<div className="text-xs mt-2">הגדר חוזי פידיון בעמוד חוזים</div>}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b"><tr>
              <th className="px-4 py-3 font-semibold text-slate-700">שוכר / נכס</th>
              <th className="px-4 py-3 font-semibold text-slate-700">הכנסה ברוטו</th>
              <th className="px-4 py-3 font-semibold text-slate-700">%</th>
              <th className="px-4 py-3 font-semibold text-slate-700">שכ"ד מחושב</th>
              <th className="px-4 py-3 font-semibold text-slate-700">מינימום</th>
              <th className="px-4 py-3 font-semibold text-slate-700">סופי</th>
            </tr></thead>
            <tbody>
              {reports.map(function(r){
                const isMin = (r.final_rent??0) <= (r.min_rent??0)+1;
                return (
                  <tr key={r.id} className={"border-t border-slate-100 "+(isMin?"bg-orange-50":"hover:bg-slate-50")}>
                    <td className="px-4 py-3"><div className="font-semibold text-slate-800">{r.contracts?.tenants?.name}</div><div className="text-xs text-slate-400">{r.contracts?.properties?.name}</div></td>
                    <td className="px-4 py-3 text-slate-700">{fmtMoney(r.gross_revenue)}</td>
                    <td className="px-4 py-3 text-slate-500">{r.revenue_pct}%</td>
                    <td className="px-4 py-3 text-slate-600">{fmtMoney(r.calculated_rent)}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtMoney(r.min_rent)}{isMin&&<span className="text-orange-600 font-bold mr-1"> ←</span>}</td>
                    <td className="px-4 py-3 font-black text-blue-700 text-base">{fmtMoney(r.final_rent)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50">
              <tr><td colSpan={5} className="px-4 py-2.5 text-xs font-bold text-slate-600">סה"כ {reports.length} דיווחים</td><td className="px-4 py-2.5 font-black text-blue-700">{fmtMoney(totalFinal)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}

      {editingId&&(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">דיווח הכנסה — {selMonth}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                <select value={fContractId} onChange={function(e){setFContractId(e.target.value);}} className={ic}>
                  <option value="">-- בחר --</option>
                  {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name} ({c.revenue_pct}%)</option>;})}
                </select>
              </div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">הכנסה ברוטו (₪) *</label>
                <input type="number" value={fGrossRevenue} onChange={function(e){setFGrossRevenue(e.target.value);}} className={ic} placeholder="לדוגמה: 500000"/>
              </div>
              {preview&&(
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm space-y-1.5">
                  <div className="font-bold text-blue-700 mb-2">חישוב אוטומטי</div>
                  {[{l:"הכנסה ברוטו",v:fmtMoney(Number(fGrossRevenue))},{l:`שכ"ד ${preview.pct}%`,v:fmtMoney(preview.calcRent)},{l:"מינימום",v:fmtMoney(preview.minRent)},{l:"מע\"מ",v:fmtMoney(preview.vat)}].map(function(r){return <div key={r.l} className="flex justify-between text-xs"><span className="text-slate-500">{r.l}</span><span className="font-medium">{r.v}</span></div>;})}
                  <div className="flex justify-between font-black text-blue-800 text-base pt-2 border-t border-blue-200">
                    <span>שכ"ד סופי</span><span>{fmtMoney(preview.finalRent)}</span>
                  </div>
                  {preview.calcRent < preview.minRent && <div className="text-xs text-orange-600 font-semibold">⚠️ פידיון נמוך ממינימום — יחויב מינימום</div>}
                </div>
              )}
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic}/></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving||!preview} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"שומר...":"שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
