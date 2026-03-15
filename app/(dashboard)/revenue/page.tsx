"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL", { year: "numeric", month: "long" });
}

export default function RevenueRentPage() {
  const [contracts,   setContracts]   = useState<any[]>([]);
  const [reports,     setReports]     = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [editingId,   setEditingId]   = useState("");
  const [saving,      setSaving]      = useState(false);
  const [selContract, setSelContract] = useState("");

  const [fContractId,    setFContractId]    = useState("");
  const [fMonth,         setFMonth]         = useState(new Date().toISOString().slice(0, 7));
  const [fGrossRevenue,  setFGrossRevenue]  = useState("");
  const [fNotes,         setFNotes]         = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("contracts")
        .select("id, rent_type, revenue_pct, min_rent_per_sqm, charged_area, tenants(name), properties(name)")
        .eq("rent_type", "revenue_based")
        .in("status", ["active","expiring","extended"]),
      supabase.from("revenue_reports")
        .select("*, contracts(tenants(name), properties(name))")
        .order("report_month", { ascending: false })
        .limit(50),
    ]);
    setContracts(c ?? []);
    setReports(r ?? []);
    setLoading(false);
  }

  function calcRent(contract: any, gross: number): { calculated: number; min: number; final: number } {
    const calculated = gross * ((contract.revenue_pct ?? 0) / 100);
    const min        = (contract.min_rent_per_sqm ?? 0) * (contract.charged_area ?? 0);
    const final      = Math.max(calculated, min);
    return { calculated, min, final };
  }

  async function handleSave() {
    if (!fContractId || !fGrossRevenue || !fMonth) {
      alert("חובה: חוזה, חודש, מחזור"); return;
    }
    setSaving(true);
    try {
      const contract = contracts.find(function(c) { return c.id === fContractId; });
      if (!contract) throw new Error("חוזה לא נמצא");
      const gross = Number(fGrossRevenue);
      const { calculated, min, final } = calcRent(contract, gross);

      const { data } = await supabase.from("revenue_reports").insert({
        contract_id:      fContractId,
        report_month:     fMonth + "-01",
        gross_revenue:    gross,
        revenue_pct:      contract.revenue_pct,
        calculated_rent:  calculated,
        min_rent:         min,
        final_rent:       final,
        notes:            fNotes || null,
      }).select().single();

      await logAudit({ entity_type: "revenue_report", entity_id: data.id, action: "create" });
      setEditingId("");
      setFGrossRevenue(""); setFNotes(""); setFContractId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  const filteredReports = selContract
    ? reports.filter(function(r) { return r.contract_id === selContract; })
    : reports;

  const totalFinalRent = filteredReports.slice(0, 12).reduce(function(s, r) { return s + (r.final_rent ?? 0); }, 0);

  const previewCalc = fContractId && fGrossRevenue ? (function() {
    const contract = contracts.find(function(c) { return c.id === fContractId; });
    if (!contract) return null;
    return calcRent(contract, Number(fGrossRevenue));
  })() : null;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">שכ"ד לפי פידיון</h1>
          <p className="text-sm text-slate-500 mt-1">
            {contracts.length} חוזים מבוססי פידיון | {reports.length} דוחות
          </p>
        </div>
        <button onClick={function() { setEditingId("new"); }}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + דוח מחזור חדש
        </button>
      </div>

      {contracts.length === 0 && !loading ? (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 mb-5">
          <div className="font-semibold text-yellow-800 mb-1">אין חוזים מבוססי פידיון</div>
          <div className="text-sm text-yellow-700">
            כדי להוסיף חוזה פידיון — ערוך חוזה ב-/contracts, שנה סוג שכ"ד ל"פידיון" והגדר % + מינימום.
          </div>
        </div>
      ) : null}

      {/* חוזים פעילים */}
      {contracts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
          {contracts.map(function(c) {
            const minMonthly = (c.min_rent_per_sqm ?? 0) * (c.charged_area ?? 0);
            return (
              <div key={c.id}
                onClick={function() { setSelContract(selContract === c.id ? "" : c.id); }}
                className={"rounded-xl border p-4 cursor-pointer transition-all " +
                  (selContract === c.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:shadow-md")}>
                <div className="font-bold text-slate-800">{c.tenants?.name}</div>
                <div className="text-xs text-slate-400 mb-3">{c.properties?.name}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <div className="font-bold text-blue-700">{c.revenue_pct ?? 0}%</div>
                    <div className="text-slate-400">מהמחזור</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <div className="font-bold text-green-700">₪{Math.round(minMonthly).toLocaleString()}</div>
                    <div className="text-slate-400">מינימום/חודש</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* טבלת דוחות */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="font-semibold text-slate-700">
            דוחות מחזור {selContract ? "— " + contracts.find(function(c){return c.id===selContract;})?.tenants?.name : ""}
          </span>
          {filteredReports.length > 0 && (
            <span className="text-sm text-green-700 font-semibold">
              ממוצע: ₪{Math.round(totalFinalRent / Math.min(filteredReports.length, 12)).toLocaleString()}/חודש
            </span>
          )}
        </div>
        {loading ? (
          <div className="py-8 text-center text-slate-400">טוען...</div>
        ) : filteredReports.length === 0 ? (
          <div className="py-10 text-center text-slate-400">
            <div className="text-4xl mb-2">📊</div>
            <div className="text-sm">אין דוחות מחזור</div>
          </div>
        ) : (
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b text-xs">
              <tr>
                <th className="px-4 py-2.5 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-2.5 font-semibold">חודש</th>
                <th className="px-4 py-2.5 font-semibold">מחזור</th>
                <th className="px-4 py-2.5 font-semibold">% מחושב</th>
                <th className="px-4 py-2.5 font-semibold">מינימום</th>
                <th className="px-4 py-2.5 font-semibold">לחיוב</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map(function(r) {
                const aboveMin = r.calculated_rent >= r.min_rent;
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{r.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{r.contracts?.properties?.name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{fmtDate(r.report_month)}</td>
                    <td className="px-4 py-2.5 text-slate-700">₪{Math.round(r.gross_revenue).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-slate-600">₪{Math.round(r.calculated_rent).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-slate-600">₪{Math.round(r.min_rent ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-bold text-green-700">₪{Math.round(r.final_rent).toLocaleString()}</div>
                      <div className={"text-xs " + (aboveMin ? "text-blue-500" : "text-orange-500")}>
                        {aboveMin ? "מעל מינימום" : "מינימום חל"}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* מודל דוח חדש */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-800 text-lg">דוח מחזור חדש</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                <select value={fContractId} onChange={function(e){setFContractId(e.target.value);}} className={ic}>
                  <option value="">-- בחר חוזה --</option>
                  {contracts.map(function(c) {
                    return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name} ({c.revenue_pct}%)</option>;
                  })}
                </select>
                {contracts.length === 0 && (
                  <div className="text-xs text-orange-600 mt-1">אין חוזים פידיון פעילים</div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חודש דיווח *</label>
                <input type="month" value={fMonth} onChange={function(e){setFMonth(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מחזור ברוטו (₪) *</label>
                <input type="number" value={fGrossRevenue} onChange={function(e){setFGrossRevenue(e.target.value);}}
                  className={ic} placeholder="0" />
              </div>

              {/* חישוב בזמן אמת */}
              {previewCalc && (
                <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-2 text-sm">
                  <div className="font-bold text-green-800 mb-2">תצוגה מקדימה</div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">% מהמחזור</span>
                    <span>₪{Math.round(previewCalc.calculated).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">מינימום</span>
                    <span>₪{Math.round(previewCalc.min).toLocaleString()}</span>
                  </div>
                  <hr className="border-green-200" />
                  <div className="flex justify-between font-black text-green-800">
                    <span>לחיוב</span>
                    <span>₪{Math.round(previewCalc.final).toLocaleString()}</span>
                  </div>
                  <div className={"text-xs text-center mt-1 " +
                    (previewCalc.calculated >= previewCalc.min ? "text-blue-600" : "text-orange-600")}>
                    {previewCalc.calculated >= previewCalc.min ? "✓ מעל מינימום" : "⚠ מינימום חל"}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "שמור דוח"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
