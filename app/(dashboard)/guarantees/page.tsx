"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const GUARANTEE_TYPES: Record<string,{label:string;icon:string}> = {
  bank:     { label: "ערבות בנקאית", icon: "🏦" },
  check:    { label: "שיק ביטחון",   icon: "📝" },
  cash:     { label: "פיקדון מזומן", icon: "💵" },
  personal: { label: "ערבות אישית",  icon: "👤" },
  other:    { label: "אחר",           icon: "📋" },
};

const STATUS_CONFIG: Record<string,{label:string;bg:string;color:string}> = {
  active:    { label: "פעילה",      bg: "bg-green-100",  color: "text-green-700"  },
  expiring:  { label: "פוגת בקרוב", bg: "bg-yellow-100", color: "text-yellow-700" },
  expired:   { label: "פגת תוקף",  bg: "bg-red-100",    color: "text-red-700"    },
  forfeited: { label: "חולטה",      bg: "bg-orange-100", color: "text-orange-700" },
  returned:  { label: "הוחזרה",     bg: "bg-slate-100",  color: "text-slate-500"  },
};

function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default function GuaranteesPage() {
  const [guarantees, setGuarantees] = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [actionModal, setActionModal]   = useState<{type:"forfeit"|"return";id:string}|null>(null);
  const [actionNote,  setActionNote]    = useState("");
  const [actionAmount,setActionAmount]  = useState("");
  const [actionDate,  setActionDate]    = useState(new Date().toISOString().split("T")[0]);

  const [fContractId,   setFContractId]   = useState("");
  const [fType,         setFType]         = useState("bank");
  const [fAmountReq,    setFAmountReq]    = useState("");
  const [fAmountActual, setFAmountActual] = useState("");
  const [fBank,         setFBank]         = useState("");
  const [fStartDate,    setFStartDate]    = useState("");
  const [fEndDate,      setFEndDate]      = useState("");
  const [fDocUrl,       setFDocUrl]       = useState("");
  const [fNotes,        setFNotes]        = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: g }, { data: c }] = await Promise.all([
      supabase.from("guarantees")
        .select("*, contracts(tenant_id, property_id, tenants(name), properties(name))")
        .order("end_date", { ascending: true }),
      supabase.from("contracts")
        .select("id, tenants(name), properties(name)")
        .in("status", ["active","expiring","extended"]),
    ]);
    // חשב סטטוס לכל ערבות
    const enriched = (g ?? []).map(function(gu) {
      if (gu.status === "forfeited" || gu.status === "returned") return gu;
      const d = daysLeft(gu.end_date);
      const computedStatus = d < 0 ? "expired" : d <= 60 ? "expiring" : "active";
      return { ...gu, computedStatus };
    });
    setGuarantees(enriched);
    setContracts(c ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFContractId(""); setFType("bank"); setFAmountReq(""); setFAmountActual("");
    setFBank(""); setFStartDate(""); setFEndDate(""); setFDocUrl(""); setFNotes("");
  }

  function openEdit(g: any) {
    setIsNew(false); setEditingId(g.id);
    setFContractId(g.contract_id ?? ""); setFType(g.guarantee_type ?? "bank");
    setFAmountReq(g.amount_required?.toString() ?? ""); setFAmountActual(g.amount_actual?.toString() ?? "");
    setFBank(g.bank ?? ""); setFStartDate(g.start_date?.split("T")[0] ?? "");
    setFEndDate(g.end_date?.split("T")[0] ?? ""); setFDocUrl(g.document_url ?? ""); setFNotes(g.notes ?? "");
  }

  async function handleSave() {
    if (!fContractId || !fEndDate) { alert("חובה: חוזה ותוקף"); return; }
    setSaving(true);
    try {
      const payload = {
        contract_id:     fContractId,
        guarantee_type:  fType,
        amount_required: fAmountReq ? Number(fAmountReq) : null,
        amount_actual:   fAmountActual ? Number(fAmountActual) : null,
        bank:            fBank || null,
        start_date:      fStartDate || null,
        end_date:        fEndDate,
        document_url:    fDocUrl || null,
        notes:           fNotes || null,
        status:          "active",
      };
      if (isNew) {
        const { data } = await supabase.from("guarantees").insert(payload).select().single();
        await logAudit({ entity_type:"guarantee", entity_id: data.id, action:"create" });
      } else {
        await supabase.from("guarantees").update(payload).eq("id", editingId);
        await logAudit({ entity_type:"guarantee", entity_id: editingId, action:"update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleAction() {
    if (!actionModal) return;
    setSaving(true);
    try {
      if (actionModal.type === "forfeit") {
        await supabase.from("guarantees").update({
          status: "forfeited",
          forfeited_at: actionDate,
          forfeited_amount: actionAmount ? Number(actionAmount) : null,
          notes: actionNote || null,
        }).eq("id", actionModal.id);
        await logAudit({ entity_type:"guarantee", entity_id: actionModal.id, action:"forfeit", notes: actionNote });
      } else {
        await supabase.from("guarantees").update({
          status: "returned",
          returned_at: actionDate,
          notes: actionNote || null,
        }).eq("id", actionModal.id);
        await logAudit({ entity_type:"guarantee", entity_id: actionModal.id, action:"return", notes: actionNote });
      }
      setActionModal(null); setActionNote(""); setActionAmount(""); setActionDate(new Date().toISOString().split("T")[0]);
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  const filtered = guarantees.filter(function(g) {
    const st = g.computedStatus ?? g.status;
    return filterStatus === "all" || st === filterStatus;
  });

  const expiringSoon = guarantees.filter(function(g) {
    return (g.computedStatus === "expiring" || g.computedStatus === "expired");
  }).length;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ערבויות ובטחונות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {expiringSoon > 0 && <span className="text-red-600 font-semibold">{expiringSoon} ערבויות דורשות תשומת לב | </span>}
            {guarantees.length} ערבויות במעקב
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + ערבות חדשה
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {Object.entries(STATUS_CONFIG).map(function([k,v]) {
          const count = guarantees.filter(function(g) { return (g.computedStatus ?? g.status) === k; }).length;
          const total = guarantees.filter(function(g) { return (g.computedStatus ?? g.status) === k; })
            .reduce(function(s,g) { return s + (g.amount_actual ?? g.amount_required ?? 0); }, 0);
          if (!count && k !== "active") return null;
          return (
            <button key={k} onClick={function() { setFilterStatus(filterStatus === k ? "all" : k); }}
              className={"rounded-xl border p-4 shadow-sm text-center transition-all " +
                (filterStatus === k ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50")}>
              <div className={"text-2xl font-bold " + v.color}>{count}</div>
              <div className="text-xs font-semibold text-slate-600 mt-0.5">{v.label}</div>
              {total > 0 && <div className="text-xs text-slate-400 mt-0.5">₪{total.toLocaleString()}</div>}
            </button>
          );
        })}
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
          <div className="text-5xl mb-3">🏦</div>
          <div>אין ערבויות</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold">נדרש</th>
                <th className="px-4 py-3 font-semibold">בפועל</th>
                <th className="px-4 py-3 font-semibold">תוקף</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(g) {
                const st = g.computedStatus ?? g.status;
                const sc = STATUS_CONFIG[st] ?? STATUS_CONFIG.active;
                const gt = GUARANTEE_TYPES[g.guarantee_type] ?? GUARANTEE_TYPES.other;
                const gap = g.amount_required && g.amount_actual
                  ? g.amount_actual - g.amount_required : null;
                return (
                  <tr key={g.id} className={"border-t border-slate-100 " +
                    (st === "expired" ? "bg-red-50" : st === "expiring" ? "bg-yellow-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + sc.bg + " " + sc.color}>
                        {sc.label}
                      </span>
                      {st === "expiring" && (
                        <div className="text-xs text-yellow-600 mt-0.5">
                          {daysLeft(g.end_date)} ימים
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-base ml-1">{gt.icon}</span>
                      <span className="text-xs text-slate-600">{gt.label}</span>
                      {g.bank && <div className="text-xs text-slate-400">{g.bank}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{g.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{g.contracts?.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {g.amount_required ? "₪" + g.amount_required.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {g.amount_actual ? (
                        <div>
                          <span className="font-semibold">₪{g.amount_actual.toLocaleString()}</span>
                          {gap !== null && (
                            <div className={"text-xs " + (gap >= 0 ? "text-green-600" : "text-red-600")}>
                              {gap >= 0 ? "✓" : "⚠️ פער: ₪" + Math.abs(gap).toLocaleString()}
                            </div>
                          )}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(g.end_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={function() { openEdit(g); }}
                          className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">
                          עריכה
                        </button>
                        {st !== "forfeited" && st !== "returned" && (
                          <>
                            <button onClick={function() { setActionModal({type:"forfeit",id:g.id}); }}
                              className="text-xs border border-orange-200 rounded px-2 py-1 text-orange-600 hover:bg-orange-50">
                              חילוט
                            </button>
                            <button onClick={function() { setActionModal({type:"return",id:g.id}); }}
                              className="text-xs border border-green-200 rounded px-2 py-1 text-green-600 hover:bg-green-50">
                              החזרה
                            </button>
                          </>
                        )}
                        {g.document_url && (
                          <a href={g.document_url} target="_blank" rel="noopener noreferrer"
                            className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-500 hover:bg-slate-50">
                            📎
                          </a>
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

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "ערבות חדשה" : "עריכת ערבות"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                <select value={fContractId} onChange={function(e) { setFContractId(e.target.value); }} className={ic}>
                  <option value="">-- בחר חוזה --</option>
                  {contracts.map(function(c) {
                    return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג ערבות</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(GUARANTEE_TYPES).map(function([k,v]) {
                    return (
                      <button key={k} type="button" onClick={function() { setFType(k); }}
                        className={"rounded-lg border p-2.5 text-center transition-all " +
                          (fType === k ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div className="text-lg">{v.icon}</div>
                        <div className={"text-xs font-semibold " + (fType === k ? "text-blue-700" : "text-slate-600")}>
                          {v.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום נדרש (₪)</label>
                  <input type="number" value={fAmountReq}
                    onChange={function(e) { setFAmountReq(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום בפועל (₪)</label>
                  <input type="number" value={fAmountActual}
                    onChange={function(e) { setFAmountActual(e.target.value); }} className={ic} />
                </div>
              </div>
              {fType === "bank" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בנק / סניף</label>
                  <input type="text" value={fBank}
                    onChange={function(e) { setFBank(e.target.value); }} className={ic} placeholder="הפועלים / תל אביב" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תחילת תוקף</label>
                  <input type="date" value={fStartDate}
                    onChange={function(e) { setFStartDate(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סיום תוקף *</label>
                  <input type="date" value={fEndDate}
                    onChange={function(e) { setFEndDate(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">קישור למסמך</label>
                <input type="url" value={fDocUrl}
                  onChange={function(e) { setFDocUrl(e.target.value); }} className={ic} placeholder="https://..." />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes}
                  onChange={function(e) { setFNotes(e.target.value); }} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">
                  ביטול
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* מודל חילוט/החזרה */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setActionModal(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">
                {actionModal.type === "forfeit" ? "⚠️ חילוט ערבות" : "✅ החזרת ערבות"}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך</label>
                <input type="date" value={actionDate}
                  onChange={function(e) { setActionDate(e.target.value); }} className={ic} />
              </div>
              {actionModal.type === "forfeit" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום שחולט (₪)</label>
                  <input type="number" value={actionAmount}
                    onChange={function(e) { setActionAmount(e.target.value); }} className={ic} />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סיבה / הערות</label>
                <input type="text" value={actionNote}
                  onChange={function(e) { setActionNote(e.target.value); }} className={ic} />
              </div>
              <div className="flex gap-3">
                <button onClick={function() { setActionModal(null); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">
                  ביטול
                </button>
                <button onClick={handleAction} disabled={saving}
                  className={"flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50 " +
                    (actionModal.type === "forfeit" ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700")}>
                  {saving ? "..." : actionModal.type === "forfeit" ? "חלט ערבות" : "אשר החזרה"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
