"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL",{day:"numeric",month:"long",year:"numeric"}) : "—"; }
function fmtMoney(n: number) { return n ? "₪"+Math.round(n).toLocaleString() : "—"; }

export default function ContractPrintPage() {
  const params = useParams();
  const contractId = params?.id as string;
  const [contract, setContract] = useState<any>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(function() {
    async function load() {
      const { data } = await supabase.from("contracts")
        .select("*, tenants(*), properties(*), contract_spaces(spaces(name,area)), guarantees(*), contract_options(*)")
        .eq("id", contractId).single();
      setContract(data); setLoading(false);
    }
    if (contractId) load();
  }, [contractId]);

  if (loading) return <div className="text-center py-20">טוען...</div>;
  if (!contract) return <div className="text-center py-20 text-red-600">חוזה לא נמצא</div>;

  const baseRent  = (contract.rent_per_sqm??0)*(contract.charged_area??0)+(contract.investment_addition??0);
  const vat       = contract.vat_type==="taxable" ? baseRent*0.18 : 0;
  const totalRent = baseRent+vat;

  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      {/* כפתורי הדפסה — נעלמים בהדפסה */}
      <div className="print:hidden flex gap-3 mb-6">
        <button onClick={function(){window.print();}} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">🖨 הדפס</button>
        <button onClick={function(){window.history.back();}} className="rounded-lg border border-slate-200 px-5 py-2.5 text-slate-600 hover:bg-slate-50">← חזור</button>
      </div>

      {/* מסמך */}
      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm print:shadow-none print:border-none print:p-0">
        {/* כותרת */}
        <div className="text-center mb-8 pb-6 border-b-2 border-slate-200">
          <div className="text-3xl font-black text-slate-800 mb-1">הסכם שכירות מסחרי</div>
          <div className="text-slate-500 text-sm">{fmtDate(contract.start_date)} — {fmtDate(contract.end_date)}</div>
        </div>

        {/* צדדים */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
            <div className="text-xs font-bold text-blue-600 mb-2 uppercase tracking-wide">המשכיר</div>
            <div className="font-bold text-slate-800">{contract.properties?.name}</div>
            {contract.properties?.address&&<div className="text-sm text-slate-600 mt-1">{contract.properties.address}{contract.properties.city?", "+contract.properties.city:""}</div>}
          </div>
          <div className="rounded-xl bg-green-50 border border-green-100 p-4">
            <div className="text-xs font-bold text-green-600 mb-2 uppercase tracking-wide">השוכר</div>
            <div className="font-bold text-slate-800">{contract.tenants?.name}</div>
            {contract.tenants?.company_name&&<div className="text-sm text-slate-600">{contract.tenants.company_name}</div>}
            {contract.tenants?.id_number&&<div className="text-xs text-slate-400 font-mono mt-1">ח.פ: {contract.tenants.id_number}</div>}
            {contract.tenants?.phone&&<div className="text-sm text-slate-600 mt-1">📞 {contract.tenants.phone}</div>}
          </div>
        </div>

        {/* פרטי הסכם */}
        <div className="mb-6">
          <div className="text-sm font-bold text-slate-700 mb-3 pb-1 border-b border-slate-100">פרטי ההסכם</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            {[
              {l:"תחילת שכירות",  v:fmtDate(contract.start_date)},
              {l:"סיום שכירות",   v:fmtDate(contract.end_date)},
              {l:"שטח מושכר",    v:contract.charged_area?contract.charged_area+' מ"ר':"—"},
              {l:"שכ\"ד למ\"ר",  v:fmtMoney(contract.rent_per_sqm)},
              {l:"תוספת השקעות", v:fmtMoney(contract.investment_addition)},
              {l:"שיטת הצמדה",   v:contract.indexation_method==="highest_in_period"?"מדד גבוה":"t-2"},
              {l:"מדד בסיס",     v:contract.base_cpi_value?String(contract.base_cpi_value):"—"},
              {l:"סטטוס",        v:contract.status==="active"?"פעיל":contract.status==="expiring"?"פוגה":"אחר"},
            ].map(function(row){return (
              <div key={row.l} className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">{row.l}</span>
                <span className="font-semibold text-slate-800">{row.v}</span>
              </div>
            );})}
          </div>
        </div>

        {/* תשלומים */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 mb-6">
          <div className="text-sm font-bold text-slate-700 mb-3">סיכום תשלום חודשי</div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">שכ"ד בסיס</span><span className="font-semibold">{fmtMoney(baseRent)}</span></div>
            {vat>0&&<div className="flex justify-between"><span className="text-slate-600">מע"מ (18%)</span><span>{fmtMoney(vat)}</span></div>}
            <div className="flex justify-between font-black text-base pt-2 border-t border-slate-200 mt-2"><span>סה"כ לתשלום</span><span className="text-blue-700">{fmtMoney(totalRent)}</span></div>
            <div className="flex justify-between text-xs text-slate-400"><span>שנתי (לפני מע"מ)</span><span>{fmtMoney(baseRent*12)}</span></div>
          </div>
        </div>

        {/* יחידות */}
        {contract.contract_spaces?.length>0&&(
          <div className="mb-6">
            <div className="text-sm font-bold text-slate-700 mb-2 pb-1 border-b border-slate-100">יחידות מושכרות</div>
            <div className="flex flex-wrap gap-2">
              {contract.contract_spaces.map(function(cs:any){return cs.spaces&&<span key={cs.spaces.name} className="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full">{cs.spaces.name}{cs.spaces.area?" — "+cs.spaces.area+' מ"ר':""}</span>;})}
            </div>
          </div>
        )}

        {/* אופציות */}
        {contract.contract_options?.length>0&&(
          <div className="mb-6">
            <div className="text-sm font-bold text-slate-700 mb-2 pb-1 border-b border-slate-100">אופציות חידוש</div>
            {contract.contract_options.map(function(opt:any,i:number){return (
              <div key={opt.id} className="text-sm flex justify-between py-1">
                <span className="text-slate-600">אופציה {i+1}</span>
                <span className="text-slate-800">{fmtDate(opt.start_date)} — {fmtDate(opt.end_date)}</span>
              </div>
            );})}
          </div>
        )}

        {/* ערבויות */}
        {contract.guarantees?.filter(function(g:any){return g.status==="active";}).length>0&&(
          <div className="mb-6">
            <div className="text-sm font-bold text-slate-700 mb-2 pb-1 border-b border-slate-100">ביטחונות</div>
            {contract.guarantees.filter(function(g:any){return g.status==="active";}).map(function(g:any){return (
              <div key={g.id} className="flex justify-between text-sm py-1">
                <span className="text-slate-600">{g.guarantee_type==="bank"?"ערבות בנקאית":g.guarantee_type==="check"?"שיקים":g.guarantee_type}</span>
                <span className="font-semibold">{fmtMoney(g.amount_actual??g.amount_required)}{g.bank_name?" — "+g.bank_name:""}</span>
              </div>
            );})}
          </div>
        )}

        {/* חתימות */}
        <div className="mt-12 grid grid-cols-2 gap-8 text-center text-sm text-slate-500">
          <div><div className="border-t border-slate-300 pt-2 mt-8">חתימת המשכיר + חותמת</div></div>
          <div><div className="border-t border-slate-300 pt-2 mt-8">חתימת השוכר + חותמת</div></div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-300 pt-4 border-t border-slate-100">
          PropManager v4 — {new Date().toLocaleDateString("he-IL")}
        </div>
      </div>
    </div>
  );
}
