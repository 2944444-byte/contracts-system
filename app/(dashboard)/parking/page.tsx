"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const SUB_TYPES = [
  { v: "monthly",     l: "מנוי חודשי",  icon: "🅿️" },
  { v: "occasional",  l: "מזדמן",       icon: "🚗" },
  { v: "reserved",    l: "שמורה",       icon: "🔒" },
  { v: "disabled",    l: "נכים",        icon: "♿" },
];

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function ParkingPage() {
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [properties,    setProperties]    = useState<any[]>([]);
  const [tenants,       setTenants]       = useState<any[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [editingId,     setEditingId]     = useState("");
  const [isNew,         setIsNew]         = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [filterType,    setFilterType]    = useState("all");
  const [filterProp,    setFilterProp]    = useState("all");

  const [fPropertyId,  setFPropertyId]  = useState("");
  const [fTenantId,    setFTenantId]    = useState("");
  const [fSpotNum,     setFSpotNum]     = useState("");
  const [fSubType,     setFSubType]     = useState("monthly");
  const [fMonthlyFee,  setFMonthlyFee]  = useState("");
  const [fStartDate,   setFStartDate]   = useState("");
  const [fEndDate,     setFEndDate]     = useState("");
  const [fVehicleNum,  setFVehicleNum]  = useState("");
  const [fNotes,       setFNotes]       = useState("");
  const [fStatus,      setFStatus]      = useState("active");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: ps }, { data: pr }, { data: t }] = await Promise.all([
      supabase.from("parking_subscriptions")
        .select("*, properties(name), tenants(name)")
        .order("created_at", { ascending: false }),
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("tenants").select("id, name").order("name"),
    ]);
    setSubscriptions(ps ?? []);
    setProperties(pr ?? []);
    setTenants(t ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFTenantId(""); setFSpotNum(""); setFSubType("monthly");
    setFMonthlyFee(""); setFStartDate(""); setFEndDate(""); setFVehicleNum(""); setFNotes(""); setFStatus("active");
  }

  function openEdit(s: any) {
    setIsNew(false); setEditingId(s.id);
    setFPropertyId(s.property_id ?? ""); setFTenantId(s.tenant_id ?? "");
    setFSpotNum(s.spot_number ?? ""); setFSubType(s.subscription_type ?? "monthly");
    setFMonthlyFee(s.monthly_fee?.toString() ?? ""); setFStartDate(s.start_date?.split("T")[0] ?? "");
    setFEndDate(s.end_date?.split("T")[0] ?? ""); setFVehicleNum(s.vehicle_number ?? "");
    setFNotes(s.notes ?? ""); setFStatus(s.status ?? "active");
  }

  async function handleSave() {
    if (!fPropertyId) { alert("חובה: נכס"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id:       fPropertyId,
        tenant_id:         fTenantId || null,
        spot_number:       fSpotNum || null,
        subscription_type: fSubType,
        monthly_fee:       fMonthlyFee ? Number(fMonthlyFee) : null,
        start_date:        fStartDate || null,
        end_date:          fEndDate || null,
        vehicle_number:    fVehicleNum || null,
        notes:             fNotes || null,
        status:            fStatus,
      };
      if (isNew) {
        const { data } = await supabase.from("parking_subscriptions").insert(payload).select().single();
        await logAudit({ entity_type: "parking", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("parking_subscriptions").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "parking", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק מנוי חניה?")) return;
    await supabase.from("parking_subscriptions").delete().eq("id", id);
    await loadAll();
  }

  const filtered = subscriptions.filter(function(s) {
    const mt = filterType === "all" || s.subscription_type === filterType;
    const mp = filterProp === "all" || s.property_id === filterProp;
    return mt && mp;
  });

  const activeMonthly  = subscriptions.filter(function(s) { return s.status === "active" && s.subscription_type === "monthly"; });
  const totalMonthly   = activeMonthly.reduce(function(sum, s) { return sum + (s.monthly_fee ?? 0); }, 0);
  const typeInfo = function(v: string) { return SUB_TYPES.find(function(t) { return t.v === v; }) ?? SUB_TYPES[0]; };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">ניהול חניה</h1>
          <p className="text-sm text-slate-500 mt-1">
            {activeMonthly.length} מנויים פעילים | ₪{Math.round(totalMonthly).toLocaleString()}/חודש
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + מנוי חדש
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {SUB_TYPES.map(function(t) {
          const cnt = subscriptions.filter(function(s) { return s.subscription_type === t.v && s.status === "active"; }).length;
          const rev = subscriptions.filter(function(s) { return s.subscription_type === t.v && s.status === "active"; })
            .reduce(function(sum, s) { return sum + (s.monthly_fee ?? 0); }, 0);
          return (
            <button key={t.v} onClick={function() { setFilterType(filterType === t.v ? "all" : t.v); }}
              className={"rounded-xl border p-3 text-center transition-all " +
                (filterType === t.v ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50")}>
              <div className="text-2xl">{t.icon}</div>
              <div className="text-xl font-black text-slate-800">{cnt}</div>
              <div className="text-xs text-slate-500">{t.l}</div>
              {rev > 0 && <div className="text-xs text-green-600 font-semibold">₪{Math.round(rev).toLocaleString()}</div>}
            </button>
          );
        })}
      </div>

      {/* פילטר נכס */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <select value={filterProp} onChange={function(e) { setFilterProp(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="all">כל הנכסים</option>
          {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
        </select>
        <select value={filterType} onChange={function(e) { setFilterType(e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="all">כל הסוגים</option>
          {SUB_TYPES.map(function(t) { return <option key={t.v} value={t.v}>{t.icon} {t.l}</option>; })}
        </select>
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🅿️</div>
          <div>אין מנויי חניה</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף מנוי</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">סוג / מקום</th>
                <th className="px-4 py-3 font-semibold">שוכר / נכס</th>
                <th className="px-4 py-3 font-semibold">רכב</th>
                <th className="px-4 py-3 font-semibold">תשלום</th>
                <th className="px-4 py-3 font-semibold">תוקף</th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(s) {
                const ti = typeInfo(s.subscription_type);
                return (
                  <tr key={s.id} className={"border-t border-slate-100 " + (s.status !== "active" ? "opacity-60" : "hover:bg-slate-50")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{ti.icon}</span>
                        <div>
                          <div className="font-semibold text-slate-800">{ti.l}</div>
                          {s.spot_number && <div className="text-xs text-slate-400">מקום {s.spot_number}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-700">{s.tenants?.name ?? "—"}</div>
                      <div className="text-xs text-slate-400">{s.properties?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.vehicle_number ?? "—"}</td>
                    <td className="px-4 py-3 font-bold text-green-700">
                      {s.monthly_fee ? "₪" + s.monthly_fee.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {fmtDate(s.start_date)}{s.end_date ? " — " + fmtDate(s.end_date) : ""}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (s.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                        {s.status === "active" ? "פעיל" : "לא פעיל"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={function() { openEdit(s); }}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                        <button onClick={function() { handleDelete(s.id); }}
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
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "מנוי חניה חדש" : "עריכת מנוי"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={fPropertyId} onChange={function(e){setFPropertyId(e.target.value);}} className={ic}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר</label>
                <select value={fTenantId} onChange={function(e){setFTenantId(e.target.value);}} className={ic}>
                  <option value="">-- ללא שוכר (מזדמן) --</option>
                  {tenants.map(function(t){return <option key={t.id} value={t.id}>{t.name}</option>;})}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג</label>
                <div className="grid grid-cols-4 gap-2">
                  {SUB_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFSubType(t.v);}}
                        className={"rounded-lg border p-2 text-center " +
                          (fSubType === t.v ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fSubType === t.v ? "text-blue-700" : "text-slate-600")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר מקום</label>
                  <input type="text" value={fSpotNum} onChange={function(e){setFSpotNum(e.target.value);}} className={ic} placeholder="A-12" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תשלום חודשי (₪)</label>
                  <input type="number" value={fMonthlyFee} onChange={function(e){setFMonthlyFee(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מספר רכב</label>
                <input type="text" value={fVehicleNum} onChange={function(e){setFVehicleNum(e.target.value);}} className={ic} placeholder="12-345-67" />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                  <option value="active">פעיל</option>
                  <option value="inactive">לא פעיל</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}}
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
