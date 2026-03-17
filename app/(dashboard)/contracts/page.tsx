"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}
function fmtMoney(n: number) {
  return "₪" + Math.round(n ?? 0).toLocaleString();
}

const STATUS_MAP: Record<string, { label:string; color:string }> = {
  active:   { label:"פעיל",    color:"bg-green-100 text-green-700"  },
  expiring: { label:"פוגה",   color:"bg-yellow-100 text-yellow-700"},
  extended: { label:"מורחב",  color:"bg-blue-100 text-blue-700"    },
  upcoming: { label:"עתידי",  color:"bg-purple-100 text-purple-700"},
  ended:    { label:"הסתיים", color:"bg-slate-100 text-slate-500"  },
};

export default function ContractsPage() {
  const router    = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [filterSt,  setFilterSt]  = useState("active");
  const [selected,  setSelected]  = useState<string|null>(null);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const { data } = await supabase.from("contracts")
      .select("*, tenants(name,company_name,phone,email), properties(name,city), contract_options(*), contract_spaces(spaces(name,area)), guarantees(guarantee_type,amount_actual,status)")
      .order("end_date");
    setContracts(data ?? []);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק חוזה?")) return;
    await supabase.from("contracts").delete().eq("id", id);
    setSelected(null); await loadAll();
  }

  const filtered = contracts.filter(function(c) {
    const ms = filterSt==="all" || c.status===filterSt;
    const mq = !search || c.tenants?.name?.includes(search) || c.properties?.name?.includes(search);
    return ms && mq;
  });

  const selContract = contracts.find(function(c) { return c.id===selected; });

  const STATUSES = [
    {v:"active",l:"פעילים"},{v:"expiring",l:"פוגים"},{v:"extended",l:"מורחבים"},
    {v:"upcoming",l:"עתידיים"},{v:"ended",l:"הסתיימו"},{v:"all",l:"הכל"},
  ];

  function monthly(c: any) {
    return (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
  }
  function daysLeft(c: any) {
    if (!c.end_date) return null;
    return Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000);
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חוזים</h1>
          <p className="text-sm text-slate-500 mt-1">
            {contracts.filter(function(c){return c.status==="active";}).length} פעילים |
            {" "}{contracts.filter(function(c){return c.status==="expiring";}).length} פוגים
          </p>
        </div>
        <button onClick={function(){router.push("/contracts/new");}}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + חוזה חדש
        </button>
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
          placeholder="חיפוש שוכר/נכס..."
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm" />
        {STATUSES.map(function(s) {
          const cnt = s.v==="all" ? contracts.length : contracts.filter(function(c){return c.status===s.v;}).length;
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {s.l} ({cnt})
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* רשימה */}
        <div className="space-y-2 lg:col-span-1">
          {loading ? <div className="text-center py-8 text-slate-400">טוען...</div> : (
            <>
              {filtered.map(function(c) {
                const mon  = monthly(c);
                const days = daysLeft(c);
                const si   = STATUS_MAP[c.status] ?? STATUS_MAP.ended;
                return (
                  <div key={c.id} onClick={function(){setSelected(selected===c.id?null:c.id);}}
                    className={"rounded-xl border p-3 cursor-pointer transition-all " +
                      (selected===c.id?"border-blue-500 bg-blue-50 shadow-sm":"border-slate-200 bg-white hover:shadow-sm")}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-semibold text-slate-800 text-sm">{c.tenants?.name}</div>
                      <span className={"text-xs px-1.5 py-0.5 rounded-full font-semibold " + si.color}>{si.label}</span>
                    </div>
                    <div className="text-xs text-slate-400">{c.properties?.name}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-green-600 font-semibold">{fmtMoney(mon)}/חודש</span>
                      {days !== null && days <= 90 && c.status !== "ended" && (
                        <span className={"text-xs font-bold " + (days<=30?"text-red-600":days<=60?"text-yellow-600":"text-slate-500")}>
                          {days} יום
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">אין חוזים</div>}
            </>
          )}
        </div>

        {/* פרטי חוזה */}
        <div className="lg:col-span-2">
          {!selContract ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">📄</div><div>בחר חוזה לצפייה</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* כרטיס ראשי */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-xl font-bold text-slate-800">{selContract.tenants?.name}</h2>
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + (STATUS_MAP[selContract.status]?.color)}>
                        {STATUS_MAP[selContract.status]?.label}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500">🏢 {selContract.properties?.name}</div>
                    {selContract.tenants?.company_name && <div className="text-xs text-slate-400">{selContract.tenants.company_name}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function(){router.push("/contracts/"+selContract.id+"/edit");}}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={function(){router.push("/contracts/"+selContract.id+"/print");}}
                      className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50">🖨 הדפס</button>
                    <button onClick={function(){handleDelete(selContract.id);}}
                      className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">🗑</button>
                  </div>
                </div>

                {/* KPI */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label:"הכנסה חודשית", value:fmtMoney(monthly(selContract)), color:"text-green-700" },
                    { label:"תחילה",         value:fmtDate(selContract.start_date), color:"text-slate-700" },
                    { label:"סיום",          value:fmtDate(selContract.end_date),   color:daysLeft(selContract)!==null&&daysLeft(selContract)!<=60?"text-yellow-700":"text-slate-700" },
                  ].map(function(k) {
                    return (
                      <div key={k.label} className="rounded-xl bg-slate-50 p-3 text-center">
                        <div className={"font-bold text-sm " + k.color}>{k.value}</div>
                        <div className="text-xs text-slate-400">{k.label}</div>
                      </div>
                    );
                  })}
                </div>

                {/* פרטים */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    {l:"שכ\"ד/מ\"ר",    v:selContract.rent_per_sqm ? "₪"+selContract.rent_per_sqm : "—"},
                    {l:"שטח מחויב",      v:selContract.charged_area ? selContract.charged_area+" מ\"ר" : "—"},
                    {l:"תוספת השקעה",    v:selContract.investment_addition ? fmtMoney(selContract.investment_addition) : "—"},
                    {l:"מע\"מ",          v:selContract.vat_type==="taxable" ? "חייב 18%" : "פטור"},
                    {l:"מדד בסיס",       v:selContract.base_cpi_value ? selContract.base_cpi_value+" ("+fmtDate(selContract.base_cpi_date)+")" : "—"},
                    {l:"שיטת הצמדה",    v:selContract.indexation_method==="highest_in_period" ? "גבוה בתקופה" : "t-2"},
                  ].map(function(row) {
                    return (
                      <div key={row.l} className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="text-slate-400">{row.l}</span>
                        <span className="font-semibold text-slate-700">{row.v}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* אופציות */}
              {(selContract.contract_options??[]).length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">אופציות</div>
                  <div className="divide-y divide-slate-100">
                    {(selContract.contract_options??[]).map(function(opt: any) {
                      return (
                        <div key={opt.id} className="px-5 py-3 flex items-center justify-between text-sm">
                          <div>
                            <span className="font-semibold text-slate-800">אופציה {opt.option_number}</span>
                            <span className="text-slate-500 mr-2">{opt.duration_months} חודשים</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {opt.end_date && <span className="text-xs text-slate-400">עד {fmtDate(opt.end_date)}</span>}
                            <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                              (opt.status==="exercised"?"bg-green-100 text-green-700":opt.status==="expired"?"bg-slate-100 text-slate-500":"bg-blue-100 text-blue-700")}>
                              {opt.status==="exercised"?"מומשה":opt.status==="expired"?"פגה":"ממתינה"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ערבויות */}
              {(selContract.guarantees??[]).filter(function(g:any){return g.status==="active";}).length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">ערבויות</div>
                  <div className="divide-y divide-slate-100">
                    {(selContract.guarantees??[]).filter(function(g:any){return g.status==="active";}).map(function(g: any, i: number) {
                      return (
                        <div key={i} className="px-5 py-3 flex items-center justify-between text-sm">
                          <span className="text-slate-700">{g.guarantee_type}</span>
                          <span className="font-bold text-slate-800">{fmtMoney(g.amount_actual??0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
