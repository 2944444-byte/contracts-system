"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const INS_TYPES = [
  { value: "property",   label: "ביטוח מבנה",      icon: "🏢" },
  { value: "contents",   label: "ביטוח תכולה",      icon: "📦" },
  { value: "liability",  label: "ביטוח אחריות",     icon: "⚖️" },
  { value: "fire",       label: "ביטוח אש ופריצה",  icon: "🔥" },
  { value: "other",      label: "אחר",              icon: "🛡️" },
];

function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default function InsurancesPage() {
  const [insurances, setInsurances] = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterType, setFilterType] = useState("all"); // tenant | building

  const [fContractId,  setFContractId]  = useState("");
  const [fPropertyId,  setFPropertyId]  = useState("");
  const [fInsType,     setFInsType]     = useState("property");
  const [fInsurer,     setFInsurer]     = useState("");
  const [fPolicyNum,   setFPolicyNum]   = useState("");
  const [fStartDate,   setFStartDate]   = useState("");
  const [fEndDate,     setFEndDate]     = useState("");
  const [fPremium,     setFPremium]     = useState("");
  const [fCoverage,    setFCoverage]    = useState("");
  const [fNotes,       setFNotes]       = useState("");
  const [fTable,       setFTable]       = useState("insurances_tenant");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: t }, { data: b }, { data: c }, { data: p }] = await Promise.all([
      supabase.from("insurances_tenant")
        .select("*, contracts(tenant_id, property_id, tenants(name), properties(name))")
        .order("end_date", { ascending: true }),
      supabase.from("insurances_building")
        .select("*, properties(name)")
        .order("end_date", { ascending: true }),
      supabase.from("contracts")
        .select("id, tenants(name), properties(name)")
        .in("status", ["active","expiring","extended"]),
      supabase.from("properties").select("id, name").order("name"),
    ]);
    const tenant   = (t ?? []).map(function(x) { return { ...x, _table: "tenant" }; });
    const building = (b ?? []).map(function(x) { return { ...x, _table: "building" }; });
    setInsurances([...tenant, ...building]);
    setContracts(c ?? []);
    setProperties(p ?? []);
    setLoading(false);
  }

  function openNew(table: string) {
    setIsNew(true); setEditingId("new"); setFTable(table);
    setFContractId(""); setFPropertyId(""); setFInsType("property");
    setFInsurer(""); setFPolicyNum(""); setFStartDate(""); setFEndDate("");
    setFPremium(""); setFCoverage(""); setFNotes("");
  }

  function openEdit(ins: any) {
    setIsNew(false); setEditingId(ins.id); setFTable(ins._table === "building" ? "insurances_building" : "insurances_tenant");
    setFContractId(ins.contract_id ?? ""); setFPropertyId(ins.property_id ?? "");
    setFInsType(ins.insurance_type ?? "property"); setFInsurer(ins.insurer ?? "");
    setFPolicyNum(ins.policy_number ?? ""); setFStartDate(ins.start_date?.split("T")[0] ?? "");
    setFEndDate(ins.end_date?.split("T")[0] ?? ""); setFPremium(ins.premium_amount?.toString() ?? "");
    setFCoverage(ins.coverage_amount?.toString() ?? ""); setFNotes(ins.notes ?? "");
  }

  async function handleSave() {
    if (!fEndDate) { alert("חובה: תאריך סיום"); return; }
    setSaving(true);
    try {
      const table = fTable;
      const isBuilding = table === "insurances_building";
      const payload: any = {
        insurance_type:  fInsType,
        insurer:         fInsurer || null,
        policy_number:   fPolicyNum || null,
        start_date:      fStartDate || null,
        end_date:        fEndDate,
        premium_amount:  fPremium ? Number(fPremium) : null,
        coverage_amount: fCoverage ? Number(fCoverage) : null,
        notes:           fNotes || null,
      };
      if (isBuilding) {
        if (!fPropertyId) { alert("חובה: נכס"); setSaving(false); return; }
        payload.property_id = fPropertyId;
      } else {
        if (!fContractId) { alert("חובה: חוזה"); setSaving(false); return; }
        payload.contract_id = fContractId;
      }
      if (isNew) {
        const { data } = await supabase.from(table).insert(payload).select().single();
        await logAudit({ entity_type: "insurance", entity_id: data.id, action: "create" });
      } else {
        await supabase.from(table).update(payload).eq("id", editingId);
        await logAudit({ entity_type: "insurance", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, table: string) {
    if (!confirm("למחוק ביטוח?")) return;
    const dbTable = table === "building" ? "insurances_building" : "insurances_tenant";
    await supabase.from(dbTable).delete().eq("id", id);
    await loadAll();
  }

  function statusBadge(ins: any) {
    const d = daysLeft(ins.end_date);
    if (d < 0)   return { label: "פג תוקף",   bg: "bg-red-100",    color: "text-red-700"    };
    if (d <= 30)  return { label: d + " ימים", bg: "bg-red-100",    color: "text-red-700"    };
    if (d <= 60)  return { label: d + " ימים", bg: "bg-yellow-100", color: "text-yellow-700" };
    return             { label: "תקין",      bg: "bg-green-100",  color: "text-green-700"  };
  }

  const filtered = insurances.filter(function(ins) {
    if (filterType === "tenant")   return ins._table === "tenant";
    if (filterType === "building") return ins._table === "building";
    return true;
  });

  const expiring = insurances.filter(function(i) {
    return daysLeft(i.end_date) <= 60 && daysLeft(i.end_date) >= 0;
  }).length;
  const expired = insurances.filter(function(i) { return daysLeft(i.end_date) < 0; }).length;

  const typeInfo = function(v: string) {
    return INS_TYPES.find(function(t) { return t.value === v; }) ?? INS_TYPES[4];
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ביטוחים</h1>
          <p className="text-sm text-slate-500 mt-1">
            {expired > 0   && <span className="text-red-600 font-semibold">{expired} פגו תוקף | </span>}
            {expiring > 0  && <span className="text-yellow-600 font-semibold">{expiring} פגים ב-60 יום | </span>}
            {insurances.length} ביטוחים במעקב
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={function() { openNew("insurances_tenant"); }}
            className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800">
            + ביטוח שוכר
          </button>
          <button onClick={function() { openNew("insurances_building"); }}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            + ביטוח מבנה
          </button>
        </div>
      </div>

      {/* פילטר */}
      <div className="mb-4 flex gap-2">
        {[
          { v: "all",      l: "הכל (" + insurances.length + ")" },
          { v: "tenant",   l: "🏠 שוכרים" },
          { v: "building", l: "🏢 מבנה" },
        ].map(function(t) {
          return (
            <button key={t.v} onClick={function() { setFilterType(t.v); }}
              className={"rounded-xl border px-4 py-2 text-sm font-semibold transition-all " +
                (filterType === t.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {t.l}
            </button>
          );
        })}
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
          <div className="text-5xl mb-3">🛡️</div>
          <div>אין ביטוחים</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">סוג</th>
                <th className="px-4 py-3 font-semibold">מבוטח / נכס</th>
                <th className="px-4 py-3 font-semibold">מבטח</th>
                <th className="px-4 py-3 font-semibold">פרמיה</th>
                <th className="px-4 py-3 font-semibold">תוקף עד</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(ins) {
                const sb = statusBadge(ins);
                const ti = typeInfo(ins.insurance_type);
                const d  = daysLeft(ins.end_date);
                return (
                  <tr key={ins.id} className={"border-t border-slate-100 " +
                    (d < 0 ? "bg-red-50" : d <= 30 ? "bg-yellow-50" : "hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + sb.bg + " " + sb.color}>
                        {sb.label}
                      </span>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {ins._table === "building" ? "🏢 מבנה" : "🏠 שוכר"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-base ml-1">{ti.icon}</span>
                      <span className="text-xs text-slate-600">{ti.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      {ins._table === "building" ? (
                        <div className="font-semibold text-slate-800">{ins.properties?.name}</div>
                      ) : (
                        <div>
                          <div className="font-semibold text-slate-800">{ins.contracts?.tenants?.name}</div>
                          <div className="text-xs text-slate-400">{ins.contracts?.properties?.name}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{ins.insurer ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {ins.premium_amount ? "₪" + ins.premium_amount.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(ins.end_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={function() { openEdit(ins); }}
                          className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">
                          עריכה
                        </button>
                        <button onClick={function() { handleDelete(ins.id, ins._table); }}
                          className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">
                          מחק
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

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">
                {isNew ? "+ ביטוח חדש" : "עריכת ביטוח"} — {fTable === "insurances_building" ? "🏢 מבנה" : "🏠 שוכר"}
              </h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              {fTable === "insurances_tenant" ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                  <select value={fContractId} onChange={function(e) { setFContractId(e.target.value); }} className={ic}>
                    <option value="">-- בחר חוזה --</option>
                    {contracts.map(function(c) { return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>; })}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                  <select value={fPropertyId} onChange={function(e) { setFPropertyId(e.target.value); }} className={ic}>
                    <option value="">-- בחר נכס --</option>
                    {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג ביטוח</label>
                <div className="grid grid-cols-3 gap-2">
                  {INS_TYPES.map(function(t) {
                    return (
                      <button key={t.value} type="button" onClick={function() { setFInsType(t.value); }}
                        className={"rounded-lg border p-2 text-center transition-all " +
                          (fInsType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div className="text-lg">{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fInsType === t.value ? "text-blue-700" : "text-slate-600")}>{t.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חברת ביטוח</label>
                  <input type="text" value={fInsurer} onChange={function(e) { setFInsurer(e.target.value); }} className={ic} placeholder="כלל, מנורה..." />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר פוליסה</label>
                  <input type="text" value={fPolicyNum} onChange={function(e) { setFPolicyNum(e.target.value); }} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תחילת תוקף</label>
                  <input type="date" value={fStartDate} onChange={function(e) { setFStartDate(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סיום תוקף *</label>
                  <input type="date" value={fEndDate} onChange={function(e) { setFEndDate(e.target.value); }} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">פרמיה שנתית (₪)</label>
                  <input type="number" value={fPremium} onChange={function(e) { setFPremium(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום כיסוי (₪)</label>
                  <input type="number" value={fCoverage} onChange={function(e) { setFCoverage(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">ביטול</button>
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
