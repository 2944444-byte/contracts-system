"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const G_TYPES = [
  { value: "bank",       label: "ערבות בנקאית",    icon: "🏦" },
  { value: "check",      label: "צ׳ק ביטחון",      icon: "📝" },
  { value: "cash",       label: "מזומן",            icon: "💵" },
  { value: "personal",   label: "ערב אישי",         icon: "👤" },
  { value: "other",      label: "אחר",             icon: "📋" },
];

function daysLeft(d: string) {
  if (!d) return 999;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function GuaranteesPage() {
  const [guarantees, setGuarantees] = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterSt,   setFilterSt]   = useState("active");
  const [actionModal, setActionModal] = useState<{id:string;type:"forfeit"|"return"}|null>(null);
  const [actionNote,  setActionNote]  = useState("");
  const [actionSaving,setActionSaving]= useState(false);

  const [fContractId,  setFContractId]  = useState("");
  const [fType,        setFType]        = useState("bank");
  const [fAmount,      setFAmount]      = useState("");
  const [fStartDate,   setFStartDate]   = useState("");
  const [fEndDate,     setFEndDate]     = useState("");
  const [fBankName,    setFBankName]    = useState("");
  const [fRefNum,      setFRefNum]      = useState("");
  const [fNotes,       setFNotes]       = useState("");

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
    setGuarantees(g ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFContractId(""); setFType("bank"); setFAmount(""); setFStartDate("");
    setFEndDate(""); setFBankName(""); setFRefNum(""); setFNotes("");
  }

  function openEdit(g: any) {
    setIsNew(false); setEditingId(g.id);
    setFContractId(g.contract_id ?? ""); setFType(g.guarantee_type ?? "bank");
    setFAmount(g.amount_actual?.toString() ?? ""); setFStartDate(g.start_date?.split("T")[0] ?? "");
    setFEndDate(g.end_date?.split("T")[0] ?? ""); setFBankName(g.bank_name ?? "");
    setFRefNum(g.reference_number ?? ""); setFNotes(g.notes ?? "");
  }

  async function handleSave() {
    if (!fContractId) { alert("חובה: חוזה"); return; }
    if (!fAmount)     { alert("חובה: סכום"); return; }
    setSaving(true);
    try {
      const payload = {
        contract_id:      fContractId,
        guarantee_type:   fType,
        amount_actual:    Number(fAmount),
        start_date:       fStartDate || null,
        end_date:         fEndDate || null,
        bank_name:        fBankName || null,
        reference_number: fRefNum || null,
        notes:            fNotes || null,
        status:           "active",
      };
      if (isNew) {
        const { data } = await supabase.from("guarantees").insert(payload).select().single();
        await logAudit({ entity_type: "guarantee", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("guarantees").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "guarantee", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleAction() {
    if (!actionModal) return;
    setActionSaving(true);
    try {
      const newStatus = actionModal.type === "forfeit" ? "forfeited" : "returned";
      const dateField = actionModal.type === "forfeit" ? "forfeited_at" : "returned_at";
      await supabase.from("guarantees").update({
        status: newStatus,
        [dateField]: new Date().toISOString(),
        notes: actionNote || null,
      }).eq("id", actionModal.id);
      await logAudit({
        entity_type: "guarantee", entity_id: actionModal.id,
        action: actionModal.type, notes: actionNote,
      });
      setActionModal(null);
      setActionNote("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setActionSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק ערבות?")) return;
    await supabase.from("guarantees").delete().eq("id", id);
    await loadAll();
  }

  function statusBadge(g: any) {
    if (g.status === "returned")  return { label: "הוחזרה",  bg: "bg-slate-100", color: "text-slate-500" };
    if (g.status === "forfeited") return { label: "חולטה",   bg: "bg-red-100",   color: "text-red-700"  };
    const d = daysLeft(g.end_date);
    if (g.end_date && d < 0)   return { label: "פגה",     bg: "bg-red-100",    color: "text-red-700"    };
    if (g.end_date && d <= 60) return { label: d + " ימים",bg: "bg-yellow-100", color: "text-yellow-700" };
    return { label: "פעילה", bg: "bg-green-100", color: "text-green-700" };
  }

  const typeInfo = function(v: string) {
    return G_TYPES.find(function(t) { return t.value === v; }) ?? G_TYPES[4];
  };

  const filtered = guarantees.filter(function(g) {
    if (filterSt === "active")    return g.status === "active";
    if (filterSt === "returned")  return g.status === "returned";
    if (filterSt === "forfeited") return g.status === "forfeited";
    return true;
  });

  const totalActive = guarantees.filter(function(g) { return g.status === "active"; });
  const totalAmount = totalActive.reduce(function(s, g) { return s + (g.amount_actual ?? 0); }, 0);
  const expiring60  = totalActive.filter(function(g) { return g.end_date && daysLeft(g.end_date) <= 60; }).length;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ערבויות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {totalActive.length} פעילות | ₪{Math.round(totalAmount).toLocaleString()} סה"כ
            {expiring60 > 0 && <span className="text-yellow-600 font-semibold"> | {expiring60} פגות ב-60 יום</span>}
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + ערבות חדשה
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "ערבויות פעילות", value: totalActive.length,                              color: "text-blue-700",  bg: "bg-blue-50",   border: "border-blue-100" },
          { label: "סה\"כ בערבות",   value: "₪" + Math.round(totalAmount).toLocaleString(),  color: "text-green-700", bg: "bg-green-50",  border: "border-green-100" },
          { label: "פגות ב-60 יום",  value: expiring60,                                       color: "text-yellow-700",bg: "bg-yellow-50", border: "border-yellow-100" },
          { label: "חולטו / הוחזרו", value: guarantees.filter(function(g){return g.status!=="active";}).length, color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200" },
        ].map(function(k) {
          return (
            <div key={k.label} className={"rounded-xl border p-4 " + k.bg + " " + k.border}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
            </div>
          );
        })}
      </div>

      {/* פילטר */}
      <div className="mb-4 flex gap-2">
        {[
          { v: "active",    l: "פעילות" },
          { v: "returned",  l: "הוחזרו" },
          { v: "forfeited", l: "חולטו"  },
          { v: "all",       l: "הכל"    },
        ].map(function(t) {
          return (
            <button key={t.v} onClick={function() { setFilterSt(t.v); }}
              className={"rounded-xl border px-4 py-2 text-sm font-semibold transition-all " +
                (filterSt === t.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {t.l}
            </button>
          );
        })}
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🏦</div>
          <div>אין ערבויות</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">סכום</th>
                <th className="px-4 py-3 font-semibold">תוקף עד</th>
                <th className="px-4 py-3 font-semibold">בנק / פרטים</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(g) {
                const sb = statusBadge(g);
                const ti = typeInfo(g.guarantee_type);
                const isActive = g.status === "active";
                return (
                  <tr key={g.id} className={"border-t border-slate-100 " +
                    (g.status === "forfeited" ? "bg-red-50" :
                      g.status === "returned" ? "opacity-60" : "hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + sb.bg + " " + sb.color}>
                        {sb.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{g.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{g.contracts?.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-base ml-1">{ti.icon}</span>
                      <span className="text-xs text-slate-600">{ti.label}</span>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-800">
                      ₪{(g.amount_actual ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(g.end_date)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {g.bank_name ?? ""}{g.reference_number ? " | " + g.reference_number : ""}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {isActive && (
                          <>
                            <button onClick={function() { setActionModal({ id: g.id, type: "return" }); }}
                              className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 font-semibold">
                              ↩ החזר
                            </button>
                            <button onClick={function() { setActionModal({ id: g.id, type: "forfeit" }); }}
                              className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg hover:bg-red-700 font-semibold">
                              ✂ חלט
                            </button>
                          </>
                        )}
                        <button onClick={function() { openEdit(g); }}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">
                          עריכה
                        </button>
                        <button onClick={function() { handleDelete(g.id); }}
                          className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">
                          🗑
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

      {/* מודל פעולה — חילוט / החזרה */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setActionModal(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <h2 className={"font-bold text-xl mb-4 " + (actionModal.type === "forfeit" ? "text-red-700" : "text-green-700")}>
              {actionModal.type === "forfeit" ? "✂ חילוט ערבות" : "↩ החזרת ערבות"}
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              {actionModal.type === "forfeit"
                ? "פעולה זו תסמן את הערבות כחולטה. לא ניתן לבטל."
                : "פעולה זו תסמן את הערבות כמוחזרת לשוכר."}
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold text-slate-700">הערה (אופציונלי)</label>
              <textarea value={actionNote} onChange={function(e) { setActionNote(e.target.value); }}
                rows={3} className={ic} placeholder="סיבה, פרטים נוספים..." />
            </div>
            <div className="flex gap-3">
              <button onClick={function() { setActionModal(null); setActionNote(""); }}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
              <button onClick={handleAction} disabled={actionSaving}
                className={"flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50 " +
                  (actionModal.type === "forfeit" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700")}>
                {actionSaving ? "שומר..." : actionModal.type === "forfeit" ? "✂ אשר חילוט" : "↩ אשר החזרה"}
              </button>
            </div>
          </div>
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
                  {contracts.map(function(c) { return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג ערבות</label>
                <div className="grid grid-cols-5 gap-2">
                  {G_TYPES.map(function(t) {
                    return (
                      <button key={t.value} type="button" onClick={function() { setFType(t.value); }}
                        className={"rounded-lg border p-2 text-center transition-all " +
                          (fType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div className="text-xl">{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType === t.value ? "text-blue-700" : "text-slate-600")}>{t.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סכום (₪) *</label>
                <input type="number" value={fAmount} onChange={function(e) { setFAmount(e.target.value); }} className={ic} placeholder="0" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך התחלה</label>
                  <input type="date" value={fStartDate} onChange={function(e) { setFStartDate(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך פקיעה</label>
                  <input type="date" value={fEndDate} onChange={function(e) { setFEndDate(e.target.value); }} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בנק / גוף מנפיק</label>
                  <input type="text" value={fBankName} onChange={function(e) { setFBankName(e.target.value); }} className={ic} placeholder="בנק הפועלים..." />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר אסמכתא</label>
                  <input type="text" value={fRefNum} onChange={function(e) { setFRefNum(e.target.value); }} className={ic} />
                </div>
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
