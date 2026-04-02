"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import PropertyHierarchyFilter from '@/components/PropertyHierarchyFilter';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const PARKING_TYPES = [
  { v:"monthly",    l:"חודשי",    icon:"📅" },
  { v:"occasional", l:"מזדמן",    icon:"🎫" },
  { v:"reserved",   l:"שמורה",    icon:"🔒" },
  { v:"disabled",   l:"נכים",     icon:"♿" },
];

function fmtMoney(n: number) { return n ? "₪"+n.toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; }

export default function ParkingPage() {
  const [subs,       setSubs]       = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [tenants,    setTenants]    = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterPropIds, setFilterPropIds] = useState<string[]>([]);
  const [filterSt,   setFilterSt]   = useState("all");

  const [fPropertyId,  setFPropertyId]  = useState("");
  const [fTenantId,    setFTenantId]    = useState("");
  const [fType,        setFType]        = useState("monthly");
  const [fSpotNum,     setFSpotNum]     = useState("");
  const [fFee,         setFFee]         = useState("");
  const [fVehicle,     setFVehicle]     = useState("");
  const [fStartDate,   setFStartDate]   = useState("");
  const [fEndDate,     setFEndDate]     = useState("");
  const [fStatus,      setFStatus]      = useState("active");
  const [fIncluded,    setFIncluded]    = useState(false);
  const [fNotes,       setFNotes]       = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: s }, { data: p }, { data: t }] = await Promise.all([
      supabase.from("parking_subscriptions").select("*, properties(name), tenants(name)").order("spot_number"),
      supabase.from("properties").select("id,name,parking_spaces").order("name"),
      supabase.from("tenants").select("id,name").order("name"),
    ]);
    setSubs(s ?? []); setProperties(p ?? []); setTenants(t ?? []); setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFTenantId(""); setFType("monthly"); setFSpotNum("");
    setFFee(""); setFVehicle(""); setFStartDate(""); setFEndDate("");
    setFStatus("active"); setFIncluded(false); setFNotes("");
  }

  function openEdit(s: any) {
    setIsNew(false); setEditingId(s.id);
    setFPropertyId(s.property_id??""); setFTenantId(s.tenant_id??"");
    setFType(s.subscription_type??"monthly"); setFSpotNum(s.spot_number??"");
    setFFee(s.monthly_fee?.toString()??""); setFVehicle(s.vehicle_number??"");
    setFStartDate(s.start_date??""); setFEndDate(s.end_date??"");
    setFStatus(s.status??"active"); setFIncluded(s.is_included_in_rent??false);
    setFNotes(s.notes??"");
  }

  async function handleSave() {
    if (!fPropertyId || !fSpotNum.trim()) { alert("חובה: נכס + מספר חניה"); return; }
    setSaving(true);
    try {
      var payload: any = {
        property_id: fPropertyId,
        tenant_id: fTenantId || null,
        subscription_type: fType,
        spot_number: fSpotNum.trim(),
        monthly_fee: fFee ? Number(fFee) : 0,
        vehicle_number: fVehicle || null,
        start_date: fStartDate || null,
        end_date: fEndDate || null,
        status: fStatus,
        is_included_in_rent: fIncluded,
        notes: fNotes || null,
      };
      if (isNew) {
        var { data, error } = await supabase.from("parking_subscriptions").insert(payload).select().single();
        if (error) throw new Error(error.message);
        await logAudit({ entity_type: "parking", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("parking_subscriptions").update(payload).eq("id", editingId);
      }
      setEditingId(""); await loadAll();
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק חניה זו?")) return;
    await supabase.from("parking_subscriptions").delete().eq("id", id);
    await loadAll();
  }

  var filtered = subs.filter(function(s) {
    return (filterPropIds.length === 0 || filterPropIds.includes(s.property_id)) &&
           (filterSt === "all" || s.status === filterSt);
  });

  var totalSpots = subs.length;
  var rented = subs.filter(function(s) { return s.tenant_id; }).length;
  var free = totalSpots - rented;
  var monthlyIncome = subs.filter(function(s) { return s.status === "active" && !s.is_included_in_rent; })
    .reduce(function(sum, s) { return sum + (Number(s.monthly_fee) || 0); }, 0);

  var typeLabel = function(v: string) { return PARKING_TYPES.find(function(t) { return t.v === v; })?.l ?? v; };
  var typeIcon = function(v: string) { return PARKING_TYPES.find(function(t) { return t.v === v; })?.icon ?? "🅿️"; };

  // Group by property
  // Generate parking spots from property.parking_spaces if none exist
  async function generateSpots(propId: string, count: number) {
    if (!confirm("ליצור " + count + " חניות פנויות לנכס זה?")) return;
    var rows = [];
    for (var i = 1; i <= count; i++) {
      rows.push({ property_id: propId, spot_number: String(i), subscription_type: "monthly", status: "active" });
    }
    var { error } = await supabase.from("parking_subscriptions").insert(rows);
    if (error) { alert("שגיאה: " + error.message); return; }
    await loadAll();
  }

  // Group filtered spots by property, and include properties with declared parking but no spots
  var propGroups: Record<string, { prop: any; spots: any[] }> = {};
  filtered.forEach(function(s) {
    var pid = s.property_id;
    if (!propGroups[pid]) {
      var prop = properties.find(function(p) { return p.id === pid; });
      propGroups[pid] = { prop: prop || { id: pid, name: "לא ידוע" }, spots: [] };
    }
    propGroups[pid].spots.push(s);
  });
  // Add properties that have parking_spaces declared but no spots created yet
  properties.forEach(function(p) {
    if (p.parking_spaces > 0 && !propGroups[p.id]) {
      if (filterPropIds.length === 0 || filterPropIds.includes(p.id)) {
        propGroups[p.id] = { prop: p, spots: [] };
      }
    }
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חניות</h1>
          <p className="text-sm text-slate-500 mt-1">{totalSpots} חניות | {rented} מושכרות | {free} פנויות</p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">+ חניה חדשה</button>
      </div>

      {/* Global stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "מושכרות", value: String(rented), color: "text-green-700", bg: "bg-green-50" },
          { label: "פנויות", value: String(free), color: "text-blue-700", bg: "bg-blue-50" },
          { label: "הכנסה חודשית", value: fmtMoney(monthlyIncome), color: "text-emerald-700", bg: "bg-emerald-50" },
          { label: 'סה"כ חניות', value: String(totalSpots), color: "text-slate-500", bg: "bg-white" },
        ].map(function(k) {
          return <div key={k.label} className={"rounded-xl border border-slate-200 p-3 text-center " + k.bg}>
            <div className={"text-xl font-black " + k.color}>{k.value}</div>
            <div className="text-xs text-slate-400">{k.label}</div>
          </div>;
        })}
      </div>

      {/* Hierarchy filter + status filter */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <PropertyHierarchyFilter onChange={function(f) { setFilterPropIds(f.propertyIds); }} />
        {[{ v: "all", l: "הכל" }, { v: "active", l: "🟢 פעיל" }, { v: "inactive", l: "⚪ לא פעיל" }].map(function(s) {
          return <button key={s.v} onClick={function() { setFilterSt(s.v); }}
            className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " + (filterSt === s.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>{s.l}</button>;
        })}
      </div>

      {/* Content grouped by property */}
      {loading ? <div className="text-center py-12 text-slate-400">טוען...</div> : Object.keys(propGroups).length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🅿️</div>
          <div>אין חניות</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף חניה</button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.values(propGroups).map(function(group) {
            var propRented = group.spots.filter(function(s) { return s.tenant_id; }).length;
            var propFree = group.spots.length - propRented;
            var propIncome = group.spots.filter(function(s) { return s.status === "active" && !s.is_included_in_rent; })
              .reduce(function(sum, s) { return sum + (Number(s.monthly_fee) || 0); }, 0);
            var declaredSpots = Number(group.prop.parking_spaces) || 0;

            return (
              <div key={group.prop.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* Property header */}
                <div className="bg-slate-50 border-b border-slate-200 px-5 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-bold text-slate-800">🅿️ {group.prop.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">
                        {group.spots.length} חניות{declaredSpots > 0 ? " (מוגדרות: " + declaredSpots + ")" : ""}
                      </span>
                      {declaredSpots > 0 && group.spots.length === 0 && (
                        <button onClick={function() { generateSpots(group.prop.id, declaredSpots); }}
                          className="rounded-lg bg-green-600 text-white px-3 py-1 text-xs font-bold hover:bg-green-700">
                          צור {declaredSpots} חניות
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-green-50 border border-green-100 p-2 text-center">
                      <div className="text-sm font-black text-green-700">{propRented}</div>
                      <div className="text-[10px] text-green-600">מושכרות</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-center">
                      <div className="text-sm font-black text-blue-700">{propFree}</div>
                      <div className="text-[10px] text-blue-600">פנויות</div>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-100 p-2 text-center">
                      <div className="text-sm font-black text-emerald-700">{fmtMoney(propIncome)}</div>
                      <div className="text-[10px] text-slate-400">הכנסה/חודש</div>
                    </div>
                  </div>
                </div>

                {/* Parking spots grid */}
                {group.spots.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-sm">
                    <div className="text-3xl mb-2">🅿️</div>
                    {declaredSpots > 0 ? (
                      <div>בנכס מוגדרות {declaredSpots} חניות — לחץ "צור חניות" ליצירה</div>
                    ) : (
                      <div>אין חניות מוגדרות לנכס זה</div>
                    )}
                  </div>
                ) : (
                <div className="p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {group.spots.map(function(s) {
                    var hasT = !!s.tenant_id;
                    var isActive = s.status === "active";
                    return (
                      <div key={s.id} className={"rounded-xl border p-3 transition-all hover:shadow-md " +
                        (hasT ? "border-green-200 bg-green-50" : "border-blue-100 bg-blue-50/50 border-dashed")}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-lg">{typeIcon(s.subscription_type)}</span>
                            <span className="font-bold text-slate-800 text-sm">חניה {s.spot_number}</span>
                          </div>
                          <span className={"text-[10px] px-1.5 py-0.5 rounded-full font-semibold " +
                            (hasT ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700")}>
                            {hasT ? "מושכרת" : "פנויה"}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">{typeLabel(s.subscription_type)}</div>
                        {s.monthly_fee > 0 && (
                          <div className="text-xs text-slate-600 mt-0.5">
                            {fmtMoney(s.monthly_fee)}/חודש
                            {s.is_included_in_rent && <span className="text-orange-500 mr-1">(כלול בשכ"ד)</span>}
                          </div>
                        )}
                        {s.vehicle_number && <div className="text-[10px] text-slate-500 mt-0.5">🚗 {s.vehicle_number}</div>}
                        {hasT && <div className="text-xs text-green-700 font-semibold mt-1">👤 {s.tenants?.name}</div>}
                        <div className="mt-2 flex gap-1">
                          <button onClick={function() { openEdit(s); }} className="flex-1 text-[10px] border border-slate-200 rounded py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                          <button onClick={function() { handleDelete(s.id); }} className="text-[10px] border border-red-200 rounded py-1 px-2 text-red-500 hover:bg-red-50">🗑</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit/Create modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "חניה חדשה" : "עריכת חניה"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={fPropertyId} onChange={function(e) { setFPropertyId(e.target.value); }} className={ic}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מספר חניה *</label>
                <input type="text" value={fSpotNum} onChange={function(e) { setFSpotNum(e.target.value); }} className={ic} placeholder="לדוגמה: 5, A-12" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סוג</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {PARKING_TYPES.map(function(t) {
                    return <button key={t.v} type="button" onClick={function() { setFType(t.v); }}
                      className={"rounded-lg border p-1.5 text-center " + (fType === t.v ? "border-blue-500 bg-blue-50" : "border-slate-200")}>
                      <div>{t.icon}</div>
                      <div className={"text-[10px] " + (fType === t.v ? "text-blue-700 font-bold" : "text-slate-500")}>{t.l}</div>
                    </button>;
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר</label>
                <select value={fTenantId} onChange={function(e) { setFTenantId(e.target.value); }} className={ic}>
                  <option value="">-- פנויה --</option>
                  {tenants.map(function(t) { return <option key={t.id} value={t.id}>{t.name}</option>; })}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">דמי חניה חודשיים</label>
                  <input type="number" value={fFee} onChange={function(e) { setFFee(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר רכב</label>
                  <input type="text" value={fVehicle} onChange={function(e) { setFVehicle(e.target.value); }} className={ic} />
                </div>
              </div>
              <div className="flex items-center gap-2 py-1">
                <input type="checkbox" id="included" checked={fIncluded} onChange={function(e) { setFIncluded(e.target.checked); }} className="w-4 h-4" />
                <label htmlFor="included" className="text-xs font-semibold text-slate-700">כלול בדמי השכירות (ללא חיוב נפרד)</label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תחילה</label>
                  <input type="date" value={fStartDate} onChange={function(e) { setFStartDate(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סיום</label>
                  <input type="date" value={fEndDate} onChange={function(e) { setFEndDate(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e) { setFStatus(e.target.value); }} className={ic}>
                  <option value="active">פעיל</option>
                  <option value="inactive">לא פעיל</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} rows={2} className={ic} placeholder="הערות..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? "שומר..." : "שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
