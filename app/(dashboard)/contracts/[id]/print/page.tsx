"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function fmt(d: string) { return d ? new Date(d).toLocaleDateString("he-IL",{day:"numeric",month:"long",year:"numeric"}) : "—"; }
function money(n: number) { return n ? "₪"+Math.round(n).toLocaleString() : "—"; }

export default function PrintPage() {
  const params = useParams();
  const id = params?.id as string;
  const [c, setC] = useState<any>(null);

  useEffect(function() {
    if (!id) return;
    supabase.from("contracts")
      .select("*, tenants(*), properties(*), guarantees(*), contract_options(*)")
      .eq("id", id).single()
      .then(function({ data }) { setC(data); });
  }, [id]);

  if (!c) return <div className="text-center py-20 text-slate-400">טוען...</div>;

  const base  = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
  const vat   = c.vat_type==="taxable" ? base*0.18 : 0;

  return (
    <div dir="rtl" className="max-w-3xl mx-auto p-4">
      <div className="print:hidden flex gap-3 mb-6">
        <button onClick={function(){window.print();}} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white">🖨 הדפס</button>
        <button onClick={function(){window.history.back();}} className="rounded-lg border border-slate-200 px-5 py-2.5 text-slate-600">← חזור</button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm print:shadow-none print:border-none">
        <div className="text-center mb-8 pb-6 border-b-2 border-slate-200">
          <h1 className="text-3xl font-black text-slate-800">הסכם שכירות</h1>
          <p className="text-slate-500 text-sm mt-1">{fmt(c.start_date)} — {fmt(c.end_date)}</p>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <div className="text-xs font-bold text-blue-600 mb-2 uppercase">המשכיר</div>
            <div className="font-bold text-slate-800">{c.properties?.name}</div>
            {c.properties?.address && <div className="text-sm text-slate-600 mt-1">{c.properties.address}</div>}
          </div>
          <div className="bg-green-50 border border-green-100 rounded-xl p-4">
            <div className="text-xs font-bold text-green-600 mb-2 uppercase">השוכר</div>
            <div className="font-bold text-slate-800">{c.tenants?.name}</div>
            {c.tenants?.company_name && <div className="text-sm text-slate-600">{c.tenants.company_name}</div>}
            {c.tenants?.phone && <div className="text-sm text-slate-600">📞 {c.tenants.phone}</div>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm mb-8">
          {[
            {l:"תחילה",  v:fmt(c.start_date)},
            {l:"סיום",   v:fmt(c.end_date)},
            {l:"שטח",   v:c.charged_area ? c.charged_area+' מ"ר' : "—"},
            {l:"הצמדה", v:c.indexation_method==="highest_in_period"?"מדד גבוה":"t-2"},
          ].map(function(r){return (
            <div key={r.l} className="flex justify-between border-b border-slate-100 py-1.5">
              <span className="text-slate-500">{r.l}</span>
              <span className="font-semibold">{r.v}</span>
            </div>
          );})}
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-8">
          <div className="text-sm font-bold text-slate-700 mb-3">תשלום חודשי</div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">בסיס</span><span className="font-semibold">{money(base)}</span></div>
            {vat>0 && <div className="flex justify-between"><span className="text-slate-500">מע"מ 18%</span><span>{money(vat)}</span></div>}
            <div className="flex justify-between font-black text-base border-t border-slate-200 pt-2 mt-2">
              <span>סה"כ</span><span className="text-blue-700">{money(base+vat)}</span>
            </div>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-8 text-center text-sm text-slate-500">
          <div><div className="border-t border-slate-300 pt-2 mt-8">חתימת המשכיר</div></div>
          <div><div className="border-t border-slate-300 pt-2 mt-8">חתימת השוכר</div></div>
        </div>
      </div>
    </div>
  );
}
