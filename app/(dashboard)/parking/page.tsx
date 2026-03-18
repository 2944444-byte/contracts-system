"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const PARKING_TYPES = [
  { v:"monthly",    l:"חודשי",           icon:"📅" },
  { v:"occasional", l:"מזדמן",           icon:"🎫" },
  { v:"reserved",   l:"שמורה",           icon:"🔒" },
  { v:"disabled",   l:"נכים",            icon:"♿" },
];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return n ? "₪"+Math.round(n).toLocaleString() : "—"; }
function daysLeft(d: string) { return Math.ceil((new Date(d).getTime()-Date.now())/86400000); }

export default function ParkingPage() {
  const [subs,       setSubs]       = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [tenants,    setTenants]    = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [filterType, setFilterType] = useState("all");

  const [fPropertyId,  setFPropertyId]  = useState("");
  const [fTenantId,    setFTenantId]    = useState("");
  const [fType,        setFType]        = useState("monthly");
  const [fSpotNum,     setFSpotNum]     = useState("");
  const [fFee,         setFFee]         = useState("");
  const [fVehicle,     setFVehicle]     = useState("");
  const [fStartDate,   setFStartDate]   = useState("");
  const [fEndDate,     setFEndDate]     = useState("");
  const [fStatus,      setFStatus]      = useState("active");
  const [fNotes,       setFNotes]       = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: s }, { data: p }, { data: t }] = await Promise.all([
      supabase.from("parking_subscriptions")
        .select("*, properties(name), tenants(name)")
        .order("created_at", { ascending: false }),
      supabase.from("properties").select("id,name").order("name"),
      supabase.from("tenants").select("id,name").order("name"),
    ]);
    setSubs(s ?? []);
    setProperties(p ?? []);
    setTenants(t ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFPropertyId(""); setFTenantId(""); setFType("monthly"); setFSpotNum("");
    setFFee(""); setFVehicle(""); setFStartDate(""); setFEndDate(""); setFStatus("active"); setFNotes("");
  }

  function openEdit(s: any) {
    setIsNew(false); setEditingId(s.id);
    setFPropertyId(s.property_id??""); setFTenantId(s.tenant_id??""); setFType(s.subscription_type??"monthly");
    setFSpotNum(s.spot_number??""); setFFee(s.monthly_fee?.toString()??""); setFVehicle(s.vehicle_number??"");
    setFStartDate(s.start_date?.split("T")[0]??""); setFEndDate(s.end_date?.split("T")[0]??"");
    setFStatus(s.status??"active"); setFNotes(s.notes??"");
  }

  async function handleSave() {
    if (!fPropertyId) { alert("חובה: נכס"); return; }
    setSaving(true);
    try {
      const payload = {
        property_id:       fPropertyId,
        tenant_id:         fTenantId||null,
        subscription_type: fType,
        spot_number:       fSpotNum||null,
        monthly_fee:       fFee ? Number(fFee) : null,
        vehicle_number:    fVehicle||null,
        start_date:        fStartDate||null,
        end_date:          fEndDate||null,
        status:            fStatus,
        notes:             fNotes||null,
      };
      if (isNew) {
        const { data } = await supabase.from("parking_subscriptions").insert(payload).select().single();
        await logAudit({ entity_type:"parking", entity_id:data.id, action:"create" });
      } else {
        await supabase.from("parking_subscriptions").update(payload).eq("id", editingId);
        await logAudit({ entity_type:"parking", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק מנוי חניה?")) return;
    await supabase.from("parking_subscriptions").delete().eq("id", id);
    await loadAll();
  }

  const filtered = subs.filter(function(s) {
    return filterType==="all" || s.subscription_type===filterType;
  });

  const active   = subs.filter(function(s) { return s.status==="active"; });
  const monthlyRev = active.filter(function(s){return s.subscription_type==="monthly";}).reduce(function(t,s){return t+(s.monthly_fee??0);},0);
  const expiring = subs.filter(function(s) { return s.end_date && daysLeft(s.end_date)<=30 && s.status==="active"; });

  const typeInfo = function(v: string) {
    return PARKING_TYPES.find(function(t){return t.v===v;}) ?? PARKING_TYPES[0];
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חניה</h1>
          <p className="text-sm text-slate-500 mt-1">
            {active.length} פעילים | הכנסה חודשית: <strong className="text-green-700">{fmtMoney(monthlyRev)}</strong>
            {expiring.length>0 && <span className="text-red-600 font-semibold"> | {expiring.length} פגות ב-30י</span>}
          </p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + מנוי חניה
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {PARKING_TYPES.map(function(pt) {
          const cnt = subs.filter(function(s){return s.subscription_type===pt.v && s.status==="active";}).length;
          const rev = subs.filter(function(s){return s.subscription_type===pt.v && s.status==="active";}).reduce(function(t,s){return t+(s.monthly_fee??0);},0);
          return (
            <button key={pt.v} onClick={function(){setFilterType(filterType===pt.v?"all":pt.v);}}
              className={"rounded-xl border p-3 text-center transition-all " +
                (filterType===pt.v?"border-blue-500 bg-blue-50 ring-2 ring-blue-300":"border-slate-200 bg-white hover:shadow-sm")}>
              <div className="text-2xl mb-0.5">{pt.icon}</div>
              <div className="text-xl font-black text-slate-800">{cnt}</div>
              <div className="text-xs text-slate-500">{pt.l}</div>
              {rev>0 && <div className="text-xs text-green-600 font-semibold">{fmtMoney(rev)}/חודש</div>}
            </button>
          );
        })}
      </div>

      {/* פילטר */}
      <div className="flex gap-2 mb-4">
        {[{v:"all",l:"הכל"},{v:"active",l:"פעילים"},{v:"inactive",l:"לא פעיל"}].map(function(s) {
          return (
            <button key={s.v} onClick={function(){setFilterType(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterType===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {s.l}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🅿️</div><div>אין מנויי חניה</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף מנוי</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(function(s) {
            const ti = typeInfo(s.subscription_type);
            const d  = s.end_date ? daysLeft(s.end_date) : null;
            const isExp = d!==null && d<=30 && s.status==="active";
            return (
              <div key={s.id} className={"rounded-xl border p-4 transition-all hover:shadow-md " +
                (isExp?"border-red-200 bg-red-50":s.status==="active"?"border-slate-200 bg-white":"border-slate-100 bg-slate-50 opacity-60")}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{ti.icon}</span>
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{ti.l}</div>
                      {s.spot_number && <div className="text-xs text-slate-400">מקום #{s.spot_number}</div>}
                    </div>
                  </div>
                  <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                    (s.status==="active"?"bg-green-100 text-green-700":"bg-slate-100 text-slate-500")}>
                    {s.status==="active"?"פעיל":"לא פעיל"}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-slate-600">
                  <div>🏢 {s.properties?.name}</div>
                  {s.tenants?.name && <div>👤 {s.tenants.name}</div>}
                  {s.vehicle_number && <div>🚗 {s.vehicle_number}</div>}
                  {s.monthly_fee && <div className="font-semibold text-green-700">💰 {fmtMoney(s.monthly_fee)}/חודש</div>}
                  {s.end_date && (
                    <div className={isExp?"text-red-600 font-semibold":"text-slate-400"}>
                      📅 {fmtDate(s.end_date)} {isExp && "("+d+"י)"}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={function(){openEdit(s);}} className="flex-1 text-xs border border-slate-200 rounded-lg py-1.5 text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                  <button onClick={function(){handleDelete(s.id);}} className="text-xs border border-red-100 rounded-lg px-3 py-1.5 text-red-400 hover:bg-red-50">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew?"מנוי חניה חדש":"עריכת מנוי"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג חניה</label>
                <div className="grid grid-cols-4 gap-2">
                  {PARKING_TYPES.map(function(pt) {
                    return (
                      <button key={pt.v} type="button" onClick={function(){setFType(pt.v);}}
                        className={"rounded-xl border p-2 text-center " + (fType===pt.v?"border-blue-500 bg-blue-50":"border-slate-200 hover:bg-slate-50")}>
                        <div className="text-xl">{pt.icon}</div>
                        <div className={"text-xs font-semibold " + (fType===pt.v?"text-blue-700":"text-slate-600")}>{pt.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                    <option value="">-- ללא שוכר --</option>
                    {tenants.map(function(t){return <option key={t.id} value={t.id}>{t.name}</option>;})}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מספר מקום</label>
                  <input type="text" value={fSpotNum} onChange={function(e){setFSpotNum(e.target.value);}} className={ic} placeholder="A-15" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תשלום חודשי (₪)</label>
                  <input type="number" value={fFee} onChange={function(e){setFFee(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">לוחית רישוי</label>
                  <input type="text" value={fVehicle} onChange={function(e){setFVehicle(e.target.value);}} className={ic} dir="ltr" placeholder="12-345-67" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                  <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}>
                    <option value="active">פעיל</option>
                    <option value="inactive">לא פעיל</option>
                  </select>
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
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving?"שומר...":"שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
