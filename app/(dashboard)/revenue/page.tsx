"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtMoney(n: number) { return "₪" + Math.round(n ?? 0).toLocaleString(); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

export default function RevenuePage() {
  const [contracts, setContracts]   = useState<any[]>([]);
  const [reports,   setReports]     = useState<any[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [saving,    setSaving]      = useState(false);
  const [selected,  setSelected]    = useState<string | null>(null);
  const [selMonth,  setSelMonth]    = useState(new Date().toISOString().slice(0,7));
  const [fRevenue,  setFRevenue]    = useState("");
  const [fNotes,    setFNotes]      = useState("");

  useEffect(function() { loadAll(); }, [selMonth]);

  async function loadAll() {
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("contracts")
        .select("id, rent_type, revenue_pct, min_rent_per_sqm, charged_area, tenants(name), properties(name)")
        .eq("rent_type", "revenue_based").in("status", ["active","expiring","extended"]),
      supabase.from("revenue_reports")
        .select("*, contracts(tenants(name), properties(name))")
        .gte("report_month", selMonth+"-01")
        .lte("report_month", selMonth+"-31")
        .order("created_at", { ascending: false }),
    ]);
    setContracts(c ?? []);
    setReports(r ?? []);
    setLoading(false);
  }

  function calcRent(contract: any, grossRevenue: number) {
    const pct     = contract.revenue_pct ?? 0;
    const minSqm  = contract.min_rent_per_sqm ?? 0;
    const area    = contract.charged_area ?? 0;
    const fromPct = grossRevenue * (pct / 100);
    const minRent = minSqm * area;
    return {
      calculated: fromPct,
      minimum:    minRent,
      final:      Math.max(fromPct, minRent),
    };
  }

  async function handleSubmit(contractId: string) {
    if (!fRevenue) { alert("חובה: סכום מחזור"); return; }
    const contract = contracts.find(function(c) { return c.id === contractId; });
    if (!contract) return;
    setSaving(true);
    try {
      const gross = Number(fRevenue);
      const { calculated, minimum, final } = calcRent(contract, gross);
      await supabase.from("revenue_reports").insert({
        contract_id:     contractId,
        report_month:    selMonth + "-01",
        gross_revenue:   gross,
        revenue_pct:     contract.revenue_pct ?? 0,
        calculated_rent: calculated,
        min_rent:        minimum,
        final_rent:      final,
        notes:           fNotes || null,
      });
      setSelected(null);
      setFRevenue(""); setFNotes("");
      await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  const selContract = contracts.find(function(c) { return c.id === selected; });
  const previewRent = selContract && fRevenue ? calcRent(selContract, Number(fRevenue)) : null;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">שכ"ד פידיון</h1>
          <p className="text-sm text-slate-500 mt-1">{contracts.length} חוזי פידיון פעילים</p>
        </div>
        <input type="month" value={selMonth} onChange={function(e){setSelMonth(e.target.value);}}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
      </div>

      {contracts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">📊</div>
          <div>אין חוזי פידיון פעילים</div>
          <div className="text-xs mt-2">הגדר סוג שכ"ד = פידיון בחוזה</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* חוזים */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-600 mb-2">בחר חוזה לדיווח</div>
            {contracts.map(function(c) {
              const existingReport = reports.find(function(r) { return r.contract_id === c.id; });
              return (
                <div key={c.id}
                  onClick={function(){ if (!existingReport) setSelected(selected===c.id?null:c.id); }}
                  className={"rounded-xl border p-4 transition-all " +
                    (existingReport ? "border-green-200 bg-green-50 cursor-default" :
                    selected===c.id ? "border-blue-500 bg-blue-50 cursor-pointer shadow-sm" :
                    "border-slate-200 bg-white hover:shadow-sm cursor-pointer")}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-semibold text-slate-800">{c.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{c.properties?.name}</div>
                    </div>
                    {existingReport ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">✓ דווח</span>
                    ) : (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">ממתין</span>
                    )}
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500">
                    <span>% מהמחזור: <strong>{c.revenue_pct}%</strong></span>
                    {c.min_rent_per_sqm && <span>מינימום: <strong>₪{c.min_rent_per_sqm}/מ"ר</strong></span>}
                    <span>שטח: <strong>{c.charged_area} מ"ר</strong></span>
                  </div>
                  {existingReport && (
                    <div className="mt-2 text-xs text-green-700">
                      מחזור: {fmtMoney(existingReport.gross_revenue)} | שכ"ד: <strong>{fmtMoney(existingReport.final_rent)}</strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* טופס דיווח */}
          <div>
            {!selected ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
                <div className="text-5xl mb-3">📋</div><div>בחר חוזה לדיווח מחזור</div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
                <h2 className="font-bold text-slate-800">דיווח מחזור — {selContract?.tenants?.name}</h2>
                <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
                  {selMonth} | {selContract?.properties?.name}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מחזור ברוטו (₪) *</label>
                  <input type="number" value={fRevenue}
                    onChange={function(e){setFRevenue(e.target.value);}}
                    className={ic} placeholder="הכנס סכום מחזור חודשי" />
                </div>

                {previewRent && fRevenue && (
                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">% מהמחזור ({selContract.revenue_pct}%)</span>
                      <span className="font-semibold">{fmtMoney(previewRent.calculated)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">שכ"ד מינימום</span>
                      <span className="font-semibold">{fmtMoney(previewRent.minimum)}</span>
                    </div>
                    <div className="flex justify-between font-black text-blue-800 pt-2 border-t border-blue-200">
                      <span>שכ"ד לחיוב</span>
                      <span>{fmtMoney(previewRent.final)}</span>
                    </div>
                    {previewRent.final === previewRent.minimum && (
                      <div className="text-xs text-orange-600">⚠️ מינימום גבוה מ-% המחזור</div>
                    )}
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                  <input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} />
                </div>

                <div className="flex gap-3">
                  <button onClick={function(){setSelected(null);setFRevenue("");}}
                    className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                  <button onClick={function(){handleSubmit(selected!);}} disabled={saving}
                    className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                    {saving ? "שומר..." : "💾 שמור דיווח"}
                  </button>
                </div>
              </div>
            )}

            {/* דוחות החודש */}
            {reports.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">
                  דוחות {selMonth} ({reports.length})
                </div>
                <div className="divide-y divide-slate-100">
                  {reports.map(function(r) {
                    return (
                      <div key={r.id} className="px-4 py-3 text-sm">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-slate-800">{r.contracts?.tenants?.name}</div>
                            <div className="text-xs text-slate-400">{fmtDate(r.report_month)}</div>
                          </div>
                          <div className="text-left">
                            <div className="text-xs text-slate-500">מחזור: {fmtMoney(r.gross_revenue)}</div>
                            <div className="font-bold text-blue-700">{fmtMoney(r.final_rent)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
