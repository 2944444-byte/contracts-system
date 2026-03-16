"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const INS_TYPES = [
  { v: "property",    l: "מבנה",          icon: "🏢" },
  { v: "liability",   l: "צד שלישי",      icon: "🛡️" },
  { v: "contents",    l: "תכולה",         icon: "📦" },
  { v: "fire",        l: "אש",            icon: "🔥" },
  { v: "earthquake",  l: "רעידת אדמה",   icon: "🌍" },
  { v: "other",       l: "אחר",           icon: "📋" },
];

function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function InsurancesPage() {
  const [insurances, setInsurances] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterSrc,  setFilterSrc]  = useState("all");
  const [filterExp,  setFilterExp]  = useState(false);

  const [fPropertyId,  setFPropertyId]  = useState("");
  const [fContractId,  setFContractId]  = useState("");
  const [fType,        setFType]        = useState("property");
  const [fSource,      setFSource]      = useState("building");
  const [fInsurer,     setFInsurer]     = useState("");
  const [fPolicyNum,   setFPolicyNum]   = useState("");
  const [fCoverage,    setFCoverage]    = useState("");
  const [fPremium,     setFPremium]     = useState("");
  const [fStartDate,   setFStartDate]   = useState("");
  const [fEndDate,     setFEndDate]     = useState("");
  const [fNotes,       setFNotes]       = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: ins }, { data: pr }, { data: c }] = await Promise.all([
      supabase.from("insurances_building").select("*, properties(name)")
        .order("end_date", { ascending: true })
        .then(function(r1) {
          return supabase.from("insurances_tenant")
            .select("*, contracts(tenants(name), properties(name))")
            .order("end_date", { ascending: true })
            .then(function(r2) {
              return {
                data: [
                  ...(r1.data ?? []).map(function(i: any) { return { ...i, _source: "building" }; }),
                  ...(r2.data ?? []).map(function(i: any) { return { ...i, _source: "tenant" }; }),
                ]
              };
            });
        }),
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("contracts").select("id, tenants(name), properties(name)").in("status",["active","expiring","extended"]),
    ]);
    setInsurances((ins.data ?? []).sort(function(a: any, b: any) {
      return (a.end_date ?? "").localeCompare(b.end_date ?? "");
    }));
    setProperties(pr ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFContractId(""); setFType("property"); setFSource("building");
    setFInsurer(""); setFPolicyNum(""); setFCoverage(""); setFPremium("");
    setFStartDate(""); setFEndDate(""); setFNotes("");
  }

  function openEdit(ins: any) {
    setIsNew(false); setEditingId(ins.id);
    setFSource(ins._source ?? "building");
    setFPropertyId(ins.property_id ?? ""); setFContractId(ins.contract_id ?? "");
    setFType(ins.insurance_type ?? "property"); setFInsurer(ins.insurer ?? "");
    setFPolicyNum(ins.policy_number ?? ""); setFCoverage(ins.coverage_amount?.toString() ?? "");
    setFPremium(ins.annual_premium?.toString() ?? "");
    setFStartDate(ins.start_date?.split("T")[0] ?? "");
    setFEndDate(ins.end_date?.split("T")[0] ?? ""); setFNotes(ins.notes ?? "");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const table = fSource === "building" ? "insurances_building" : "insurances_tenant";
      const payload: any = {
        insurance_type:  fType,
        insurer:         fInsurer || null,
        policy_number:   fPolicyNum || null,
        coverage_amount: fCoverage ? Number(fCoverage) : null,
        annual_premium:  fPremium  ? Number(fPremium)  : null,
        start_date:      fStartDate || null,
        end_date:        fEndDate   || null,
        notes:           fNotes     || null,
      };
      if (fSource === "building") payload.property_id = fPropertyId || null;
      else payload.contract_id = fContractId || null;

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

  async function handleDelete(id: string, source: string) {
    if (!confirm("למחוק ביטוח?")) return;
    const table = source === "building" ? "insurances_building" : "insurances_tenant";
    await supabase.from(table).delete().eq("id", id);
    await loadAll();
  }

  const filtered = insurances.filter(function(i: any) {
    const ms = filterSrc === "all" || i._source === filterSrc;
    const me = !filterExp || (i.end_date && daysLeft(i.end_date) <= 60);
    return ms && me;
  });

  const expiring60 = insurances.filter(function(i: any) { return i.end_date && daysLeft(i.end_date) <= 60; }).length;
  const expired    = insurances.filter(function(i: any) { return i.end_date && daysLeft(i.end_date) < 0; }).length;
  const typeInfo   = function(v: string) { return INS_TYPES.find(function(t) { return t.v === v; }) ?? INS_TYPES[5]; };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ביטוחים</h1>
          <p className="text-sm text-slate-500 mt-1">
            {insurances.length} ביטוחים
            {expiring60 > 0 && <span className="text-yellow-600 font-semibold"> | {expiring60} פגים ב-60 יום</span>}
            {expired > 0    && <span className="text-red-600 font-semibold"> | {expired} פגו!</span>}
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + ביטוח חדש
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "סה\"כ",       value: insurances.length,                                                       bg: "bg-white",      border: "border-slate-200",  color: "text-slate-800" },
          { label: "מבנה",        value: insurances.filter(function(i:any){return i._source==="building";}).length, bg: "bg-blue-50",   border: "border-blue-100",   color: "text-blue-700"  },
          { label: "שוכר",        value: insurances.filter(function(i:any){return i._source==="tenant";}).length,   bg: "bg-green-50",  border: "border-green-100",  color: "text-green-700" },
          { label: "פגים ב-60 י", value: expiring60,                                                               bg: expiring60>0?"bg-yellow-50":"bg-white", border: expiring60>0?"border-yellow-200":"border-slate-200", color: expiring60>0?"text-yellow-700":"text-slate-500" },
        ].map(function(k) {
          return (
            <div key={k.label} className={"rounded-xl border p-3 text-center " + k.bg + " " + k.border}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs " + k.color}>{k.label}</div>
            </div>
          );
        })}
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{v:"all",l:"הכל"},{v:"building",l:"🏢 מבנה"},{v:"tenant",l:"👤 שוכר"}].map(function(t) {
          return (
            <button key={t.v} onClick={function(){setFilterSrc(t.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSrc===t.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
              {t.l}
            </button>
          );
        })}
        <button onClick={function(){setFilterExp(!filterExp);}}
          className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
            (filterExp ? "border-yellow-500 bg-yellow-50 text-yellow-700" : "border-slate-200 text-slate-600")}>
          ⚠️ פגים ב-60 יום
        </button>
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🛡️</div><div>אין ביטוחים</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">סוג / מקור</th>
                <th className="px-4 py-3 font-semibold">נכס / שוכר</th>
                <th className="px-4 py-3 font-semibold">מבטח</th>
                <th className="px-4 py-3 font-semibold">כיסוי</th>
                <th className="px-4 py-3 font-semibold">תוקף עד</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(ins: any) {
                const ti = typeInfo(ins.insurance_type);
                const d  = ins.end_date ? daysLeft(ins.end_date) : 999;
                const statusColor = d < 0 ? "bg-red-100 text-red-700" : d <= 30 ? "bg-red-100 text-red-700" : d <= 60 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700";
                const statusLabel = d < 0 ? "פג!" : d <= 60 ? d + " יום" : "תקין";
                return (
                  <tr key={ins.id} className={"border-t border-slate-100 " + (d<0?"bg-red-50":d<=30?"bg-orange-50":d<=60?"bg-yellow-50":"hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{ti.icon}</span>
                        <div>
                          <div className="font-semibold text-slate-800 text-xs">{ti.l}</div>
                          <div className={"text-xs px-1.5 py-0.5 rounded-full inline-block mt-0.5 " +
                            (ins._source==="building" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700")}>
                            {ins._source==="building" ? "🏢 מבנה" : "👤 שוכר"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {ins._source==="building"
                        ? <div className="font-medium text-slate-700">{ins.properties?.name}</div>
                        : <div><div className="font-medium text-slate-700">{ins.contracts?.tenants?.name}</div>
                           <div className="text-xs text-slate-400">{ins.contracts?.properties?.name}</div></div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{ins.insurer ?? "—"}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {ins.coverage_amount ? "₪" + ins.coverage_amount.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(ins.end_date)}</td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + statusColor}>{statusLabel}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={function(){openEdit(ins);}}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                        <button onClick={function(){handleDelete(ins.id, ins._source);}}
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

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "ביטוח חדש" : "עריכת ביטוח"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">מקור ביטוח</label>
                <div className="grid grid-cols-2 gap-2">
                  {[{v:"building",l:"🏢 מבנה"},{v:"tenant",l:"👤 שוכר"}].map(function(s) {
                    return (
                      <button key={s.v} type="button" onClick={function(){setFSource(s.v);}}
                        className={"rounded-lg border p-2.5 text-center font-semibold text-sm " +
                          (fSource===s.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 hover:bg-slate-50")}>
                        {s.l}
                      </button>
                    );
                  })}
                </div>
              </div>
              {fSource==="building" ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
                  <select value={fPropertyId} onChange={function(e){setFPropertyId(e.target.value);}} className={ic}>
                    <option value="">-- בחר נכס --</option>
                    {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה / שוכר</label>
                  <select value={fContractId} onChange={function(e){setFContractId(e.target.value);}} className={ic}>
                    <option value="">-- בחר חוזה --</option>
                    {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;})}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג ביטוח</label>
                <div className="grid grid-cols-3 gap-2">
                  {INS_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFType(t.v);}}
                        className={"rounded-lg border p-2 text-center " +
                          (fType===t.v ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType===t.v ? "text-blue-700" : "text-slate-600")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חברת ביטוח</label>
                  <input type="text" value={fInsurer} onChange={function(e){setFInsurer(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר פוליסה</label>
                  <input type="text" value={fPolicyNum} onChange={function(e){setFPolicyNum(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום כיסוי (₪)</label>
                  <input type="number" value={fCoverage} onChange={function(e){setFCoverage(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">פרמיה שנתית (₪)</label>
                  <input type="number" value={fPremium} onChange={function(e){setFPremium(e.target.value);}} className={ic} />
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
