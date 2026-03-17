"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const CHARGE_TYPES = [
  { v:"rent",       l:"שכ\"ד",       icon:"🏢" },
  { v:"management", l:"דמי ניהול",   icon:"🔧" },
  { v:"parking",    l:"חניה",         icon:"🅿️" },
  { v:"water",      l:"מים",          icon:"💧" },
  { v:"electricity",l:"חשמל",        icon:"⚡" },
  { v:"other",      l:"אחר",          icon:"📋" },
];

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}
function fmtMoney(n: number) {
  return "₪" + Math.round(n).toLocaleString();
}

export default function PaymentsPage() {
  const [charges,   setCharges]   = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editingId, setEditingId] = useState("");
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [filterSt,  setFilterSt]  = useState("pending");
  const [selMonth,  setSelMonth]  = useState(new Date().toISOString().slice(0,7));

  const [fContractId,  setFContractId]  = useState("");
  const [fType,        setFType]        = useState("rent");
  const [fBaseAmount,  setFBaseAmount]  = useState("");
  const [fVatType,     setFVatType]     = useState("taxable");
  const [fPeriodFrom,  setFPeriodFrom]  = useState("");
  const [fPeriodTo,    setFPeriodTo]    = useState("");
  const [fDueDate,     setFDueDate]     = useState("");
  const [fNotes,       setFNotes]       = useState("");

  useEffect(function() { loadAll(); }, [selMonth]);

  async function loadAll() {
    const [{ data: ch }, { data: c }] = await Promise.all([
      supabase.from("charges")
        .select("*, contracts(tenants(name), properties(name), vat_type)")
        .gte("billing_period_start", selMonth+"-01")
        .lte("billing_period_start", selMonth+"-31")
        .order("due_date"),
      supabase.from("contracts")
        .select("id, vat_type, rent_per_sqm, charged_area, investment_addition, tenants(name), properties(name)")
        .in("status",["active","expiring","extended"]),
    ]);
    setCharges(ch ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFContractId(""); setFType("rent"); setFBaseAmount(""); setFVatType("taxable");
    setFPeriodFrom(selMonth+"-01"); setFPeriodTo(selMonth+"-28");
    setFDueDate(selMonth+"-15"); setFNotes("");
  }

  function fillFromContract(id: string) {
    const c = contracts.find(function(x) { return x.id===id; });
    if (!c) return;
    const mon = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
    setFBaseAmount(Math.round(mon).toString());
    setFVatType(c.vat_type??"taxable");
  }

  async function handleSave() {
    if (!fContractId || !fBaseAmount) { alert("חובה: חוזה + סכום"); return; }
    setSaving(true);
    try {
      const base  = Number(fBaseAmount);
      const vat   = fVatType==="taxable" ? base * 0.18 : 0;
      const total = base + vat;
      const payload = {
        contract_id:           fContractId,
        charge_type:           fType,
        base_amount:           base,
        vat_amount:            vat,
        total_amount:          total,
        vat_type:              fVatType,
        billing_period_start:  fPeriodFrom||null,
        billing_period_end:    fPeriodTo||null,
        due_date:              fDueDate||null,
        status:                "pending",
        notes:                 fNotes||null,
      };
      const { data } = await supabase.from("charges").insert(payload).select().single();
      await logAudit({ entity_type:"charge", entity_id:data.id, action:"create" });
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function approve(id: string) {
    await supabase.from("charges").update({ status:"approved", approved_at:new Date().toISOString() }).eq("id",id);
    await logAudit({ entity_type:"charge", entity_id:id, action:"approve" });
    await loadAll();
  }

  async function markPaid(id: string) {
    await supabase.from("charges").update({ status:"paid", paid_at:new Date().toISOString() }).eq("id",id);
    await logAudit({ entity_type:"charge", entity_id:id, action:"paid" });
    await loadAll();
  }

  async function bulkApprove() {
    const pend = filtered.filter(function(c) { return c.status==="pending"; });
    for (const c of pend) {
      await supabase.from("charges").update({ status:"approved", approved_at:new Date().toISOString() }).eq("id",c.id);
    }
    await loadAll();
  }

  async function deleteCharge(id: string) {
    if (!confirm("למחוק חיוב?")) return;
    await supabase.from("charges").delete().eq("id",id);
    await loadAll();
  }

  const filtered = charges.filter(function(c) {
    return filterSt==="all" || c.status===filterSt;
  });

  const pending  = charges.filter(function(c) { return c.status==="pending"; });
  const approved = charges.filter(function(c) { return c.status==="approved"; });
  const paid     = charges.filter(function(c) { return c.status==="paid"; });
  const totalPending  = pending.reduce(function(s,c)  { return s+(c.total_amount??0); },0);
  const totalApproved = approved.reduce(function(s,c) { return s+(c.total_amount??0); },0);
  const totalPaid     = paid.reduce(function(s,c)     { return s+(c.total_amount??0); },0);

  const typeInfo = function(v: string) { return CHARGE_TYPES.find(function(t){return t.v===v;})??CHARGE_TYPES[5]; };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חיובים</h1>
          <p className="text-sm text-slate-500 mt-1">{charges.length} חיובים | {selMonth}</p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="month" value={selMonth} onChange={function(e){setSelMonth(e.target.value);}}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
          {pending.length > 0 && (
            <button onClick={bulkApprove}
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
              ✓ אשר הכל ({pending.length})
            </button>
          )}
          <button onClick={openNew}
            className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800">
            + חיוב חדש
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label:"ממתינים",   value:pending.length,  amount:totalPending,  color:"text-slate-700",  bg:"bg-white",      filter:"pending"  },
          { label:"מאושרים",   value:approved.length, amount:totalApproved, color:"text-blue-700",   bg:"bg-blue-50",    filter:"approved" },
          { label:"שולמו",     value:paid.length,     amount:totalPaid,     color:"text-green-700",  bg:"bg-green-50",   filter:"paid"     },
        ].map(function(k) {
          return (
            <button key={k.label} onClick={function(){setFilterSt(filterSt===k.filter?"all":k.filter);}}
              className={"rounded-xl border p-4 text-center transition-all " + k.bg +
                (filterSt===k.filter?" border-blue-500 ring-2 ring-blue-300":" border-slate-200 hover:shadow-sm")}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
              {k.amount > 0 && <div className={"text-sm font-bold " + k.color}>{fmtMoney(k.amount)}</div>}
            </button>
          );
        })}
      </div>

      {/* פילטר סטטוס */}
      <div className="flex gap-2 mb-4">
        {[{v:"pending",l:"ממתינים"},{v:"approved",l:"מאושרים"},{v:"paid",l:"שולמו"},{v:"all",l:"הכל"}].map(function(s) {
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {s.l}
            </button>
          );
        })}
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">💳</div>
          <div>אין חיובים</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ חיוב חדש</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">בסיס</th>
                <th className="px-4 py-3 font-semibold">מע"מ</th>
                <th className="px-4 py-3 font-semibold">סה"כ</th>
                <th className="px-4 py-3 font-semibold">תאריך</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(ch) {
                const ti = typeInfo(ch.charge_type);
                const isOverdue = ch.due_date && new Date(ch.due_date) < new Date() && ch.status !== "paid";
                return (
                  <tr key={ch.id} className={"border-t border-slate-100 " + (isOverdue?"bg-red-50":"hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{ch.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{ch.contracts?.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-lg">{ti.icon}</span>
                      <span className="text-xs text-slate-500 mr-1">{ti.l}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{fmtMoney(ch.base_amount??0)}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtMoney(ch.vat_amount??0)}</td>
                    <td className="px-4 py-3 font-bold text-slate-800">{fmtMoney(ch.total_amount??0)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {fmtDate(ch.due_date)}
                      {isOverdue && <div className="text-red-600 font-semibold">באיחור!</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (ch.status==="paid"?"bg-green-100 text-green-700":ch.status==="approved"?"bg-blue-100 text-blue-700":"bg-slate-100 text-slate-600")}>
                        {ch.status==="paid"?"שולם":ch.status==="approved"?"מאושר":"ממתין"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {ch.status==="pending" && (
                          <button onClick={function(){approve(ch.id);}}
                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-semibold hover:bg-blue-700">✓ אשר</button>
                        )}
                        {ch.status==="approved" && (
                          <button onClick={function(){markPaid(ch.id);}}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded font-semibold hover:bg-green-700">₪ שולם</button>
                        )}
                        <button onClick={function(){deleteCharge(ch.id);}}
                          className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* footer */}
            <tfoot className="border-t-2 border-slate-200 bg-slate-50">
              <tr>
                <td colSpan={4} className="px-4 py-2.5 text-xs font-bold text-slate-600">סה"כ {filtered.length} חיובים</td>
                <td className="px-4 py-2.5 font-black text-slate-800">
                  {fmtMoney(filtered.reduce(function(s,c){return s+(c.total_amount??0);},0))}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">חיוב חדש</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                <select value={fContractId} onChange={function(e){setFContractId(e.target.value);fillFromContract(e.target.value);}} className={ic}>
                  <option value="">-- בחר חוזה --</option>
                  {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;})}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג חיוב</label>
                <div className="grid grid-cols-3 gap-2">
                  {CHARGE_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFType(t.v);}}
                        className={"rounded-lg border p-2 text-center "+(fType===t.v?"border-blue-500 bg-blue-50":"border-slate-200 hover:bg-slate-50")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold "+(fType===t.v?"text-blue-700":"text-slate-600")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום בסיס (₪) *</label>
                  <input type="number" value={fBaseAmount} onChange={function(e){setFBaseAmount(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ</label>
                  <select value={fVatType} onChange={function(e){setFVatType(e.target.value);}} className={ic}>
                    <option value="taxable">חייב (18%)</option>
                    <option value="exempt">פטור</option>
                  </select>
                </div>
              </div>
              {fBaseAmount && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">בסיס</span>
                    <span className="font-semibold">{fmtMoney(Number(fBaseAmount))}</span>
                  </div>
                  {fVatType==="taxable" && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">מע"מ 18%</span>
                      <span>{fmtMoney(Number(fBaseAmount)*0.18)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-blue-800 pt-1 border-t border-blue-200 mt-1">
                    <span>סה"כ</span>
                    <span>{fmtMoney(Number(fBaseAmount)*(fVatType==="taxable"?1.18:1))}</span>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תקופה מ-</label>
                  <input type="date" value={fPeriodFrom} onChange={function(e){setFPeriodFrom(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תקופה עד</label>
                  <input type="date" value={fPeriodTo} onChange={function(e){setFPeriodTo(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך לתשלום</label>
                <input type="date" value={fDueDate} onChange={function(e){setFDueDate(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "שמור חיוב"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
