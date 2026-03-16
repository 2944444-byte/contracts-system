"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const CHARGE_TYPES = [
  { value: "rent",       label: "שכר דירה",      icon: "🏢" },
  { value: "management", label: "דמי ניהול",     icon: "🔧" },
  { value: "indexation", label: "הצמדה",          icon: "📈" },
  { value: "utilities",  label: "חשמל / מים",    icon: "💡" },
  { value: "other",      label: "אחר",           icon: "📋" },
];

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function PaymentsPage() {
  const [charges,   setCharges]   = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editingId, setEditingId] = useState("");
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [filterSt,  setFilterSt]  = useState("all");
  const [filterType,setFilterType]= useState("all");

  const [fContractId, setFContractId] = useState("");
  const [fType,       setFType]       = useState("rent");
  const [fAmount,     setFAmount]     = useState("");
  const [fVatPct,     setFVatPct]     = useState("18");
  const [fPeriodFrom, setFPeriodFrom] = useState("");
  const [fPeriodTo,   setFPeriodTo]   = useState("");
  const [fDueDate,    setFDueDate]    = useState("");
  const [fNotes,      setFNotes]      = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: ch }, { data: c }] = await Promise.all([
      supabase.from("charges")
        .select("*, contracts(tenant_id, property_id, tenants(name), properties(name))")
        .order("created_at", { ascending: false }),
      supabase.from("contracts")
        .select("id, tenants(name), properties(name)")
        .in("status", ["active","expiring","extended"]),
    ]);
    setCharges(ch ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFContractId(""); setFType("rent"); setFAmount(""); setFVatPct("18");
    setFPeriodFrom(""); setFPeriodTo(""); setFDueDate(""); setFNotes("");
  }

  function openEdit(ch: any) {
    setIsNew(false); setEditingId(ch.id);
    setFContractId(ch.contract_id ?? ""); setFType(ch.charge_type ?? "rent");
    setFAmount(ch.base_amount?.toString() ?? ""); setFVatPct(ch.vat_pct?.toString() ?? "18");
    setFPeriodFrom(ch.billing_period_start?.split("T")[0] ?? "");
    setFPeriodTo(ch.billing_period_end?.split("T")[0] ?? "");
    setFDueDate(ch.due_date?.split("T")[0] ?? ""); setFNotes(ch.notes ?? "");
  }

  // חישוב גרייס חלקי לפי ימי הרבעון
  function calcGrace(amount: number, gracePct: number, periodFrom: string, periodTo: string): number {
    if (!gracePct || !periodFrom || !periodTo) return amount;
    const from  = new Date(periodFrom);
    const to    = new Date(periodTo);
    const total = Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1;
    const grace = Math.min(gracePct / 100, 1);
    return amount * (1 - grace);
  }

  async function handleSave() {
    if (!fContractId) { alert("חובה: חוזה"); return; }
    if (!fAmount) { alert("חובה: סכום"); return; }
    setSaving(true);
    try {
      const base  = Number(fAmount);
      const vat   = base * (Number(fVatPct) / 100);
      const total = base + vat;
      const payload = {
        contract_id:           fContractId,
        charge_type:           fType,
        base_amount:           base,
        vat_pct:               Number(fVatPct),
        vat_amount:            vat,
        total_amount:          total,
        billing_period_start:  fPeriodFrom || null,
        billing_period_end:    fPeriodTo || null,
        due_date:              fDueDate || null,
        notes:                 fNotes || null,
        status:                "pending",
      };
      if (isNew) {
        const { data } = await supabase.from("charges").insert(payload).select().single();
        await logAudit({ entity_type: "charge", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("charges").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "charge", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function updateStatus(id: string, status: string) {
    const update: any = { status };
    if (status === "paid") update.paid_at = new Date().toISOString();
    await supabase.from("charges").update(update).eq("id", id);
    await logAudit({ entity_type: "charge", entity_id: id, action: "status_" + status });
    await loadAll();
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק חיוב?")) return;
    await supabase.from("charges").delete().eq("id", id);
    await loadAll();
  }

  const filtered = charges.filter(function(c) {
    const ms = filterSt   === "all" || c.status      === filterSt;
    const mt = filterType === "all" || c.charge_type === filterType;
    return ms && mt;
  });

  const totalPending  = charges.filter(function(c) { return c.status === "pending"; })
    .reduce(function(s, c) { return s + (c.total_amount ?? 0); }, 0);
  const totalApproved = charges.filter(function(c) { return c.status === "approved"; })
    .reduce(function(s, c) { return s + (c.total_amount ?? 0); }, 0);
  const totalPaid     = charges.filter(function(c) { return c.status === "paid"; })
    .reduce(function(s, c) { return s + (c.total_amount ?? 0); }, 0);

  const typeInfo = function(v: string) {
    return CHARGE_TYPES.find(function(t) { return t.value === v; }) ?? CHARGE_TYPES[4];
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חיובים ותשלומים</h1>
          <p className="text-sm text-slate-500 mt-1">{charges.length} חיובים</p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + חיוב חדש
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "ממתין לאישור",  amount: totalPending,  count: charges.filter(function(c){return c.status==="pending";}).length,  bg: "bg-yellow-50",  border: "border-yellow-100", color: "text-yellow-700" },
          { label: "אושר - לגבייה", amount: totalApproved, count: charges.filter(function(c){return c.status==="approved";}).length, bg: "bg-blue-50",    border: "border-blue-100",   color: "text-blue-700"   },
          { label: "שולם",          amount: totalPaid,     count: charges.filter(function(c){return c.status==="paid";}).length,     bg: "bg-green-50",   border: "border-green-100",  color: "text-green-700"  },
        ].map(function(k) {
          return (
            <div key={k.label} className={"rounded-xl border p-4 " + k.bg + " " + k.border}>
              <div className={"text-xl font-black " + k.color}>₪{Math.round(k.amount).toLocaleString()}</div>
              <div className="text-xs text-slate-500 mt-0.5">{k.label} ({k.count})</div>
            </div>
          );
        })}
      </div>

      {/* פילטרים */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {[
          { v: "all", l: "הכל" }, { v: "pending", l: "ממתין" },
          { v: "approved", l: "אושר" }, { v: "paid", l: "שולם" },
        ].map(function(t) {
          return (
            <button key={t.v} onClick={function() { setFilterSt(t.v); }}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSt === t.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
              {t.l}
            </button>
          );
        })}
        <div className="w-px bg-slate-200 mx-1" />
        {CHARGE_TYPES.map(function(t) {
          const cnt = charges.filter(function(c) { return c.charge_type === t.value; }).length;
          if (!cnt) return null;
          return (
            <button key={t.value} onClick={function() { setFilterType(filterType === t.value ? "all" : t.value); }}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterType === t.value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">💰</div>
          <div>אין חיובים</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">סכום</th>
                <th className="px-4 py-3 font-semibold">תקופה</th>
                <th className="px-4 py-3 font-semibold">לתשלום</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(ch) {
                const ti = typeInfo(ch.charge_type);
                return (
                  <tr key={ch.id} className={"border-t border-slate-100 " +
                    (ch.status === "paid" ? "opacity-60" : "hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{ch.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{ch.contracts?.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-base ml-1">{ti.icon}</span>
                      <span className="text-xs text-slate-600">{ti.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">₪{Math.round(ch.total_amount ?? 0).toLocaleString()}</div>
                      {ch.vat_amount > 0 && (
                        <div className="text-xs text-slate-400">כולל מע"מ ₪{Math.round(ch.vat_amount).toLocaleString()}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {ch.billing_period_start ? fmtDate(ch.billing_period_start) + " — " + fmtDate(ch.billing_period_end) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(ch.due_date)}</td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (ch.status === "paid"     ? "bg-green-100 text-green-700" :
                          ch.status === "approved" ? "bg-blue-100 text-blue-700"  :
                          "bg-yellow-100 text-yellow-700")}>
                        {ch.status === "paid" ? "✓ שולם" : ch.status === "approved" ? "אושר" : "ממתין"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {ch.status === "pending" && (
                          <button onClick={function() { updateStatus(ch.id, "approved"); }}
                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700 font-semibold">
                            ✓ אשר
                          </button>
                        )}
                        {ch.status === "approved" && (
                          <button onClick={function() { updateStatus(ch.id, "paid"); }}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 font-semibold">
                            💰 שולם
                          </button>
                        )}
                        <button onClick={function() { openEdit(ch); }}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                        <button onClick={function() { handleDelete(ch.id); }}
                          className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "חיוב חדש" : "עריכת חיוב"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                <select value={fContractId} onChange={function(e) { setFContractId(e.target.value); }} className={ic}>
                  <option value="">-- בחר חוזה --</option>
                  {contracts.map(function(c) { return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג חיוב</label>
                <div className="grid grid-cols-5 gap-2">
                  {CHARGE_TYPES.map(function(t) {
                    return (
                      <button key={t.value} type="button" onClick={function() { setFType(t.value); }}
                        className={"rounded-lg border p-2 text-center transition-all " +
                          (fType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType === t.value ? "text-blue-700" : "text-slate-600")}>{t.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום לפני מע"מ (₪) *</label>
                  <input type="number" value={fAmount} onChange={function(e) { setFAmount(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ %</label>
                  <input type="number" value={fVatPct} onChange={function(e) { setFVatPct(e.target.value); }} className={ic} />
                </div>
              </div>
              {fAmount && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                  סה"כ כולל מע"מ: <strong>₪{Math.round(Number(fAmount) * (1 + Number(fVatPct)/100)).toLocaleString()}</strong>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מ-תאריך</label>
                  <input type="date" value={fPeriodFrom} onChange={function(e) { setFPeriodFrom(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">עד-תאריך</label>
                  <input type="date" value={fPeriodTo} onChange={function(e) { setFPeriodTo(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך לתשלום</label>
                <input type="date" value={fDueDate} onChange={function(e) { setFDueDate(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
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
