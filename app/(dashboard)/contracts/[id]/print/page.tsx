"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}
function fmtMoney(n: number) {
  return n ? "₪" + Math.round(n).toLocaleString() : "—";
}

export default function ContractPrintPage() {
  const params   = useParams();
  const router   = useRouter();
  const id       = params?.id as string;
  const [data,    setData]    = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(function() {
    async function load() {
      const { data: c } = await supabase.from("contracts")
        .select("*, tenants(*), properties(*), contract_options(*), contract_spaces(spaces(*)), guarantees(*)")
        .eq("id", id).single();
      setData(c);
      setLoading(false);
    }
    load();
  }, [id]);

  useEffect(function() {
    if (data) setTimeout(function() { window.print(); }, 500);
  }, [data]);

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center text-slate-400">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <div>טוען חוזה...</div>
      </div>
    </div>
  );
  if (!data) return <div className="text-center p-8 text-red-500">חוזה לא נמצא</div>;

  const monthly = (data.rent_per_sqm??0)*(data.charged_area??0)+(data.investment_addition??0);
  const vat     = data.vat_type==="taxable" ? monthly*0.18 : 0;

  return (
    <>
      {/* כפתורי ניווט — נסתרים בהדפסה */}
      <div className="no-print fixed top-4 right-4 flex gap-2 z-50">
        <button onClick={function(){router.back();}}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow hover:bg-slate-50">
          ← חזרה
        </button>
        <button onClick={function(){window.print();}}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-700">
          🖨 הדפס
        </button>
      </div>

      {/* תוכן להדפסה */}
      <div className="print-page max-w-3xl mx-auto p-8 font-sans text-slate-800" dir="rtl"
        style={{fontFamily:"Arial, sans-serif", direction:"rtl"}}>

        {/* כותרת */}
        <div className="border-b-4 border-blue-600 pb-4 mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-blue-800 mb-1">חוזה שכירות</h1>
            <div className="text-sm text-slate-500">מזהה: {id.substring(0,8).toUpperCase()}</div>
          </div>
          <div className="text-left text-xs text-slate-400">
            <div>הופק: {new Date().toLocaleDateString("he-IL")}</div>
            <div>PropManager v4</div>
          </div>
        </div>

        {/* צדדים */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase mb-2">המשכיר</div>
            <div className="font-bold text-slate-800">{data.properties?.name}</div>
            <div className="text-sm text-slate-600">{data.properties?.address}</div>
            <div className="text-sm text-slate-600">{data.properties?.city}</div>
          </div>
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase mb-2">השוכר</div>
            <div className="font-bold text-slate-800">{data.tenants?.name}</div>
            {data.tenants?.company_name && <div className="text-sm text-slate-600">{data.tenants.company_name}</div>}
            {data.tenants?.id_number && <div className="text-sm text-slate-600">ח.פ / ת.ז: {data.tenants.id_number}</div>}
            {data.tenants?.phone && <div className="text-sm text-slate-600">טל: {data.tenants.phone}</div>}
            {data.tenants?.address && <div className="text-sm text-slate-600">{data.tenants.address}</div>}
          </div>
        </div>

        {/* פרטי חוזה */}
        <div className="mb-6">
          <h2 className="text-sm font-black text-slate-600 uppercase tracking-wider mb-3 border-b border-slate-200 pb-1">פרטי החוזה</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
            {[
              {l:"תאריך תחילה",      v:fmtDate(data.start_date)},
              {l:"תאריך סיום",       v:fmtDate(data.end_date)},
              {l:'שכ"ד ל-מ"ר',      v:data.rent_per_sqm ? "₪"+data.rent_per_sqm+" למ\"ר" : "—"},
              {l:"שטח מחויב",        v:data.charged_area ? data.charged_area+' מ"ר' : "—"},
              {l:"תוספת השקעה",      v:fmtMoney(data.investment_addition)},
              {l:"מע\"מ",            v:data.vat_type==="taxable" ? "חייב במע\"מ (18%)" : "פטור"},
              {l:"מדד בסיס",         v:data.base_cpi_value ? data.base_cpi_value+" ("+fmtDate(data.base_cpi_date)+")" : "—"},
              {l:"שיטת הצמדה",      v:data.indexation_method==="highest_in_period" ? "מדד גבוה ביותר בתקופה" : "t-2 (חודשיים לפני)"},
            ].map(function(row) {
              return (
                <div key={row.l} className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">{row.l}</span>
                  <span className="font-semibold text-slate-800">{row.v}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* סיכום כספי */}
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h2 className="text-sm font-black text-blue-800 uppercase tracking-wider mb-3">סיכום כספי חודשי</h2>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">שכ"ד בסיס</span>
              <span className="font-semibold">{fmtMoney(monthly - (data.investment_addition??0))}</span>
            </div>
            {(data.investment_addition??0) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-600">תוספת השקעה</span>
                <span className="font-semibold">{fmtMoney(data.investment_addition)}</span>
              </div>
            )}
            {vat > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-600">מע"מ (18%)</span>
                <span className="font-semibold">{fmtMoney(vat)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t-2 border-blue-300 font-black text-blue-800 text-base">
              <span>סה"כ לתשלום חודשי</span>
              <span>{fmtMoney(monthly + vat)}</span>
            </div>
          </div>
        </div>

        {/* יחידות */}
        {(data.contract_spaces??[]).length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-black text-slate-600 uppercase tracking-wider mb-3 border-b border-slate-200 pb-1">יחידות מושכרות</h2>
            <div className="grid grid-cols-3 gap-2">
              {(data.contract_spaces??[]).map(function(cs: any) {
                return (
                  <div key={cs.space_id} className="border border-slate-200 rounded-lg p-2.5 text-sm text-center bg-slate-50">
                    <div className="font-semibold text-slate-800">{cs.spaces?.name}</div>
                    {cs.spaces?.area && <div className="text-xs text-slate-500">{cs.spaces.area} מ"ר</div>}
                    {cs.spaces?.floor !== undefined && cs.spaces?.floor !== null && (
                      <div className="text-xs text-slate-400">קומה {cs.spaces.floor}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* אופציות */}
        {(data.contract_options??[]).length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-black text-slate-600 uppercase tracking-wider mb-3 border-b border-slate-200 pb-1">אופציות</h2>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">אופציה</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">משך</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">הודעה מראש</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">עד תאריך</th>
                </tr>
              </thead>
              <tbody>
                {(data.contract_options??[]).map(function(opt: any) {
                  return (
                    <tr key={opt.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold">{opt.option_number}</td>
                      <td className="px-3 py-2">{opt.duration_months} חודשים</td>
                      <td className="px-3 py-2">{opt.notice_days_before_end ?? 90} יום</td>
                      <td className="px-3 py-2">{fmtDate(opt.end_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ערבויות */}
        {(data.guarantees??[]).filter(function(g:any){return g.status==="active";}).length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-black text-slate-600 uppercase tracking-wider mb-3 border-b border-slate-200 pb-1">ערבויות</h2>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">סוג</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">בנק</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">סכום</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">תוקף עד</th>
                </tr>
              </thead>
              <tbody>
                {(data.guarantees??[]).filter(function(g:any){return g.status==="active";}).map(function(g: any) {
                  return (
                    <tr key={g.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{g.guarantee_type}</td>
                      <td className="px-3 py-2">{g.bank_name ?? "—"}</td>
                      <td className="px-3 py-2 font-semibold">{fmtMoney(g.amount_actual)}</td>
                      <td className="px-3 py-2">{fmtDate(g.end_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* חתימות */}
        <div className="mt-12 pt-6 border-t-2 border-slate-200">
          <div className="grid grid-cols-2 gap-16">
            <div className="text-center">
              <div className="border-b-2 border-slate-400 mb-2 h-12"></div>
              <div className="text-sm font-semibold text-slate-600">המשכיר</div>
              <div className="text-xs text-slate-400">{data.properties?.name}</div>
            </div>
            <div className="text-center">
              <div className="border-b-2 border-slate-400 mb-2 h-12"></div>
              <div className="text-sm font-semibold text-slate-600">השוכר</div>
              <div className="text-xs text-slate-400">{data.tenants?.name}</div>
            </div>
          </div>
          <div className="text-center text-xs text-slate-300 mt-6">
            הופק ב-{new Date().toLocaleDateString("he-IL")} | PropManager v4
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-page { max-width: 100% !important; padding: 20px !important; }
        }
      `}</style>
    </>
  );
}
