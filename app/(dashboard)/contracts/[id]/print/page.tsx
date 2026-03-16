"use client";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function ContractPrintPage() {
  const params = useParams();
  const router = useRouter();
  const contractId = params?.id as string;
  const [contract, setContract] = useState<any>(null);
  const [loading,  setLoading]  = useState(true);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(function() { load(); }, [contractId]);

  async function load() {
    const { data } = await supabase.from("contracts")
      .select("*, tenants(*), properties(name, address, city, companies(company_name, address, phone)), contract_spaces(*, spaces(name, area)), contract_options(*), contract_price_tiers(*), contract_ti(*), guarantees(*)")
      .eq("id", contractId).single();
    setContract(data);
    setLoading(false);
  }

  function doPrint() {
    window.print();
  }

  if (loading) return <div className="p-8 text-center text-slate-400">טוען...</div>;
  if (!contract) return <div className="p-8 text-center text-red-400">חוזה לא נמצא</div>;

  const monthly = (contract.rent_per_sqm ?? 0) * (contract.charged_area ?? 0) + (contract.investment_addition ?? 0);
  const vatAmt  = contract.vat_type === "taxable" ? monthly * 0.18 : 0;

  return (
    <div dir="rtl">
      {/* כפתורי פעולה — לא מודפסים */}
      <div className="flex gap-3 p-4 bg-slate-100 no-print">
        <button onClick={function() { router.back(); }}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">
          ← חזרה
        </button>
        <button onClick={doPrint}
          className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800">
          🖨 הדפס
        </button>
      </div>

      {/* תוכן להדפסה */}
      <div ref={printRef} className="max-w-4xl mx-auto p-8 bg-white print:p-6">

        {/* כותרת */}
        <div className="border-b-2 border-blue-600 pb-4 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-black text-slate-900">חוזה שכירות</h1>
              <div className="text-sm text-slate-500 mt-1">
                {contract.properties?.companies?.company_name ?? "PropManager"}
              </div>
            </div>
            <div className="text-left text-sm text-slate-500">
              <div>מס' חוזה: {contractId.substring(0,8).toUpperCase()}</div>
              <div>תאריך: {fmtDate(new Date().toISOString())}</div>
            </div>
          </div>
        </div>

        {/* צדדים */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="border border-slate-200 rounded-lg p-4">
            <div className="text-xs font-bold text-slate-500 uppercase mb-2">המשכיר</div>
            <div className="font-bold text-slate-900">{contract.properties?.companies?.company_name ?? "—"}</div>
            <div className="text-sm text-slate-600">{contract.properties?.companies?.address ?? ""}</div>
            <div className="text-sm text-slate-600">{contract.properties?.companies?.phone ?? ""}</div>
          </div>
          <div className="border border-slate-200 rounded-lg p-4">
            <div className="text-xs font-bold text-slate-500 uppercase mb-2">השוכר</div>
            <div className="font-bold text-slate-900">{contract.tenants?.name ?? "—"}</div>
            {contract.tenants?.id_number && <div className="text-sm text-slate-600">ח.פ: {contract.tenants.id_number}</div>}
            <div className="text-sm text-slate-600">{contract.tenants?.contact_phone ?? ""}</div>
            <div className="text-sm text-slate-600">{contract.tenants?.contact_email ?? ""}</div>
          </div>
        </div>

        {/* נכס */}
        <div className="border border-slate-200 rounded-lg p-4 mb-6">
          <div className="text-xs font-bold text-slate-500 uppercase mb-2">הנכס המושכר</div>
          <div className="font-bold text-slate-900">{contract.properties?.name}</div>
          {contract.properties?.address && (
            <div className="text-sm text-slate-600">{contract.properties.address}{contract.properties.city ? ", " + contract.properties.city : ""}</div>
          )}
          {(contract.contract_spaces ?? []).length > 0 && (
            <div className="mt-2 text-sm text-slate-600">
              יחידות: {(contract.contract_spaces ?? []).map(function(s: any) { return s.spaces?.name; }).join(", ")}
            </div>
          )}
        </div>

        {/* תנאים כספיים */}
        <div className="border border-slate-200 rounded-lg p-4 mb-6">
          <div className="text-xs font-bold text-slate-500 uppercase mb-3">תנאים כספיים</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              { label: "שכר דירה (₪/מ\"ר)", value: "₪" + (contract.rent_per_sqm ?? 0) },
              { label: "שטח מחויב (מ\"ר)",  value: (contract.charged_area ?? 0) + " מ\"ר" },
              { label: "הכנסה חודשית",      value: "₪" + Math.round(monthly).toLocaleString() },
              { label: "מע\"מ",              value: contract.vat_type === "taxable" ? "₪" + Math.round(vatAmt).toLocaleString() + " (18%)" : "פטור" },
              { label: "סה\"כ לתשלום",       value: "₪" + Math.round(monthly + vatAmt).toLocaleString() },
              { label: "תאריך תחילה",        value: fmtDate(contract.start_date) },
              { label: "תאריך סיום",          value: fmtDate(contract.end_date) },
              { label: "מדד בסיס",            value: contract.base_cpi_value ? contract.base_cpi_value + " (" + fmtDate(contract.base_cpi_date) + ")" : "—" },
            ].map(function(row) {
              return (
                <div key={row.label} className="flex justify-between border-b border-slate-100 pb-1">
                  <span className="text-slate-500">{row.label}</span>
                  <span className="font-semibold text-slate-900">{row.value}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* אופציות */}
        {(contract.contract_options ?? []).length > 0 && (
          <div className="border border-slate-200 rounded-lg p-4 mb-6">
            <div className="text-xs font-bold text-slate-500 uppercase mb-2">אופציות</div>
            {(contract.contract_options ?? []).map(function(opt: any) {
              return (
                <div key={opt.id} className="flex justify-between text-sm py-1 border-b border-slate-100">
                  <span>אופציה {opt.option_number} — {opt.duration_months} חודשים</span>
                  <span className="text-slate-500">הודעה {opt.notice_days_before_end} יום</span>
                </div>
              );
            })}
          </div>
        )}

        {/* ערבויות */}
        {(contract.guarantees ?? []).length > 0 && (
          <div className="border border-slate-200 rounded-lg p-4 mb-6">
            <div className="text-xs font-bold text-slate-500 uppercase mb-2">ערבויות</div>
            {(contract.guarantees ?? []).filter(function(g: any) { return g.status === "active"; }).map(function(g: any) {
              return (
                <div key={g.id} className="flex justify-between text-sm py-1 border-b border-slate-100">
                  <span>{g.guarantee_type}</span>
                  <span className="font-semibold">₪{(g.amount_actual ?? 0).toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* חתימות */}
        <div className="grid grid-cols-2 gap-8 mt-10">
          <div className="text-center">
            <div className="border-t border-slate-400 pt-2 text-sm text-slate-600">המשכיר</div>
            <div className="text-xs text-slate-400 mt-1">תאריך: ___________</div>
          </div>
          <div className="text-center">
            <div className="border-t border-slate-400 pt-2 text-sm text-slate-600">השוכר</div>
            <div className="text-xs text-slate-400 mt-1">תאריך: ___________</div>
          </div>
        </div>
      </div>

      <style>{`@media print { .no-print { display: none !important; } }`}</style>
    </div>
  );
}
