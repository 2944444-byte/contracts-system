"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

type MgmtRecord = {
  id: string;
  contract_id: string;
  month: string;
  base_amount: number;
  final_amount: number;
  method: string;
  status: string;
  grace_applied: boolean;
  notes: string | null;
  contracts?: any;
};

export default function ManagementPage() {
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [records,    setRecords]    = useState<MgmtRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selMonth,   setSelMonth]   = useState(new Date().toISOString().slice(0,7));
  const [editingId,  setEditingId]  = useState("");
  const [saving,     setSaving]     = useState(false);

  const [fContractId, setFContractId] = useState("");
  const [fMethod,     setFMethod]     = useState("cost_plus");
  const [fBasePct,    setFBasePct]    = useState("10");
  const [fFixedAmt,   setFFixedAmt]   = useState("");
  const [fGrace,      setFGrace]      = useState(false);
  const [fGracePct,   setFGracePct]   = useState("0");
  const [fNotes,      setFNotes]      = useState("");

  useEffect(function() { loadAll(); }, [selMonth]);

  async function loadAll() {
    setLoading(true);
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("contracts")
        .select("id, tenants(name), properties(name, mgmt_fee_per_sqm), charged_area, rent_per_sqm, investment_addition, management_method, grace_pct")
        .in("status", ["active","expiring","extended"]),
      supabase.from("management_fees")
        .select("*, contracts(tenants(name), properties(name))")
        .eq("month", selMonth + "-01")
        .order("created_at", { ascending: false }),
    ]);
    setContracts(c ?? []);
    setRecords((r ?? []) as MgmtRecord[]);
    setLoading(false);
  }

  function calcMgmt(c: any): { base: number; final: number } {
    const area    = c.charged_area ?? 0;
    const feeRate = c.properties?.mgmt_fee_per_sqm ?? 0;
    const base    = feeRate * area;
    const grace   = c.grace_pct ?? 0;
    const final   = base * (1 - grace / 100);
    return { base, final };
  }

  async function generateAll() {
    if (!confirm("לייצר חיובי ניהול לחודש " + selMonth + " לכל החוזים הפעילים?")) return;
    setGenerating(true);
    try {
      for (const c of contracts) {
        const { base, final } = calcMgmt(c);
        if (base <= 0) continue;
        // בדוק אם כבר קיים
        const { data: existing } = await supabase.from("management_fees")
          .select("id").eq("contract_id", c.id).eq("month", selMonth + "-01").limit(1);
        if (existing?.length) continue;

        const { data } = await supabase.from("management_fees").insert({
          contract_id:   c.id,
          month:         selMonth + "-01",
          base_amount:   base,
          final_amount:  final,
          method:        c.management_method ?? "cost_plus",
          grace_applied: (c.grace_pct ?? 0) > 0,
          grace_pct:     c.grace_pct ?? 0,
          status:        "pending",
        }).select().single();
        if (data) {
          await logAudit({ entity_type: "management_fee", entity_id: data.id, action: "generate" });
        }
      }
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setGenerating(false); }
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from("management_fees").update({ status }).eq("id", id);
    await logAudit({ entity_type: "management_fee", entity_id: id, action: "status_" + status });
    await loadAll();
  }

  function openEdit(r: MgmtRecord) {
    setEditingId(r.id);
    setFContractId(r.contract_id); setFMethod(r.method ?? "cost_plus");
    setFFixedAmt(r.final_amount?.toString() ?? ""); setFNotes(r.notes ?? "");
    setFGrace(r.grace_applied ?? false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await supabase.from("management_fees").update({
        final_amount:  Number(fFixedAmt),
        grace_applied: fGrace,
        notes:         fNotes || null,
      }).eq("id", editingId);
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  const totalBase  = records.reduce(function(s, r) { return s + (r.base_amount ?? 0); }, 0);
  const totalFinal = records.reduce(function(s, r) { return s + (r.final_amount ?? 0); }, 0);
  const pending    = records.filter(function(r) { return r.status === "pending"; });
  const approved   = records.filter(function(r) { return r.status === "approved"; });

  const contractsWithoutRecord = contracts.filter(function(c) {
    return !records.find(function(r) { return r.contract_id === c.id; })
      && (c.properties?.mgmt_fee_per_sqm ?? 0) > 0;
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">דמי ניהול</h1>
          <p className="text-sm text-slate-500 mt-1">
            {records.length} רשומות | ₪{Math.round(totalFinal).toLocaleString()} לגבייה
            {totalBase !== totalFinal && (
              <span className="text-green-600"> (הנחה ₪{Math.round(totalBase - totalFinal).toLocaleString()})</span>
            )}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="month" value={selMonth} onChange={function(e) { setSelMonth(e.target.value); }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white" />
          <button onClick={generateAll} disabled={generating || contractsWithoutRecord.length === 0}
            className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {generating ? "מייצר..." : "⚡ ייצר לכולם (" + contractsWithoutRecord.length + ")"}
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "ממתין",    value: pending.length,   color: "text-yellow-700", bg: "bg-yellow-50",  border: "border-yellow-100", amt: pending.reduce(function(s,r){return s+r.final_amount;},0)  },
          { label: "אושר",     value: approved.length,  color: "text-green-700",  bg: "bg-green-50",   border: "border-green-100",  amt: approved.reduce(function(s,r){return s+r.final_amount;},0) },
          { label: "סה\"כ חיוב",value: "",              color: "text-slate-800",  bg: "bg-white",      border: "border-slate-200",  amt: totalFinal },
          { label: "חוזים פעילים", value: contracts.length, color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-100", amt: null },
        ].map(function(k) {
          return (
            <div key={k.label} className={"rounded-xl border p-4 " + k.bg + " " + k.border}>
              <div className={"text-2xl font-black " + k.color}>
                {k.value !== "" ? k.value : k.amt != null ? "₪" + Math.round(k.amt).toLocaleString() : ""}
              </div>
              {k.amt != null && k.value !== "" && (
                <div className="text-xs text-slate-500">₪{Math.round(k.amt).toLocaleString()}</div>
              )}
              <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
            </div>
          );
        })}
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : records.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🏦</div>
          <div>אין רשומות לחודש זה</div>
          {contractsWithoutRecord.length > 0 && (
            <button onClick={generateAll}
              className="mt-3 text-blue-600 hover:underline text-sm">
              ⚡ ייצר ל-{contractsWithoutRecord.length} חוזים
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold">בסיס</th>
                <th className="px-4 py-3 font-semibold">לאחר הנחה</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {records.map(function(r) {
                const discount = r.base_amount - r.final_amount;
                return (
                  <tr key={r.id} className={"border-t border-slate-100 " +
                    (r.status === "approved" ? "bg-green-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{r.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{r.contracts?.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">₪{Math.round(r.base_amount).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">₪{Math.round(r.final_amount).toLocaleString()}</div>
                      {discount > 0 && (
                        <div className="text-xs text-green-600">הנחה ₪{Math.round(discount).toLocaleString()}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (r.status === "approved" ? "bg-green-100 text-green-700" :
                          r.status === "invoiced" ? "bg-blue-100 text-blue-700" :
                          "bg-yellow-100 text-yellow-700")}>
                        {r.status === "approved" ? "✓ אושר" : r.status === "invoiced" ? "חויב" : "ממתין"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {r.status === "pending" && (
                          <button onClick={function() { updateStatus(r.id, "approved"); }}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 font-semibold">
                            ✓ אשר
                          </button>
                        )}
                        {r.status === "approved" && (
                          <button onClick={function() { updateStatus(r.id, "invoiced"); }}
                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700 font-semibold">
                            📄 חייב
                          </button>
                        )}
                        <button onClick={function() { openEdit(r); }}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">
                          עריכה
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* חוזים ללא רשומה */}
      {contractsWithoutRecord.length > 0 && records.length > 0 && (
        <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <div className="text-sm font-semibold text-yellow-800 mb-2">
            ⚠️ {contractsWithoutRecord.length} חוזים ללא רשומת ניהול לחודש זה:
          </div>
          <div className="flex flex-wrap gap-2">
            {contractsWithoutRecord.map(function(c) {
              return (
                <span key={c.id} className="text-xs bg-white border border-yellow-200 rounded-lg px-2 py-1 text-slate-600">
                  {c.tenants?.name} — {c.properties?.name}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-800 text-lg">עריכת דמי ניהול</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סכום סופי (₪)</label>
                <input type="number" value={fFixedAmt} onChange={function(e) { setFFixedAmt(e.target.value); }} className={ic} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={fGrace} onChange={function(e) { setFGrace(e.target.checked); }} className="w-4 h-4" />
                <span>הוחלה הנחת grace period</span>
              </label>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} className={ic} />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={function() { setEditingId(""); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
