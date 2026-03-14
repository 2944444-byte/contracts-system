"use client";
import { useState, useEffect, Fragment } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

const BUILDING_TYPES: Record<string,string> = {
  building: "מבנה", property: "רכוש", liability: "צד ג׳",
  employer: "חבות מעבידים", income_loss: "אובדן הכנסה", natural: "נזקי טבע",
};
const TENANT_TYPES: Record<string,string> = {
  liability: "צד ג׳", employer: "חבות מעבידים",
  property: "רכוש", equipment: "ציוד", other: "אחר",
};

export default function InsurancesPage() {
  const [tab, setTab] = useState<"building"|"tenant">("building");

  // ביטוח מבנה
  const [buildingIns, setBuildingIns] = useState<any[]>([]);
  const [properties,  setProperties]  = useState<any[]>([]);

  // ביטוח שוכרים
  const [tenantIns, setTenantIns] = useState<any[]>([]);
  const [tenants,   setTenants]   = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);

  // מודל
  const [editingId, setEditingId] = useState<string|null>(null);
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);

  // שדות מבנה
  const [bPropId,    setBPropId]    = useState("");
  const [bInsurer,   setBInsurer]   = useState("");
  const [bPolicy,    setBPolicy]    = useState("");
  const [bType,      setBType]      = useState("building");
  const [bStart,     setBStart]     = useState("");
  const [bEnd,       setBEnd]       = useState("");
  const [bPremium,   setBPremium]   = useState("");
  const [bDeduct,    setBDeduct]    = useState("");
  const [bDocUrl,    setBDocUrl]    = useState("");
  const [bNotes,     setBNotes]     = useState("");

  // שדות שוכר
  const [tTenantId,  setTTenantId]  = useState("");
  const [tContractId,setTContractId]= useState("");
  const [tInsurer,   setTInsurer]   = useState("");
  const [tPolicy,    setTPolicy]    = useState("");
  const [tType,      setTType]      = useState("liability");
  const [tCoverage,  setTCoverage]  = useState("");
  const [tStart,     setTStart]     = useState("");
  const [tEnd,       setTEnd]       = useState("");
  const [tCertUrl,   setTCertUrl]   = useState("");
  const [tNotes,     setTNotes]     = useState("");

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [{ data: bi }, { data: ti }, { data: pr }, { data: te }, { data: co }] = await Promise.all([
      supabase.from("insurances_building").select("*, properties(name)").order("end_date"),
      supabase.from("insurances_tenant").select("*, tenants(name), contracts(tenant_id, properties(name))").order("end_date"),
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("tenants").select("id, name").order("name"),
      supabase.from("contracts").select("id, tenant_id, tenants(name), properties(name)").in("status",["active","expiring","extended"]),
    ]);
    setBuildingIns(bi ?? []);
    setTenantIns(ti ?? []);
    setProperties(pr ?? []);
    setTenants(te ?? []);
    setContracts(co ?? []);
  }

  function statusBadge(endDate: string, status: string) {
    if (status === "active" && endDate) {
      const d = daysLeft(endDate);
      if (d < 0)  return { label: "פג תוקף",    bg: "bg-red-100",    color: "text-red-700"    };
      if (d <= 30) return { label: `${d} ימים`,  bg: "bg-red-100",    color: "text-red-700"    };
      if (d <= 90) return { label: `${d} ימים`,  bg: "bg-yellow-100", color: "text-yellow-700" };
      return               { label: "בתוקף",     bg: "bg-green-100",  color: "text-green-700"  };
    }
    return { label: status === "active" ? "בתוקף" : "לא פעיל", bg: "bg-slate-100", color: "text-slate-500" };
  }

  // --- שמירת ביטוח מבנה ---
  async function saveBuildingIns() {
    if (!bPropId || !bEnd) { alert("חובה: נכס ותאריך סיום"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id: bPropId, insurer: bInsurer || null, policy_number: bPolicy || null,
        policy_type: bType, start_date: bStart || null, end_date: bEnd,
        total_premium: bPremium ? Number(bPremium) : null,
        deductible: bDeduct ? Number(bDeduct) : null,
        document_url: bDocUrl || null, notes: bNotes || null, status: "active",
      };
      if (isNew) {
        await supabase.from("insurances_building").insert(payload);
      } else {
        await supabase.from("insurances_building").update(payload).eq("id", editingId);
      }
      setEditingId(null);
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  // --- שמירת ביטוח שוכר ---
  async function saveTenantIns() {
    if (!tTenantId || !tEnd) { alert("חובה: שוכר ותאריך סיום"); return; }
    setSaving(true);
    try {
      const payload = {
        tenant_id: tTenantId, contract_id: tContractId || null,
        insurer: tInsurer || null, policy_number: tPolicy || null,
        insurance_type: tType, coverage_amount: tCoverage ? Number(tCoverage) : null,
        start_date: tStart || null, end_date: tEnd,
        certificate_url: tCertUrl || null, notes: tNotes || null, status: "active",
      };
      if (isNew) {
        await supabase.from("insurances_tenant").insert(payload);
      } else {
        await supabase.from("insurances_tenant").update(payload).eq("id", editingId);
      }
      setEditingId(null);
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  function openNewBuilding() {
    setIsNew(true); setEditingId("building-new");
    setBPropId(""); setBInsurer(""); setBPolicy(""); setBType("building");
    setBStart(""); setBEnd(""); setBPremium(""); setBDeduct(""); setBDocUrl(""); setBNotes("");
  }

  function openEditBuilding(ins: any) {
    setIsNew(false); setEditingId("building-" + ins.id);
    setBPropId(ins.property_id); setBInsurer(ins.insurer ?? ""); setBPolicy(ins.policy_number ?? "");
    setBType(ins.policy_type ?? "building"); setBStart(ins.start_date?.split("T")[0] ?? "");
    setBEnd(ins.end_date?.split("T")[0] ?? ""); setBPremium(ins.total_premium?.toString() ?? "");
    setBDeduct(ins.deductible?.toString() ?? ""); setBDocUrl(ins.document_url ?? ""); setBNotes(ins.notes ?? "");
  }

  function openNewTenant() {
    setIsNew(true); setEditingId("tenant-new");
    setTTenantId(""); setTContractId(""); setTInsurer(""); setTPolicy(""); setTType("liability");
    setTCoverage(""); setTStart(""); setTEnd(""); setTCertUrl(""); setTNotes("");
  }

  function openEditTenant(ins: any) {
    setIsNew(false); setEditingId("tenant-" + ins.id);
    setTTenantId(ins.tenant_id); setTContractId(ins.contract_id ?? "");
    setTInsurer(ins.insurer ?? ""); setTPolicy(ins.policy_number ?? ""); setTType(ins.insurance_type ?? "liability");
    setTCoverage(ins.coverage_amount?.toString() ?? ""); setTStart(ins.start_date?.split("T")[0] ?? "");
    setTEnd(ins.end_date?.split("T")[0] ?? ""); setTCertUrl(ins.certificate_url ?? ""); setTNotes(ins.notes ?? "");
  }

  async function deleteIns(table: string, id: string) {
    if (!confirm("למחוק ביטוח זה?")) return;
    await supabase.from(table).delete().eq("id", id);
    await loadAll();
  }

  const expiringSoon = [
    ...buildingIns.filter(i => i.end_date && daysLeft(i.end_date) <= 90 && daysLeft(i.end_date) >= 0),
    ...tenantIns.filter(i => i.end_date && daysLeft(i.end_date) <= 90 && daysLeft(i.end_date) >= 0),
  ].length;

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ביטוחים</h1>
          <p className="text-sm text-slate-500 mt-1">
            {expiringSoon > 0
              ? <span className="text-yellow-700">⚠️ {expiringSoon} ביטוחים פגים ב-90 ימים הקרובים</span>
              : "כל הביטוחים תקינים ✓"}
          </p>
        </div>
        <button onClick={tab === "building" ? openNewBuilding : openNewTenant}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + ביטוח חדש
        </button>
      </div>

      {/* טאבים */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        <button onClick={() => setTab("building")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${tab === "building" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
          🏢 ביטוח מבנה ({buildingIns.length})
        </button>
        <button onClick={() => setTab("tenant")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${tab === "tenant" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
          👤 ביטוחי שוכרים ({tenantIns.length})
        </button>
      </div>

      {/* ביטוח מבנה */}
      {tab === "building" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {buildingIns.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">🏢</div>
              <div>אין ביטוחי מבנה</div>
              <button onClick={openNewBuilding} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף ביטוח מבנה</button>
            </div>
          ) : (
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-semibold">נכס</th>
                  <th className="px-4 py-3 font-semibold">חברת ביטוח</th>
                  <th className="px-4 py-3 font-semibold">סוג</th>
                  <th className="px-4 py-3 font-semibold">פוליסה</th>
                  <th className="px-4 py-3 font-semibold">תוקף עד</th>
                  <th className="px-4 py-3 font-semibold">פרמיה שנתית</th>
                  <th className="px-4 py-3 font-semibold">סטטוס</th>
                  <th className="px-4 py-3 font-semibold">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {buildingIns.map(ins => {
                  const sb = statusBadge(ins.end_date, ins.status);
                  return (
                    <tr key={ins.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">{ins.properties?.name}</td>
                      <td className="px-4 py-3 text-slate-600">{ins.insurer ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{BUILDING_TYPES[ins.policy_type] ?? ins.policy_type}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{ins.policy_number ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{fmtDate(ins.end_date)}</td>
                      <td className="px-4 py-3 text-slate-700">{ins.total_premium ? `₪${ins.total_premium.toLocaleString()}` : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${sb.bg} ${sb.color}`}>{sb.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {ins.document_url && (
                            <a href={ins.document_url} target="_blank" rel="noopener noreferrer"
                              className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-500 hover:bg-slate-50">📎</a>
                          )}
                          <button onClick={() => openEditBuilding(ins)}
                            className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">עריכה</button>
                          <button onClick={() => deleteIns("insurances_building", ins.id)}
                            className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">מחיקה</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ביטוחי שוכרים */}
      {tab === "tenant" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {tenantIns.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">👤</div>
              <div>אין ביטוחי שוכרים</div>
              <button onClick={openNewTenant} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף ביטוח שוכר</button>
            </div>
          ) : (
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-semibold">שוכר</th>
                  <th className="px-4 py-3 font-semibold">חברת ביטוח</th>
                  <th className="px-4 py-3 font-semibold">סוג</th>
                  <th className="px-4 py-3 font-semibold">פוליסה</th>
                  <th className="px-4 py-3 font-semibold">כיסוי</th>
                  <th className="px-4 py-3 font-semibold">תוקף עד</th>
                  <th className="px-4 py-3 font-semibold">סטטוס</th>
                  <th className="px-4 py-3 font-semibold">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {tenantIns.map(ins => {
                  const sb = statusBadge(ins.end_date, ins.status);
                  return (
                    <tr key={ins.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">{ins.tenants?.name}</td>
                      <td className="px-4 py-3 text-slate-600">{ins.insurer ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{TENANT_TYPES[ins.insurance_type] ?? ins.insurance_type}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{ins.policy_number ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{ins.coverage_amount ? `₪${ins.coverage_amount.toLocaleString()}` : "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{fmtDate(ins.end_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${sb.bg} ${sb.color}`}>{sb.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {ins.certificate_url && (
                            <a href={ins.certificate_url} target="_blank" rel="noopener noreferrer"
                              className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-500 hover:bg-slate-50">📎</a>
                          )}
                          <button onClick={() => openEditTenant(ins)}
                            className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">עריכה</button>
                          <button onClick={() => deleteIns("insurances_tenant", ins.id)}
                            className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">מחיקה</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* מודל ביטוח מבנה */}
      {editingId?.startsWith("building") && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">{isNew ? "ביטוח מבנה חדש" : "עריכת ביטוח מבנה"}</h2>
              <button onClick={() => setEditingId(null)} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={bPropId} onChange={e => setBPropId(e.target.value)} className={ic}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חברת ביטוח</label>
                  <input type="text" value={bInsurer} onChange={e => setBInsurer(e.target.value)} className={ic} placeholder="מנורה, הפניקס..." />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר פוליסה</label>
                  <input type="text" value={bPolicy} onChange={e => setBPolicy(e.target.value)} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג ביטוח</label>
                <select value={bType} onChange={e => setBType(e.target.value)} className={ic}>
                  {Object.entries(BUILDING_TYPES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תחילת כיסוי</label>
                  <input type="date" value={bStart} onChange={e => setBStart(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סיום כיסוי *</label>
                  <input type="date" value={bEnd} onChange={e => setBEnd(e.target.value)} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">פרמיה שנתית (₪)</label>
                  <input type="number" value={bPremium} onChange={e => setBPremium(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">השתתפות עצמית (₪)</label>
                  <input type="number" value={bDeduct} onChange={e => setBDeduct(e.target.value)} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">קישור למסמך</label>
                <input type="url" value={bDocUrl} onChange={e => setBDocUrl(e.target.value)} className={ic} placeholder="https://..." />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={bNotes} onChange={e => setBNotes(e.target.value)} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">ביטול</button>
                <button onClick={saveBuildingIns} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* מודל ביטוח שוכר */}
      {editingId?.startsWith("tenant") && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">{isNew ? "ביטוח שוכר חדש" : "עריכת ביטוח שוכר"}</h2>
              <button onClick={() => setEditingId(null)} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר *</label>
                <select value={tTenantId} onChange={e => setTTenantId(e.target.value)} className={ic}>
                  <option value="">-- בחר שוכר --</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה (אופציונלי)</label>
                <select value={tContractId} onChange={e => setTContractId(e.target.value)} className={ic}>
                  <option value="">-- ללא שיוך לחוזה --</option>
                  {contracts.filter(c => !tTenantId || c.tenant_id === tTenantId).map(c => (
                    <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חברת ביטוח</label>
                  <input type="text" value={tInsurer} onChange={e => setTInsurer(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר פוליסה</label>
                  <input type="text" value={tPolicy} onChange={e => setTPolicy(e.target.value)} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סוג ביטוח</label>
                  <select value={tType} onChange={e => setTType(e.target.value)} className={ic}>
                    {Object.entries(TENANT_TYPES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום כיסוי (₪)</label>
                  <input type="number" value={tCoverage} onChange={e => setTCoverage(e.target.value)} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תחילת כיסוי</label>
                  <input type="date" value={tStart} onChange={e => setTStart(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סיום כיסוי *</label>
                  <input type="date" value={tEnd} onChange={e => setTEnd(e.target.value)} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">קישור לאישור ביטוח</label>
                <input type="url" value={tCertUrl} onChange={e => setTCertUrl(e.target.value)} className={ic} placeholder="https://..." />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={tNotes} onChange={e => setTNotes(e.target.value)} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">ביטול</button>
                <button onClick={saveTenantIns} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
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
