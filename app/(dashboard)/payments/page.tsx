"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const CHARGE_TYPES: Record<string, { label: string; icon: string }> = {
  rent:             { label: "שכ\"ד",              icon: "🏠" },
  management:       { label: "דמי ניהול",          icon: "🔧" },
  insurance:        { label: "ביטוח",              icon: "🛡️" },
  garbage:          { label: "פינוי אשפה",         icon: "🗑️" },
  electricity:      { label: "חשמל",               icon: "⚡" },
  parking:          { label: "חניה",               icon: "🅿️" },
  indexation_diff:  { label: "הפרשי הצמדה",       icon: "📊" },
  ti:               { label: "השקעות משכיר (TI)",  icon: "🔨" },
  other:            { label: "אחר",                icon: "📋" },
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; next?: string; nextLabel?: string }> = {
  draft:    { label: "טיוטה",           bg: "bg-slate-100",  color: "text-slate-600", next: "pending",  nextLabel: "שלח לאישור" },
  pending:  { label: "ממתין לאישור",   bg: "bg-yellow-100", color: "text-yellow-700", next: "approved", nextLabel: "אשר" },
  approved: { label: "מאושר",          bg: "bg-blue-100",   color: "text-blue-700",  next: "issued",   nextLabel: "הפק מסמך" },
  issued:   { label: "הופק",           bg: "bg-purple-100", color: "text-purple-700", next: "paid",    nextLabel: "סמן כשולם" },
  paid:     { label: "שולם ✓",         bg: "bg-green-100",  color: "text-green-700" },
  cancelled:{ label: "בוטל",           bg: "bg-red-100",    color: "text-red-600" },
};

function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function fmtMonth(d: string) {
  if (!d) return "—";
  const months = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const [y,m] = d.split("-");
  return months[Number(m)-1] + " " + y;
}

export default function PaymentsPage() {
  const [charges,   setCharges]   = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState("");

  // פילטרים
  const [filterStatus,   setFilterStatus]   = useState("all");
  const [filterContract, setFilterContract] = useState("all");
  const [filterType,     setFilterType]     = useState("all");

  // מודל יצירה
  const [showNew,     setShowNew]     = useState(false);
  const [newContract, setNewContract] = useState("");
  const [newType,     setNewType]     = useState("rent");
  const [newPeriodStart, setNewPeriodStart] = useState("");
  const [newPeriodEnd,   setNewPeriodEnd]   = useState("");
  const [newBase,     setNewBase]     = useState("");
  const [newVatPct,   setNewVatPct]   = useState("18");
  const [newNotes,    setNewNotes]    = useState("");
  const [savingNew,   setSavingNew]   = useState(false);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: ch }, { data: co }] = await Promise.all([
      supabase.from("charges")
        .select("*, contracts(tenant_id, property_id, tenants(name), properties(name))")
        .order("period_start", { ascending: false }),
      supabase.from("contracts")
        .select("id, tenants(name), properties(name)")
        .in("status", ["active","expiring","extended"]),
    ]);
    setCharges(ch ?? []);
    setContracts(co ?? []);
    setLoading(false);
  }

  async function handleStatusChange(chargeId: string, newStatus: string) {
    setSaving(chargeId);
    const update: any = { status: newStatus };
    if (newStatus === "approved") {
      update.approved_at = new Date().toISOString();
    }
    await supabase.from("charges").update(update).eq("id", chargeId);
    await loadAll();
    setSaving("");
  }

  async function handleCancel(chargeId: string) {
    if (!confirm("לבטל חיוב זה?")) return;
    await supabase.from("charges").update({ status: "cancelled" }).eq("id", chargeId);
    await loadAll();
  }

  async function handleCreateCharge() {
    if (!newContract || !newPeriodStart || !newPeriodEnd || !newBase) {
      alert("חובה: חוזה, תקופה, סכום");
      return;
    }
    setSavingNew(true);
    try {
      const base  = Number(newBase);
      const vat   = newVatPct === "0" ? 0 : Math.round(base * Number(newVatPct) / 100 * 100) / 100;
      const total = Math.round((base + vat) * 100) / 100;
      const { error } = await supabase.from("charges").insert({
        contract_id:  newContract,
        charge_type:  newType,
        period_start: newPeriodStart,
        period_end:   newPeriodEnd,
        base_amount:  base,
        vat_amount:   vat,
        total_amount: total,
        status:       "draft",
        notes:        newNotes || null,
      });
      if (error) throw error;
      setShowNew(false);
      setNewContract(""); setNewType("rent"); setNewPeriodStart(""); setNewPeriodEnd("");
      setNewBase(""); setNewVatPct("18"); setNewNotes("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSavingNew(false); }
  }

  // סיכומים
  const totals = {
    pending:  charges.filter(function(c) { return c.status === "pending"; }).length,
    approved: charges.filter(function(c) { return c.status === "approved"; }).length,
    issued:   charges.filter(function(c) { return c.status === "issued"; }).length,
    total_pending_amount: charges
      .filter(function(c) { return c.status === "pending" || c.status === "approved" || c.status === "issued"; })
      .reduce(function(s, c) { return s + (c.total_amount ?? 0); }, 0),
  };

  const filtered = charges.filter(function(c) {
    const ms = filterStatus   === "all" || c.status      === filterStatus;
    const mc = filterContract === "all" || c.contract_id === filterContract;
    const mt = filterType     === "all" || c.charge_type === filterType;
    return ms && mc && mt;
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חיובים</h1>
          <p className="text-sm text-slate-500 mt-1">ניהול וביצוע חיובים לשוכרים</p>
        </div>
        <button onClick={function() { setShowNew(true); }}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + חיוב חדש
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-yellow-100 bg-yellow-50 p-4 text-center shadow-sm">
          <div className="text-2xl font-bold text-yellow-700">{totals.pending}</div>
          <div className="text-xs text-yellow-600 mt-1">ממתינים לאישור</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-center shadow-sm">
          <div className="text-2xl font-bold text-blue-700">{totals.approved}</div>
          <div className="text-xs text-blue-600 mt-1">מאושרים להפקה</div>
        </div>
        <div className="rounded-xl border border-purple-100 bg-purple-50 p-4 text-center shadow-sm">
          <div className="text-2xl font-bold text-purple-700">{totals.issued}</div>
          <div className="text-xs text-purple-600 mt-1">הופקו — ממתין לתשלום</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <div className="text-xl font-bold text-slate-900">₪{totals.total_pending_amount.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-1">סה&quot;כ פתוח</div>
        </div>
      </div>

      {/* פילטרים */}
      <div className="mb-4 flex flex-wrap gap-3">
        <select value={filterStatus} onChange={function(e) { setFilterStatus(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
          <option value="all">כל הסטטוסים</option>
          {Object.entries(STATUS_CONFIG).map(function([k,v]) { return <option key={k} value={k}>{v.label}</option>; })}
        </select>
        <select value={filterType} onChange={function(e) { setFilterType(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
          <option value="all">כל סוגי החיובים</option>
          {Object.entries(CHARGE_TYPES).map(function([k,v]) { return <option key={k} value={k}>{v.icon} {v.label}</option>; })}
        </select>
        <select value={filterContract} onChange={function(e) { setFilterContract(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
          <option value="all">כל החוזים</option>
          {contracts.map(function(c) {
            return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;
          })}
        </select>
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
          <div className="text-5xl mb-3">₪</div>
          <div>אין חיובים</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">שוכר</th>
                <th className="px-4 py-3 font-semibold">נכס</th>
                <th className="px-4 py-3 font-semibold">תקופה</th>
                <th className="px-4 py-3 font-semibold">בסיס</th>
                <th className="px-4 py-3 font-semibold">מע&quot;מ</th>
                <th className="px-4 py-3 font-semibold">סה&quot;כ</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(c) {
                const sc  = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft;
                const ct  = CHARGE_TYPES[c.charge_type] ?? CHARGE_TYPES.other;
                const isSaving = saving === c.id;
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + sc.bg + " " + sc.color}>
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm">{ct.icon} {ct.label}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {c.contracts?.tenants?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.contracts?.properties?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {fmtDate(c.period_start)} — {fmtDate(c.period_end)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">₪{(c.base_amount ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">₪{(c.vat_amount ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3 font-bold text-slate-900">₪{(c.total_amount ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {sc.next && (
                          <button
                            onClick={function() { handleStatusChange(c.id, sc.next!); }}
                            disabled={isSaving}
                            className="text-xs bg-blue-700 text-white px-2.5 py-1 rounded-lg hover:bg-blue-800 disabled:opacity-50 font-semibold whitespace-nowrap">
                            {isSaving ? "..." : sc.nextLabel}
                          </button>
                        )}
                        {c.status !== "paid" && c.status !== "cancelled" && (
                          <button
                            onClick={function() { handleCancel(c.id); }}
                            className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">
                            ביטול
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* זרימת סטטוסים */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-bold text-slate-500 mb-3">זרימת אישור חיוב:</div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {["draft","pending","approved","issued","paid"].map(function(s, i, arr) {
            const sc = STATUS_CONFIG[s];
            return (
              <div key={s} className="flex items-center gap-2">
                <span className={"px-3 py-1.5 rounded-full font-semibold " + sc.bg + " " + sc.color}>
                  {sc.label}
                </span>
                {i < arr.length - 1 && <span className="text-slate-300">→</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* מודל יצירת חיוב */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setShowNew(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">חיוב חדש</h2>
              <button onClick={function() { setShowNew(false); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                <select value={newContract} onChange={function(e) { setNewContract(e.target.value); }} className={ic}>
                  <option value="">-- בחר חוזה --</option>
                  {contracts.map(function(c) {
                    return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג חיוב</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(CHARGE_TYPES).map(function([k,v]) {
                    return (
                      <button key={k} type="button"
                        onClick={function() { setNewType(k); }}
                        className={"rounded-lg border p-2 text-center text-xs transition-all " +
                          (newType === k ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-slate-50 text-slate-600")}>
                        <div className="text-lg">{v.icon}</div>
                        <div>{v.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תחילת תקופה *</label>
                  <input type="date" value={newPeriodStart}
                    onChange={function(e) { setNewPeriodStart(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סיום תקופה *</label>
                  <input type="date" value={newPeriodEnd}
                    onChange={function(e) { setNewPeriodEnd(e.target.value); }} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום לפני מע&quot;מ (₪) *</label>
                  <input type="number" value={newBase}
                    onChange={function(e) { setNewBase(e.target.value); }} className={ic} placeholder="0" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מע&quot;מ %</label>
                  <select value={newVatPct} onChange={function(e) { setNewVatPct(e.target.value); }} className={ic}>
                    <option value="0">0% — פטור</option>
                    <option value="17">17%</option>
                    <option value="18">18%</option>
                  </select>
                </div>
              </div>
              {newBase && (
                <div className="rounded-lg bg-green-50 border border-green-100 px-4 py-3 text-sm flex justify-between">
                  <span className="text-slate-600">סה&quot;כ כולל מע&quot;מ</span>
                  <span className="font-bold text-green-700">
                    ₪{Math.round(Number(newBase) * (1 + Number(newVatPct)/100)).toLocaleString()}
                  </span>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={newNotes}
                  onChange={function(e) { setNewNotes(e.target.value); }} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setShowNew(false); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  ביטול
                </button>
                <button onClick={handleCreateCharge} disabled={savingNew}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                  {savingNew ? "שומר..." : "צור חיוב"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
