"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const GUARANTEE_TYPES = [
  { v:"bank",       l:"ערבות בנקאית",   icon:"🏦" },
  { v:"check",      l:"שיקים",          icon:"📝" },
  { v:"cash",       l:"מזומן",          icon:"💵" },
  { v:"insurance",  l:"ביטוח",          icon:"🛡️" },
  { v:"personal",   l:"ערבות אישית",    icon:"👤" },
  { v:"other",      l:"אחר",            icon:"📋" },
];

function daysLeft(d: string) {
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

  const [fContractId,  setFContractId]  = useState("");
  const [fType,        setFType]        = useState("bank");
  const [fRequired,    setFRequired]    = useState("");
  const [fActual,      setFActual]      = useState("");
  const [fBank,        setFBank]        = useState("");
  const [fRef,         setFRef]         = useState("");
  const [fStartDate,   setFStartDate]   = useState("");
  const [fEndDate,     setFEndDate]     = useState("");
  const [fStatus,      setFStatus]      = useState("active");
  const [fNotes,       setFNotes]       = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: g }, { data: c }] = await Promise.all([
      supabase.from("guarantees")
        .select("*, contracts(tenants(name), properties(name))")
        .order("end_date"),
      supabase.from("contracts")
        .select("id, tenants(name), properties(name)")
        .in("status", ["active","expiring","extended","upcoming"]),
    ]);
    setGuarantees(g ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFContractId(""); setFType("bank"); setFRequired(""); setFActual("");
    setFBank(""); setFRef(""); setFStartDate(""); setFEndDate(""); setFStatus("active"); setFNotes("");
  }

  function openEdit(g: any) {
    setIsNew(false); setEditingId(g.id);
    setFContractId(g.contract_id??""); setFType(g.guarantee_type??"bank");
    setFRequired(g.amount_required?.toString()??""); setFActual(g.amount_actual?.toString()??"");
    setFBank(g.bank_name??""); setFRef(g.reference_number??"");
    setFStartDate(g.start_date?.split("T")[0]??""); setFEndDate(g.end_date?.split("T")[0]??"");
    setFStatus(g.status??"active"); setFNotes(g.notes??"");
  }

  async function handleSave() {
    if (!fContractId) { alert("חובה: חוזה"); return; }
    setSaving(true);
    try {
      const payload = {
        contract_id:       fContractId,
        guarantee_type:    fType,
        amount_required:   fRequired ? Number(fRequired) : null,
        amount_actual:     fActual   ? Number(fActual)   : null,
        bank_name:         fBank     || null,
        reference_number:  fRef      || null,
        start_date:        fStartDate || null,
        end_date:          fEndDate   || null,
        status:            fStatus,
        notes:             fNotes    || null,
      };
      if (isNew) {
        const { data } = await supabase.from("guarantees").insert(payload).select().single();
        await logAudit({ entity_type:"guarantee", entity_id:data.id, action:"create" });
      } else {
        await supabase.from("guarantees").update(payload).eq("id", editingId);
        await logAudit({ entity_type:"guarantee", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleReturn(id: string) {
    if (!confirm("לסמן ערבות כ'הוחזרה'?")) return;
    await supabase.from("guarantees").update({ status: "returned", returned_at: new Date().toISOString() }).eq("id", id);
    await logAudit({ entity_type:"guarantee", entity_id:id, action:"returned" });
    await loadAll();
  }

  async function handleForfeit(id: string) {
    if (!confirm("לסמן ערבות כ'מומשה'?")) return;
    await supabase.from("guarantees").update({ status: "forfeited" }).eq("id", id);
    await logAudit({ entity_type:"guarantee", entity_id:id, action:"forfeited" });
    await loadAll();
  }

  const filtered = guarantees.filter(function(g) {
    return filterSt === "all" || g.status === filterSt;
  });

  const active   = guarantees.filter(function(g) { return g.status === "active"; });
  const expiring = guarantees.filter(function(g) {
    return g.status === "active" && g.end_date && daysLeft(g.end_date) <= 60;
  });
  const totalActive = active.reduce(function(s,g) { return s + (g.amount_actual??0); }, 0);
  const hasGap    = active.filter(function(g) {
    return (g.amount_actual??0) < (g.amount_required??0);
  });

  const typeInfo = function(v: string) {
    return GUARANTEE_TYPES.find(function(t) { return t.v===v; }) ?? GUARANTEE_TYPES[5];
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ערבויות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {active.length} פעילות | סה"כ ₪{Math.round(totalActive).toLocaleString()}
            {expiring.length > 0 && <span className="text-yellow-600 font-semibold"> | {expiring.length} פגות ב-60 יום</span>}
            {hasGap.length > 0 && <span className="text-red-600 font-semibold"> | {hasGap.length} עם פער!</span>}
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
          { label:"פעילות",    value:active.length,   sub:"₪"+Math.round(totalActive).toLocaleString(), bg:"bg-white",      border:"border-slate-200",  color:"text-slate-800",  filter:"active"   },
          { label:"פגות ב-60", value:expiring.length, sub:"יש לחדש",  bg:expiring.length>0?"bg-yellow-50":"bg-white", border:expiring.length>0?"border-yellow-200":"border-slate-200", color:expiring.length>0?"text-yellow-700":"text-slate-400", filter:"active" },
          { label:"עם פער",    value:hasGap.length,   sub:"סכום נמוך", bg:hasGap.length>0?"bg-red-50":"bg-white",     border:hasGap.length>0?"border-red-200":"border-slate-200",       color:hasGap.length>0?"text-red-700":"text-slate-400",      filter:"active" },
          { label:"הכל",       value:guarantees.length,sub:"",         bg:"bg-white",      border:"border-slate-200",  color:"text-slate-600",  filter:"all"      },
        ].map(function(k) {
          return (
            <button key={k.label} onClick={function(){setFilterSt(k.filter);}}
              className={"rounded-xl border p-3 text-center transition-all " + k.bg + " " + k.border + (filterSt===k.filter?" ring-2 ring-blue-400":"")}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
              {k.sub && <div className="text-xs text-slate-400">{k.sub}</div>}
            </button>
          );
        })}
      </div>

      {/* פילטר סטטוס */}
      <div className="flex gap-2 mb-4">
        {[{v:"active",l:"פעילות"},{v:"returned",l:"הוחזרו"},{v:"forfeited",l:"מומשו"},{v:"all",l:"הכל"}].map(function(s) {
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
          <div className="text-5xl mb-3">🏦</div><div>אין ערבויות</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold">נדרש</th>
                <th className="px-4 py-3 font-semibold">בפועל</th>
                <th className="px-4 py-3 font-semibold">פער</th>
                <th className="px-4 py-3 font-semibold">תוקף</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(g) {
                const ti   = typeInfo(g.guarantee_type);
                const diff = (g.amount_actual??0) - (g.amount_required??0);
                const d    = g.end_date ? daysLeft(g.end_date) : null;
                const rowColor = g.status!=="active" ? "opacity-60" : diff<0 ? "bg-red-50" : d!==null&&d<=30 ? "bg-orange-50" : d!==null&&d<=60 ? "bg-yellow-50" : "hover:bg-slate-50";
                return (
                  <tr key={g.id} className={"border-t border-slate-100 " + rowColor}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{ti.icon}</span>
                        <span className="font-semibold text-slate-800 text-xs">{ti.l}</span>
                      </div>
                      {g.bank_name && <div className="text-xs text-slate-400 mt-0.5">{g.bank_name}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{g.contracts?.tenants?.name}</div>
                      <div className="text-xs text-slate-400">{g.contracts?.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{g.amount_required ? "₪"+Math.round(g.amount_required).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{g.amount_actual ? "₪"+Math.round(g.amount_actual).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3">
                      {g.amount_required && g.amount_actual && (
                        <span className={diff<0?"text-red-600 font-bold":"text-green-600 font-semibold"}>
                          {diff<0 ? "-₪"+Math.abs(Math.round(diff)).toLocaleString() : "✓ תקין"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {fmtDate(g.end_date)}
                      {d !== null && d <= 60 && g.status==="active" && (
                        <div className={"text-xs font-semibold " + (d<=30?"text-red-600":"text-yellow-600")}>{d} יום</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (g.status==="active"?"bg-green-100 text-green-700":g.status==="returned"?"bg-slate-100 text-slate-600":"bg-orange-100 text-orange-700")}>
                        {g.status==="active"?"פעילה":g.status==="returned"?"הוחזרה":"מומשה"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={function(){openEdit(g);}}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                        {g.status==="active" && (
                          <>
                            <button onClick={function(){handleReturn(g.id);}}
                              className="text-xs border border-green-200 rounded px-2 py-1 text-green-700 hover:bg-green-50">↩ הוחזר</button>
                            <button onClick={function(){handleForfeit(g.id);}}
                              className="text-xs border border-red-200 rounded px-2 py-1 text-red-600 hover:bg-red-50">💸 מומש</button>
                          </>
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

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "ערבות חדשה" : "עריכת ערבות"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                <select value={fContractId} onChange={function(e){setFContractId(e.target.value);}} className={ic}>
                  <option value="">-- בחר חוזה --</option>
                  {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;})}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג ערבות</label>
                <div className="grid grid-cols-3 gap-2">
                  {GUARANTEE_TYPES.map(function(t) {
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
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום נדרש (₪)</label>
                  <input type="number" value={fRequired} onChange={function(e){setFRequired(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום בפועל (₪)</label>
                  <input type="number" value={fActual} onChange={function(e){setFActual(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בנק / מוציא</label>
                  <input type="text" value={fBank} onChange={function(e){setFBank(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר אסמכתא</label>
                  <input type="text" value={fRef} onChange={function(e){setFRef(e.target.value);}} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תחילה</label>
                  <input type="date" value={fStartDate} onChange={function(e){setFStartDate(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סיום</label>
                  <input type="date" value={fEndDate} onChange={function(e){setFEndDate(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}>
                  <option value="active">פעילה</option>
                  <option value="returned">הוחזרה</option>
                  <option value="forfeited">מומשה</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
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
