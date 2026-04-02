"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import PropertyHierarchyFilter from '@/components/PropertyHierarchyFilter';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

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

  const [fPropertyId,  setFPropertyId]  = useState("");
  const [fTenantId,    setFTenantId]    = useState("");
  const [fType,        setFType]        = useState("monthly");
  const [fSpotNumbers, setFSpotNumbers] = useState("");
  const [fQuantity,    setFQuantity]    = useState("1");
  const [fIsMarked,    setFIsMarked]    = useState(false);
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
      supabase.from("parking_subscriptions").select("*, properties(name,parking_spaces), tenants(name)").order("created_at"),
      supabase.from("properties").select("id,name,parking_spaces").order("name"),
      supabase.from("tenants").select("id,name").order("name"),
    ]);
    setSubs(s ?? []); setProperties(p ?? []); setTenants(t ?? []); setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFTenantId(""); setFType("monthly"); setFSpotNumbers("");
    setFQuantity("1"); setFIsMarked(false); setFFee(""); setFVehicle("");
    setFStartDate(""); setFEndDate(""); setFStatus("active"); setFIncluded(false); setFNotes("");
  }

  function openEdit(s: any) {
    setIsNew(false); setEditingId(s.id);
    setFPropertyId(s.property_id??""); setFTenantId(s.tenant_id??"");
    setFType(s.subscription_type??"monthly"); setFSpotNumbers(s.spot_number??"");
    setFQuantity(String(s.quantity??1)); setFIsMarked(s.is_marked??false);
    setFFee(s.monthly_fee?.toString()??""); setFVehicle(s.vehicle_number??"");
    setFStartDate(s.start_date??""); setFEndDate(s.end_date??"");
    setFStatus(s.status??"active"); setFIncluded(s.is_included_in_rent??false);
    setFNotes(s.notes??"");
  }

  async function handleSave() {
    if (!fPropertyId) { alert("חובה: נכס"); return; }
    setSaving(true);
    try {
      var payload: any = {
        property_id: fPropertyId,
        tenant_id: fTenantId || null,
        subscription_type: fType,
        spot_number: fSpotNumbers.trim() || null,
        quantity: Number(fQuantity) || 1,
        is_marked: fIsMarked,
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
    if (!confirm("למחוק הקצאה זו?")) return;
    await supabase.from("parking_subscriptions").delete().eq("id", id);
    await loadAll();
  }

  // Stats
  var filtered = subs.filter(function(s) { return filterPropIds.length === 0 || filterPropIds.includes(s.property_id); });
  var totalAllocated = filtered.reduce(function(s, r) { return s + (r.quantity || 1); }, 0);
  var rentedQty = filtered.filter(function(s) { return s.tenant_id; }).reduce(function(sum, r) { return sum + (r.quantity || 1); }, 0);
  var monthlyIncome = filtered.filter(function(s) { return s.status === "active" && !s.is_included_in_rent && s.tenant_id; })
    .reduce(function(sum, s) { return sum + (Number(s.monthly_fee) || 0) * (s.quantity || 1); }, 0);

  // Group by property
  var propGroups: Record<string, { prop: any; allocations: any[] }> = {};
  filtered.forEach(function(s) {
    var pid = s.property_id;
    if (!propGroups[pid]) {
      var prop = properties.find(function(p) { return p.id === pid; });
      propGroups[pid] = { prop: prop || { id: pid, name: "לא ידוע" }, allocations: [] };
    }
    propGroups[pid].allocations.push(s);
  });
  // Show properties with parking_spaces but no allocations
  properties.forEach(function(p) {
    if (Number(p.parking_spaces) > 0 && !propGroups[p.id]) {
      if (filterPropIds.length === 0 || filterPropIds.includes(p.id)) {
        propGroups[p.id] = { prop: p, allocations: [] };
      }
    }
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חניות</h1>
          <p className="text-sm text-slate-500 mt-1">{totalAllocated} מקומות | {rentedQty} מושכרים | {totalAllocated - rentedQty} פנויים</p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">+ הקצאת חניות</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "מושכרים", value: String(rentedQty), color: "text-green-700", bg: "bg-green-50" },
          { label: "פנויים", value: String(totalAllocated - rentedQty), color: "text-blue-700", bg: "bg-blue-50" },
          { label: "הכנסה חודשית", value: fmtMoney(monthlyIncome), color: "text-emerald-700", bg: "bg-emerald-50" },
          { label: 'סה"כ מקומות', value: String(totalAllocated), color: "text-slate-500", bg: "bg-white" },
        ].map(function(k) {
          return <div key={k.label} className={"rounded-xl border border-slate-200 p-3 text-center " + k.bg}>
            <div className={"text-xl font-black " + k.color}>{k.value}</div>
            <div className="text-xs text-slate-400">{k.label}</div>
          </div>;
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <PropertyHierarchyFilter onChange={function(f) { setFilterPropIds(f.propertyIds); }} />
      </div>

      {/* Content */}
      {loading ? <div className="text-center py-12 text-slate-400">טוען...</div> : Object.keys(propGroups).length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🅿️</div><div>אין חניות</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף</button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.values(propGroups).map(function(group) {
            var declared = Number(group.prop.parking_spaces) || 0;
            var allocatedQty = group.allocations.reduce(function(s: number, r: any) { return s + (r.quantity || 1); }, 0);
            var rentedInProp = group.allocations.filter(function(a: any) { return a.tenant_id; }).reduce(function(s: number, r: any) { return s + (r.quantity || 1); }, 0);
            var freeInProp = (declared > 0 ? declared : allocatedQty) - rentedInProp;
            var incomeInProp = group.allocations.filter(function(a: any) { return a.status === "active" && !a.is_included_in_rent && a.tenant_id; })
              .reduce(function(s: number, a: any) { return s + (Number(a.monthly_fee) || 0) * (a.quantity || 1); }, 0);

            return (
              <div key={group.prop.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* Property header */}
                <div className="bg-slate-50 border-b border-slate-200 px-5 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-bold text-slate-800">🅿️ {group.prop.name}</h3>
                    <span className="text-xs text-slate-400">{declared > 0 ? declared + " מקומות מוגדרים" : allocatedQty + " מקומות"}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-green-50 border border-green-100 p-2 text-center">
                      <div className="text-sm font-black text-green-700">{rentedInProp}</div>
                      <div className="text-[10px] text-green-600">מושכרים</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-center">
                      <div className="text-sm font-black text-blue-700">{freeInProp > 0 ? freeInProp : 0}</div>
                      <div className="text-[10px] text-blue-600">פנויים</div>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-100 p-2 text-center">
                      <div className="text-sm font-black text-emerald-700">{fmtMoney(incomeInProp)}</div>
                      <div className="text-[10px] text-slate-400">הכנסה/חודש</div>
                    </div>
                  </div>
                </div>

                {/* Allocation blocks */}
                <div className="p-4">
                  {group.allocations.length === 0 && freeInProp > 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/30 p-4 text-center">
                      <div className="text-2xl mb-1">🅿️</div>
                      <div className="text-sm font-bold text-blue-700">{freeInProp} מקומות פנויים</div>
                      <div className="text-xs text-blue-500">לחץ "+ הקצאת חניות" להשכרה</div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                      {/* Free pool block */}
                      {freeInProp > 0 && (
                        <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/30 p-3 text-center">
                          <div className="text-2xl font-black text-blue-700">{freeInProp}</div>
                          <div className="text-xs font-semibold text-blue-600">מקומות פנויים</div>
                        </div>
                      )}

                      {/* Rented blocks */}
                      {group.allocations.filter(function(a: any) { return a.tenant_id; }).map(function(a: any) {
                        var qty = a.quantity || 1;
                        return (
                          <div key={a.id} className="rounded-xl border border-green-200 bg-green-50 p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold text-green-800 text-sm">
                                {a.is_marked && a.spot_number ? (
                                  <span>🔒 חניות {a.spot_number}</span>
                                ) : (
                                  <span>{qty} מקומות</span>
                                )}
                              </span>
                              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">מושכר</span>
                            </div>
                            <div className="text-xs text-green-700 font-semibold">👤 {a.tenants?.name}</div>
                            {a.monthly_fee > 0 && (
                              <div className="text-xs text-slate-600 mt-0.5">
                                {fmtMoney(a.monthly_fee * qty)}/חודש
                                {a.is_included_in_rent && <span className="text-orange-500 mr-1"> (כלול)</span>}
                              </div>
                            )}
                            {a.vehicle_number && <div className="text-[10px] text-slate-400 mt-0.5">🚗 {a.vehicle_number}</div>}
                            {a.is_marked && <div className="text-[10px] text-purple-600 mt-0.5">📌 מסומנות</div>}
                            <div className="mt-2 flex gap-1">
                              <button onClick={function() { openEdit(a); }} className="flex-1 text-[10px] border border-slate-200 rounded py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                              <button onClick={function() { handleDelete(a.id); }} className="text-[10px] border border-red-200 rounded py-1 px-2 text-red-500 hover:bg-red-50">🗑</button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Unrented allocations (reserved spots without tenant) */}
                      {group.allocations.filter(function(a: any) { return !a.tenant_id && a.spot_number; }).map(function(a: any) {
                        return (
                          <div key={a.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="font-bold text-slate-700 text-sm mb-1">🔒 חניות {a.spot_number}</div>
                            <div className="text-xs text-slate-500">{a.quantity || 1} מקומות שמורים</div>
                            <div className="mt-2 flex gap-1">
                              <button onClick={function() { openEdit(a); }} className="flex-1 text-[10px] border border-slate-200 rounded py-1 text-slate-600 hover:bg-slate-50">עריכה</button>
                              <button onClick={function() { handleDelete(a.id); }} className="text-[10px] border border-red-200 rounded py-1 px-2 text-red-500 hover:bg-red-50">🗑</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
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
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "הקצאת חניות" : "עריכה"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={fPropertyId} onChange={function(e) { setFPropertyId(e.target.value); }} className={ic}>
                  <option value="">-- בחר --</option>
                  {properties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר</label>
                <select value={fTenantId} onChange={function(e) { setFTenantId(e.target.value); }} className={ic}>
                  <option value="">-- פנוי / שמור --</option>
                  {tenants.map(function(t) { return <option key={t.id} value={t.id}>{t.name}</option>; })}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כמות מקומות</label>
                  <input type="number" min="1" value={fQuantity} onChange={function(e) { setFQuantity(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">דמי חניה (למקום/חודש)</label>
                  <input type="number" value={fFee} onChange={function(e) { setFFee(e.target.value); }} className={ic} />
                </div>
              </div>
              <div className="flex items-center gap-2 py-1">
                <input type="checkbox" id="marked" checked={fIsMarked} onChange={function(e) { setFIsMarked(e.target.checked); }} className="w-4 h-4" />
                <label htmlFor="marked" className="text-xs font-semibold text-slate-700">מקומות מסומנים (עם מספרים)</label>
              </div>
              {fIsMarked && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספרי חניות</label>
                  <input type="text" value={fSpotNumbers} onChange={function(e) { setFSpotNumbers(e.target.value); }} className={ic} placeholder="לדוגמה: 9-15 או 25,30,31" />
                </div>
              )}
              <div className="flex items-center gap-2 py-1">
                <input type="checkbox" id="included" checked={fIncluded} onChange={function(e) { setFIncluded(e.target.checked); }} className="w-4 h-4" />
                <label htmlFor="included" className="text-xs font-semibold text-slate-700">כלול בדמי השכירות</label>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מספר רכב</label>
                <input type="text" value={fVehicle} onChange={function(e) { setFVehicle(e.target.value); }} className={ic} />
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
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} rows={2} className={ic} />
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
