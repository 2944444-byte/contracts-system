"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const PROP_TYPES = [
  {v:"office",    l:"משרדים",    icon:"💼"},
  {v:"retail",    l:"מסחרי",     icon:"🏪"},
  {v:"industrial",l:"תעשייה",   icon:"🏭"},
  {v:"mixed",     l:"מעורב",     icon:"🏢"},
  {v:"other",     l:"אחר",       icon:"🏗️"},
];

function fmtMoney(n: number) { return n ? "₪"+Math.round(n).toLocaleString() : "—"; }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

export default function PropertiesPage() {
  const router  = useRouter();
  const [properties, setProperties] = useState<any[]>([]);
  const [companies,  setCompanies]  = useState<any[]>([]);
  const [spaces,     setSpaces]     = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<string|null>(null);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [search,     setSearch]     = useState("");

  const [fName,       setFName]       = useState("");
  const [fCompanyId,  setFCompanyId]  = useState("");
  const [fType,       setFType]       = useState("office");
  const [fAddress,    setFAddress]    = useState("");
  const [fCity,       setFCity]       = useState("");
  const [fArea,       setFArea]       = useState("");
  const [fFloors,     setFFloors]     = useState("");
  const [fNotes,      setFNotes]      = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: p }, { data: c }, { data: sp }, { data: co }] = await Promise.all([
      supabase.from("properties").select("*, companies(company_name)").order("name"),
      supabase.from("contracts").select("id, status, rent_per_sqm, charged_area, investment_addition, property_id, tenants(name)").in("status",["active","expiring","extended"]),
      supabase.from("spaces").select("id, property_id, status").order("name"),
      supabase.from("companies").select("id,company_name").order("company_name"),
    ]);
    setProperties(p ?? []);
    setContracts(c ?? []);
    setSpaces(sp ?? []);
    setCompanies(co ?? []);
    setLoading(false);
    if (!selected && (p??[]).length > 0) setSelected((p??[])[0].id);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFCompanyId(""); setFType("office"); setFAddress(""); setFCity(""); setFArea(""); setFFloors(""); setFNotes("");
  }

  function openEdit(p: any) {
    setIsNew(false); setEditingId(p.id);
    setFName(p.name??""); setFCompanyId(p.company_id??""); setFType(p.property_type??"office");
    setFAddress(p.address??""); setFCity(p.city??""); setFArea(p.total_area?.toString()??"");
    setFFloors(p.floors?.toString()??""); setFNotes(p.notes??"");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם נכס"); return; }
    setSaving(true);
    try {
      const payload = {
        property_name: fName.trim(), company_id: fCompanyId||null,
        property_type: fType, address: fAddress||null, city: fCity||null,
        total_area: fArea ? Number(fArea) : null, floors: fFloors ? Number(fFloors) : null,
        notes: fNotes||null,
      };
      if (isNew) {
        const { data } = await supabase.from("properties").insert(payload).select().single();
        await logAudit({ entity_type:"property", entity_id:data.id, action:"create" });
        setSelected(data.id);
      } else {
        await supabase.from("properties").update(payload).eq("id", editingId);
        await logAudit({ entity_type:"property", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק נכס? פעולה זו תמחק גם את כל החוזים, היחידות, הביטוחים ובדיקות הבטיחות!")) return;
    const { data: pContracts } = await supabase.from("contracts").select("id").eq("property_id", id);
    const cIds = (pContracts||[]).map((c:any)=>c.id);
    if(cIds.length > 0){
      await supabase.from("charges").delete().in("contract_id", cIds);
      await supabase.from("contract_spaces").delete().in("contract_id", cIds);
      await supabase.from("contract_options").delete().in("contract_id", cIds);
      await supabase.from("contract_price_tiers").delete().in("contract_id", cIds);
      await supabase.from("guarantees").delete().in("contract_id", cIds);
      await supabase.from("insurances_tenant").delete().in("contract_id", cIds);
      await supabase.from("letters").delete().in("contract_id", cIds);
      await supabase.from("contracts").delete().in("id", cIds);
    }
    await supabase.from("units").delete().eq("property_id", id);
    await supabase.from("spaces").delete().eq("property_id", id);
    await supabase.from("insurances_building").delete().eq("property_id", id);
    await supabase.from("safety_inspections").delete().eq("property_id", id);
    await supabase.from("properties").delete().eq("id", id);
    setSelected(null); await loadAll();
  }

  const filtered = properties.filter(function(p) {
    return !search || p.name?.includes(search) || p.city?.includes(search);
  });

  const selProp = properties.find(function(p) { return p.id === selected; });
  const selSpaces    = spaces.filter(function(s) { return s.property_id === selected; });
  const selContracts = contracts.filter(function(c) { return c.property_id === selected; });
  const selRevenue   = selContracts.reduce(function(s,c){return s+(c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);},0);
  const selOccupied  = selSpaces.filter(function(s){return s.status==="occupied";}).length;
  const selOccPct    = selSpaces.length > 0 ? Math.round(selOccupied/selSpaces.length*100) : 0;

  const typeInfo = function(v: string) { return PROP_TYPES.find(function(t){return t.v===v;})??PROP_TYPES[4]; };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">נכסים</h1>
          <p className="text-sm text-slate-500 mt-1">{properties.length} נכסים</p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + נכס חדש
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* רשימה */}
        <div className="space-y-2">
          <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
            placeholder="חיפוש..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm mb-2" />
          {loading ? <div className="text-center py-4 text-slate-400">טוען...</div> : (
            filtered.map(function(p) {
              const ti = typeInfo(p.property_type);
              const propContracts = contracts.filter(function(c){return c.property_id===p.id;});
              return (
                <div key={p.id} onClick={function(){setSelected(selected===p.id?null:p.id);}}
                  className={"rounded-xl border p-3 cursor-pointer transition-all " +
                    (selected===p.id?"border-blue-500 bg-blue-50 shadow-sm":"border-slate-200 bg-white hover:shadow-sm")}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
                      <span>{ti.icon}</span>{p.name}
                    </div>
                    {propContracts.length > 0 && (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">{propContracts.length}</span>
                    )}
                  </div>
                  {p.city && <div className="text-xs text-slate-400">📍 {p.city}</div>}
                  {p.companies?.company_name && <div className="text-xs text-slate-400">🏛️ {p.companies.company_name}</div>}
                </div>
              );
            })
          )}
          {filtered.length === 0 && !loading && <div className="text-center py-4 text-slate-400 text-sm">אין נכסים</div>}
        </div>

        {/* פרטים */}
        <div className="lg:col-span-3">
          {!selProp ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">🏢</div><div>בחר נכס לצפייה</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* כרטיס ראשי */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl">{typeInfo(selProp.property_type).icon}</span>
                      <h2 className="text-xl font-bold text-slate-800">{selProp.name}</h2>
                    </div>
                    {selProp.companies?.company_name && <div className="text-sm text-slate-500">🏛️ {selProp.companies.company_name}</div>}
                    {selProp.city && <div className="text-sm text-slate-500">📍 {selProp.address ? selProp.address+", " : ""}{selProp.city}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function(){openEdit(selProp);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={function(){handleDelete(selProp.id);}} className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">🗑</button>
                  </div>
                </div>

                {/* KPI */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    {label:"הכנסה חודשית", value:fmtMoney(selRevenue),      color:"text-green-700", bg:"bg-green-50"},
                    {label:"תפוסה",         value:selOccPct+"%",              color:"text-blue-700",  bg:"bg-blue-50"},
                    {label:"יחידות",        value:selSpaces.length+" יח'",   color:"text-slate-700", bg:"bg-slate-50"},
                    {label:"חוזים פעילים", value:String(selContracts.length),color:"text-purple-700",bg:"bg-purple-50"},
                  ].map(function(k) {
                    return (
                      <div key={k.label} className={"rounded-xl p-3 text-center " + k.bg}>
                        <div className={"text-lg font-black " + k.color}>{k.value}</div>
                        <div className="text-xs text-slate-400">{k.label}</div>
                      </div>
                    );
                  })}
                </div>

                {/* פרטים נוספים */}
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  {[
                    {l:"סוג",    v:typeInfo(selProp.property_type).l},
                    {l:"שטח",   v:selProp.total_area ? selProp.total_area+' מ"ר' : "—"},
                    {l:"קומות", v:selProp.floors ? selProp.floors+" קומות" : "—"},
                  ].map(function(row) {
                    return (
                      <div key={row.l} className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="text-slate-400">{row.l}</span>
                        <span className="font-semibold text-slate-700">{row.v}</span>
                      </div>
                    );
                  })}
                </div>
                {selProp.notes && <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{selProp.notes}</div>}
              </div>

              {/* חוזים */}
              {selContracts.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-semibold text-slate-700 text-sm">חוזים פעילים ({selContracts.length})</span>
                    <button onClick={function(){router.push("/contracts");}} className="text-xs text-blue-600 hover:underline">הכל →</button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {selContracts.map(function(c) {
                      const mon = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
                      return (
                        <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
                          <div>
                            <div className="font-medium text-slate-800 text-sm">{c.tenants?.name}</div>
                            <span className={"text-xs px-1.5 py-0.5 rounded-full " +
                              (c.status==="active"?"bg-green-100 text-green-700":c.status==="expiring"?"bg-yellow-100 text-yellow-700":"bg-blue-100 text-blue-700")}>
                              {c.status==="active"?"פעיל":c.status==="expiring"?"פוגה":"מורחב"}
                            </span>
                          </div>
                          <div className="font-bold text-green-700 text-sm">{fmtMoney(mon)}/חודש</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* יחידות */}
              {selSpaces.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-semibold text-slate-700 text-sm">יחידות ({selSpaces.length})</span>
                    <button onClick={function(){router.push("/units");}} className="text-xs text-blue-600 hover:underline">נהל →</button>
                  </div>
                  <div className="px-5 py-3 grid grid-cols-3 gap-2">
                    {[
                      {label:"מושכרות", count:selOccupied,                               color:"text-green-600"},
                      {label:"פנויות",  count:selSpaces.filter(function(s){return s.status==="vacant";}).length, color:"text-blue-600"},
                      {label:"תחזוקה", count:selSpaces.filter(function(s){return s.status==="maintenance";}).length, color:"text-slate-400"},
                    ].map(function(k) {
                      return (
                        <div key={k.label} className="text-center">
                          <div className={"text-xl font-black " + k.color}>{k.count}</div>
                          <div className="text-xs text-slate-400">{k.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew?"נכס חדש":"עריכת נכס"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם הנכס *</label>
                <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חברה</label>
                <select value={fCompanyId} onChange={function(e){setFCompanyId(e.target.value);}} className={ic}>
                  <option value="">-- ללא חברה --</option>
                  {companies.map(function(c){return <option key={c.id} value={c.id}>{c.company_name}</option>;})}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג נכס</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {PROP_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFType(t.v);}}
                        className={"rounded-lg border p-2 text-center " + (fType===t.v?"border-blue-500 bg-blue-50":"border-slate-200 hover:bg-slate-50")}>
                        <div className="text-lg">{t.icon}</div>
                        <div className={"text-xs " + (fType===t.v?"text-blue-700 font-bold":"text-slate-500")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
                  <input type="text" value={fAddress} onChange={function(e){setFAddress(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">עיר</label>
                  <input type="text" value={fCity} onChange={function(e){setFCity(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שטח כולל (מ"ר)</label>
                  <input type="number" value={fArea} onChange={function(e){setFArea(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">קומות</label>
                  <input type="number" value={fFloors} onChange={function(e){setFFloors(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={2} className={ic} />
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
