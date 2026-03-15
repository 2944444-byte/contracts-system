"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  active:    { label: "פעיל",    bg: "bg-green-100",  color: "text-green-700",  dot: "bg-green-500"  },
  expiring:  { label: "פוגה",   bg: "bg-yellow-100", color: "text-yellow-700", dot: "bg-yellow-500" },
  extended:  { label: "מורחב",  bg: "bg-blue-100",   color: "text-blue-700",   dot: "bg-blue-500"   },
  upcoming:  { label: "עתידי",  bg: "bg-purple-100", color: "text-purple-700", dot: "bg-purple-500" },
  ended:     { label: "הסתיים", bg: "bg-slate-100",  color: "text-slate-500",  dot: "bg-slate-400"  },
};

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}
function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

export default function ContractsPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [filterSt,  setFilterSt]  = useState("active");
  const [selected,  setSelected]  = useState<any>(null);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const { data } = await supabase.from("contracts")
      .select(`id, status, start_date, end_date, rent_per_sqm, charged_area, investment_addition, vat_type, notes,
        tenants(name, contact_phone, contact_email),
        properties(name),
        contract_options(id, option_number, status, start_date, end_date, duration_months),
        contract_spaces(id, space_id, charge_method, price_per_sqm, fixed_amount, spaces(name, area)),
        contract_price_tiers(id, tier_number, start_date, end_date, rent_per_sqm),
        contract_ti(id, ti_amount, ti_type, status)`)
      .order("created_at", { ascending: false });
    setContracts(data ?? []);
    setLoading(false);
  }

  const filtered = contracts.filter(function(c) {
    const ms = filterSt === "all" || c.status === filterSt;
    const mq = !search ||
      c.tenants?.name?.includes(search) ||
      c.properties?.name?.includes(search);
    return ms && mq;
  });

  const counts: Record<string, number> = {};
  contracts.forEach(function(c) { counts[c.status] = (counts[c.status] ?? 0) + 1; });

  function calcMonthly(c: any) {
    return (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
  }

  return (
    <div dir="rtl" className="flex gap-5 h-[calc(100vh-120px)]">
      {/* רשימה */}
      <div className="w-80 shrink-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-slate-800">חוזים</h1>
            <button onClick={function() { router.push("/contracts/new"); }}
              className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 font-bold">+ חדש</button>
          </div>
          <input type="text" value={search} onChange={function(e) { setSearch(e.target.value); }}
            placeholder="חיפוש..." className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-right" />
          {/* פילטר סטטוס */}
          <div className="flex flex-wrap gap-1 mt-2">
            <button onClick={function() { setFilterSt("all"); }}
              className={"rounded-lg px-2 py-1 text-xs font-semibold " +
                (filterSt === "all" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
              הכל ({contracts.length})
            </button>
            {Object.entries(STATUS_CONFIG).map(function([k, v]) {
              if (!counts[k]) return null;
              return (
                <button key={k} onClick={function() { setFilterSt(k); }}
                  className={"rounded-lg px-2 py-1 text-xs font-semibold " +
                    (filterSt === k ? v.bg + " " + v.color : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                  {v.label} ({counts[k]})
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
          {loading ? (
            <div className="py-8 text-center text-slate-400 text-sm">טוען...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">לא נמצאו חוזים</div>
          ) : filtered.map(function(c) {
            const sc = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.ended;
            const isSelected = selected?.id === c.id;
            const monthly = calcMonthly(c);
            const d = c.end_date ? daysLeft(c.end_date) : null;
            return (
              <div key={c.id} onClick={function() { setSelected(c); }}
                className={"flex items-center gap-3 px-4 py-3 cursor-pointer " +
                  (isSelected ? "bg-blue-50 border-r-2 border-r-blue-600" : "hover:bg-slate-50")}>
                <div className={"w-2 h-2 rounded-full shrink-0 " + sc.dot} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-slate-800 truncate">{c.tenants?.name}</div>
                  <div className="text-xs text-slate-400 truncate">{c.properties?.name}</div>
                </div>
                <div className="text-left shrink-0">
                  {monthly > 0 && (
                    <div className="text-xs font-bold text-green-700">₪{Math.round(monthly/1000)}K</div>
                  )}
                  {d !== null && d <= 90 && d >= 0 && (
                    <div className={"text-xs font-semibold " + (d <= 30 ? "text-red-500" : "text-yellow-600")}>
                      {d}י
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* פירוט */}
      {selected ? (
        <div className="flex-1 rounded-xl border border-slate-200 bg-white shadow-sm overflow-y-auto">
          {(() => {
            const c  = selected;
            const sc = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.ended;
            const monthly = calcMonthly(c);
            const d = c.end_date ? daysLeft(c.end_date) : null;
            return (
              <div>
                {/* Header */}
                <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-100 z-10">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className={"w-2 h-2 rounded-full " + sc.dot} />
                        <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + sc.bg + " " + sc.color}>
                          {sc.label}
                        </span>
                        {d !== null && d <= 90 && d >= 0 && (
                          <span className={"text-xs font-bold " + (d <= 30 ? "text-red-500" : "text-yellow-600")}>
                            {d} ימים
                          </span>
                        )}
                      </div>
                      <h2 className="text-xl font-bold text-slate-800">{c.tenants?.name}</h2>
                      <div className="text-sm text-slate-500">{c.properties?.name}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={function() { router.push("/contracts/" + c.id + "/edit"); }}
                        className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                        ✏️ עריכה
                      </button>
                    </div>
                  </div>
                </div>

                {/* KPI */}
                <div className="grid grid-cols-4 gap-3 p-6 pb-0">
                  {[
                    { label: "שכ\"ד/מ\"ר",      value: "₪" + (c.rent_per_sqm ?? 0) },
                    { label: "שטח",            value: (c.charged_area ?? 0) + " מ\"ר" },
                    { label: "הכנסה/חודש",     value: "₪" + Math.round(monthly).toLocaleString(), bold: true, green: true },
                    { label: "מע\"מ",           value: c.vat_type === "exempt" ? "פטור" : "חייב" },
                  ].map(function(k) {
                    return (
                      <div key={k.label} className="rounded-xl border border-slate-200 p-3 text-center">
                        <div className={"text-lg font-black " + (k.green ? "text-green-700" : "text-slate-800")}>{k.value}</div>
                        <div className="text-xs text-slate-400">{k.label}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-5 p-6">
                  {/* פרטי חוזה */}
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-slate-500 uppercase mb-2">פרטי חוזה</div>
                    {[
                      { label: "תחילה",      value: fmtDate(c.start_date) },
                      { label: "סיום",       value: fmtDate(c.end_date)   },
                      { label: "טלפון",      value: c.tenants?.contact_phone },
                      { label: "אימייל",     value: c.tenants?.contact_email },
                    ].map(function(row) {
                      if (!row.value) return null;
                      return (
                        <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100">
                          <span className="text-xs text-slate-500">{row.label}</span>
                          <span className="text-sm text-slate-800 font-medium">{row.value}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* אופציות */}
                  <div>
                    <div className="text-xs font-bold text-slate-500 uppercase mb-2">
                      אופציות ({(c.contract_options ?? []).length})
                    </div>
                    {(c.contract_options ?? []).length === 0 ? (
                      <div className="text-xs text-slate-400">ללא אופציות</div>
                    ) : (
                      (c.contract_options ?? []).map(function(opt: any) {
                        const optSc = opt.status === "exercised" ? "bg-blue-100 text-blue-700" :
                          opt.status === "expired" ? "bg-slate-100 text-slate-400" : "bg-green-100 text-green-700";
                        return (
                          <div key={opt.id} className="flex items-center justify-between py-1.5 border-b border-slate-100">
                            <span className="text-xs text-slate-600">
                              אופציה {opt.option_number} | {opt.duration_months} חודשים
                            </span>
                            <span className={"text-xs px-1.5 py-0.5 rounded-full font-semibold " + optSc}>
                              {opt.status === "exercised" ? "הופעלה" : opt.status === "expired" ? "פגה" : "פעילה"}
                            </span>
                          </div>
                        );
                      })
                    )}

                    {/* Spaces */}
                    {(c.contract_spaces ?? []).length > 0 && (
                      <div className="mt-4">
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">יחידות בחוזה</div>
                        {(c.contract_spaces ?? []).map(function(sp: any) {
                          return (
                            <div key={sp.id} className="flex justify-between py-1 border-b border-slate-100">
                              <span className="text-xs text-slate-600">{sp.spaces?.name ?? "יחידה"}</span>
                              <span className="text-xs text-slate-500">
                                {sp.charge_method === "per_sqm" ? "₪" + sp.price_per_sqm + "/מ\"ר" :
                                  sp.charge_method === "fixed" ? "₪" + sp.fixed_amount : sp.charge_method}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* מדרגות מחיר */}
                {(c.contract_price_tiers ?? []).length > 0 && (
                  <div className="mx-6 mb-4 rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-2 bg-slate-50 border-b text-xs font-bold text-slate-600">
                      📈 מדרגות מחיר
                    </div>
                    <div className="divide-y divide-slate-100">
                      {(c.contract_price_tiers ?? []).map(function(tier: any) {
                        return (
                          <div key={tier.id} className="flex justify-between items-center px-4 py-2">
                            <span className="text-xs text-slate-600">
                              {fmtDate(tier.start_date)} — {fmtDate(tier.end_date)}
                            </span>
                            <span className="text-sm font-bold text-slate-800">₪{tier.rent_per_sqm}/מ"ר</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* TI */}
                {(c.contract_ti ?? []).length > 0 && (
                  <div className="mx-6 mb-4 rounded-xl border border-slate-200 p-4">
                    <div className="text-xs font-bold text-slate-600 mb-2">🔨 השקעות שוכר (TI)</div>
                    {(c.contract_ti ?? []).map(function(ti: any) {
                      return (
                        <div key={ti.id} className="flex justify-between">
                          <span className="text-xs text-slate-600">{ti.ti_type}</span>
                          <span className="text-sm font-bold">₪{(ti.ti_amount ?? 0).toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {c.notes && (
                  <div className="mx-6 mb-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{c.notes}</div>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="flex-1 rounded-xl border-2 border-dashed border-slate-200 bg-white flex items-center justify-center">
          <div className="text-center text-slate-400">
            <div className="text-5xl mb-3">📄</div>
            <div className="font-medium">בחר חוזה מהרשימה</div>
            <div className="text-sm mt-1">
              או <button onClick={function() { router.push("/contracts/new"); }}
                className="text-blue-600 hover:underline">צור חוזה חדש</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
