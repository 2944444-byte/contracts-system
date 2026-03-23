"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL", { month:"long", year:"numeric" });
}
function fmtMoney(n: number) { return "₪" + Math.round(n ?? 0).toLocaleString(); }

export default function ManagementPage() {
  const [fees,       setFees]       = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selMonth,   setSelMonth]   = useState(new Date().toISOString().slice(0,7));
  const [filterSt,   setFilterSt]   = useState("all");

  useEffect(function() { loadAll(); }, [selMonth]);

  async function loadAll() {
    setLoading(true);
    const from = selMonth+"-01";
    const to   = selMonth+"-31";
    const [{ data: f }, { data: c }] = await Promise.all([
      supabase.from("management_fees")
        .select("*, contracts(tenants(name), properties(name), mgmt_fee_per_sqm, mgmt_fee_per_sqm, rent_per_sqm, charged_area, investment_addition)")
        .gte("month", from).lte("month", to).order("created_at"),
      supabase.from("contracts")
        .select("id, status, rent_per_sqm, charged_area, investment_addition, mgmt_fee_per_sqm, mgmt_fee_per_sqm, tenants(name), properties(name)")
        .in("status",["active","expiring","extended"])
        .or("mgmt_fee_per_sqm.not.is.null,mgmt_fee_per_sqm.not.is.null"),
    ]);
    setFees(f ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  async function generateAll() {
    setGenerating(true);
    try {
      const month = selMonth+"-01";
      let created = 0;
      for (const c of contracts) {
        const { data: existing } = await supabase.from("management_fees")
          .select("id").eq("contract_id",c.id).eq("month",month).limit(1);
        if (existing?.length) continue;
        const baseRent = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
        const feeAmount = c.mgmt_fee_per_sqm
          ? baseRent*(c.mgmt_fee_per_sqm/100)
          : (c.mgmt_fee_per_sqm ?? 0);
        if (feeAmount <= 0) continue;
        await supabase.from("management_fees").insert({
          contract_id: c.id, month, base_amount: baseRent,
          base_amount: feeAmount, final_amount: feeAmount, status: "pending",
        });
        created++;
      }
      await logAudit({ entity_type:"management_fees", entity_id:selMonth, action:"generate", notes:created+" נוצרו" });
      await loadAll();
      if (created === 0) alert("כל החוזים כבר יש להם דמי ניהול לחודש זה");
      else alert(`✅ נוצרו ${created} דמי ניהול`);
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setGenerating(false); }
  }

  async function approve(id: string) {
    await supabase.from("management_fees").update({ status:"approved" }).eq("id",id);
    await loadAll();
  }

  async function markPaid(id: string) {
    await supabase.from("management_fees").update({ status:"paid", paid_at:new Date().toISOString() }).eq("id",id);
    await loadAll();
  }

  async function approveAll() {
    const pending = filtered.filter(function(f){return f.status==="pending";});
    for (const f of pending) {
      await supabase.from("management_fees").update({ status:"approved" }).eq("id",f.id);
    }
    await loadAll();
  }

  async function deleteRow(id: string) {
    if (!confirm("למחוק רשומה?")) return;
    await supabase.from("management_fees").delete().eq("id",id);
    await loadAll();
  }

  const filtered = fees.filter(function(f) {
    return filterSt==="all" || f.status===filterSt;
  });

  const totalPending  = fees.filter(function(f){return f.status==="pending";}).reduce(function(s,f){return s+(f.final_amount??0);},0);
  const totalApproved = fees.filter(function(f){return f.status==="approved";}).reduce(function(s,f){return s+(f.final_amount??0);},0);
  const totalPaid     = fees.filter(function(f){return f.status==="paid";}).reduce(function(s,f){return s+(f.final_amount??0);},0);

  const contractsWithoutFees = contracts.filter(function(c) {
    return !fees.find(function(f){return f.contract_id===c.id;});
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">דמי ניהול</h1>
          <p className="text-sm text-slate-500 mt-1">{fees.length} רשומות | {selMonth}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="month" value={selMonth} onChange={function(e){setSelMonth(e.target.value);}}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
          {fees.filter(function(f){return f.status==="pending";}).length > 0 && (
            <button onClick={approveAll}
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
              ✓ אשר הכל ({fees.filter(function(f){return f.status==="pending";}).length})
            </button>
          )}
          <button onClick={generateAll} disabled={generating || contracts.length===0}
            className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {generating ? "⏳ מייצר..." : "⚡ צור " + selMonth}
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          {label:"ממתינים",   amount:totalPending,  count:fees.filter(function(f){return f.status==="pending";}).length,  color:"text-slate-700",  bg:"bg-white",    f:"pending"  },
          {label:"מאושרים",   amount:totalApproved, count:fees.filter(function(f){return f.status==="approved";}).length, color:"text-blue-700",   bg:"bg-blue-50",  f:"approved" },
          {label:"שולמו",     amount:totalPaid,     count:fees.filter(function(f){return f.status==="paid";}).length,     color:"text-green-700",  bg:"bg-green-50", f:"paid"     },
        ].map(function(k) {
          return (
            <button key={k.label} onClick={function(){setFilterSt(filterSt===k.f?"all":k.f);}}
              className={"rounded-xl border p-4 text-center transition-all " + k.bg +
                (filterSt===k.f?" border-blue-500 ring-2 ring-blue-300":" border-slate-200 hover:shadow-sm")}>
              <div className={"text-2xl font-black " + k.color}>{k.count}</div>
              <div className={"text-sm font-bold " + k.color}>{fmtMoney(k.amount)}</div>
              <div className={"text-xs " + k.color}>{k.label}</div>
            </button>
          );
        })}
      </div>

      {/* התראה — חוזים ללא דמי ניהול */}
      {contractsWithoutFees.length > 0 && (
        <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4 flex items-center justify-between">
          <div className="text-sm text-yellow-800">
            <span className="font-bold">⚠️ {contractsWithoutFees.length} חוזים</span> עם דמי ניהול שעוד לא נוצרו החודש
            <span className="text-xs text-yellow-600 mr-2">({contractsWithoutFees.map(function(c){return c.tenants?.name;}).join(", ")})</span>
          </div>
          <button onClick={generateAll} disabled={generating}
            className="shrink-0 text-xs bg-yellow-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-yellow-700 disabled:opacity-50">
            {generating ? "⏳" : "⚡ צור עכשיו"}
          </button>
        </div>
      )}

      {/* פילטר */}
      <div className="flex gap-2 mb-4">
        {[{v:"all",l:"הכל"},{v:"pending",l:"ממתינים"},{v:"approved",l:"מאושרים"},{v:"paid",l:"שולמו"}].map(function(s) {
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {s.l}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🔧</div>
          <div>אין דמי ניהול לחודש זה</div>
          {contracts.length > 0 && (
            <button onClick={generateAll} disabled={generating}
              className="mt-3 text-blue-600 hover:underline text-sm">
              {generating ? "⏳ מייצר..." : "⚡ צור עכשיו"}
            </button>
          )}
          {contracts.length === 0 && (
            <div className="text-xs mt-2 text-slate-400">אין חוזים עם הגדרת דמי ניהול</div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">שכ"ד בסיס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">שיטה</th>
                <th className="px-4 py-3 font-semibold text-slate-700">דמי ניהול</th>
                <th className="px-4 py-3 font-semibold text-slate-700">חודש</th>
                <th className="px-4 py-3 font-semibold text-slate-700">סטטוס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(f) {
                const pct    = f.contracts?.mgmt_fee_per_sqm;
                const fixed  = f.contracts?.mgmt_fee_per_sqm;
                return (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{f.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{f.contracts?.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{fmtMoney(f.base_amount??0)}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        {pct ? pct+"%" : fixed ? "קבוע" : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-purple-700">{fmtMoney(f.final_amount??0)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(f.month)}</td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (f.status==="paid"?"bg-green-100 text-green-700":f.status==="approved"?"bg-blue-100 text-blue-700":"bg-slate-100 text-slate-600")}>
                        {f.status==="paid"?"שולם":f.status==="approved"?"מאושר":"ממתין"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {f.status==="pending" && (
                          <button onClick={function(){approve(f.id);}}
                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-semibold hover:bg-blue-700">✓ אשר</button>
                        )}
                        {f.status==="approved" && (
                          <button onClick={function(){markPaid(f.id);}}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded font-semibold hover:bg-green-700">₪ שולם</button>
                        )}
                        <button onClick={function(){deleteRow(f.id);}}
                          className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50">
              <tr>
                <td colSpan={3} className="px-4 py-2.5 text-xs font-bold text-slate-600">סה"כ {filtered.length} רשומות</td>
                <td className="px-4 py-2.5 font-black text-purple-700">
                  {fmtMoney(filtered.reduce(function(s,f){return s+(f.final_amount??0);},0))}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
