"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const PROP_TYPES = [
  { v:"office",     l:"משרדים",    icon:"🏢" },
  { v:"retail",     l:"מסחרי",     icon:"🏪" },
  { v:"warehouse",  l:"מחסן",      icon:"🏭" },
  { v:"industrial", l:"תעשייתי",   icon:"⚙️" },
  { v:"mixed",      l:"מעורב",     icon:"🏬" },
  { v:"other",      l:"אחר",       icon:"📋" },
];

function typeInfo(v: string) {
  return PROP_TYPES.find(function(t) { return t.v === v; }) ?? PROP_TYPES[5];
}

export default function PropertiesPage() {
  const router    = useRouter();
  const [props,       setProps]     = useState<any[]>([]);
  const [companies,   setCompanies] = useState<any[]>([]);
  const [contracts,   setContracts] = useState<any[]>([]);
  const [spaces,      setSpaces]    = useState<any[]>([]);
  const [loading,     setLoading]   = useState(true);
  const [search,      setSearch]    = useState("");
  const [filterType,  setFilterType]= useState("all");
  const [selected,    setSelected]  = useState<string | null>(null);
  const [editingId,   setEditingId] = useState("");
  const [isNew,       setIsNew]     = useState(false);
  const [saving,      setSaving]    = useState(false);

  const [fName,      setFName]      = useState("");
  const [fType,      setFType]      = useState("office");
  const [fCompany,   setFCompany]   = useState("");
  const [fAddress,   setFAddress]   = useState("");
  const [fCity,      setFCity]      = useState("");
  const [fTotalArea, setFTotalArea] = useState("");
  const [fFloors,    setFFloors]    = useState("");
  const [fYear,      setFYear]      = useState("");
  const [fNotes,     setFNotes]     = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: p }, { data: c }, { data: ctr }, { data: sp }] = await Promise.all([
      supabase.from("properties").select("*, companies(company_name)").order("name"),
      supabase.from("companies").select("id, company_name").order("company_name"),
      supabase.from("contracts")
        .select("id, status, tenant_id, property_id, rent_per_sqm, charged_area, investment_addition, tenants(name)")
        .in("status",["active","expiring","extended"]),
      supabase.from("spaces").select("id, name, area, status, property_id").order("name"),
    ]);
    setProps(p ?? []);
    setCompanies(c ?? []);
    setContracts(ctr ?? []);
    setSpaces(sp ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFType("office"); setFCompany(""); setFAddress(""); setFCity("");
    setFTotalArea(""); setFFloors(""); setFYear(""); setFNotes("");
  }

  function openEdit(p: any) {
    setIsNew(false); setEditingId(p.id);
    setFName(p.name??""); setFType(p.property_type??"office"); setFCompany(p.company_id??"");
    setFAddress(p.address??""); setFCity(p.city??"");
    setFTotalArea(p.total_area?.toString()??""); setFFloors(p.floors?.toString()??"");
    setFYear(p.construction_year?.toString()??""); setFNotes(p.notes??"");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם"); return; }
    setSaving(true);
    try {
      const payload = {
        name: fName.trim(), property_type: fType,
        company_id: fCompany||null, address: fAddress||null, city: fCity||null,
        total_area: fTotalArea ? Number(fTotalArea) : null,
        floors: fFloors ? Number(fFloors) : null,
        construction_year: fYear ? Number(fYear) : null,
        notes: fNotes||null,
      };
      if (isNew) {
        const { data } = await supabase.from("properties").insert(payload).select().single();
        await logAudit({ entity_type:"property", entity_id:data.id, action:"create" });
      } else {
        await supabase.from("properties").update(payload).eq("id", editingId);
        await logAudit({ entity_type:"property", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק נכס?")) return;
    await supabase.from("properties").delete().eq("id", id);
    setSelected(null); await loadAll();
  }

  // נתוני נכס נבחר
  const selProp      = props.find(function(p) { return p.id === selected; });
  const selContracts = contracts.filter(function(c) { return c.property_id === selected; });
  const selSpaces    = spaces.filter(function(s) { return s.property_id === selected; });
  const selMonthly   = selContracts.reduce(function(s,c) { return s+(c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0); }, 0);
  const occupiedArea = selSpaces.filter(function(s) { return s.status==="occupied"; }).reduce(function(s,sp) { return s+(sp.area??0); }, 0);
  const totalArea    = selSpaces.reduce(function(s,sp) { return s+(sp.area??0); }, 0);
  const occupancy    = totalArea > 0 ? Math.round(occupiedArea/totalArea*100) : 0;

  const filtered = props.filter(function(p) {
    const mt = filterType==="all" || p.property_type===filterType;
    const mq = !search || p.name?.includes(search) || p.city?.includes(search);
    return mt && mq;
  });

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">נכסים</h1>
          <p className="text-sm text-slate-500 mt-1">{props.length} נכסים</p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + נכס חדש
        </button>
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="חיפוש..." className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
        <button onClick={function(){setFilterType("all");}} className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(filterType==="all"?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>הכל</button>
        {PROP_TYPES.map(function(t) {
          const cnt = props.filter(function(p) { return p.property_type===t.v; }).length;
          if (!cnt) return null;
          return (
            <button key={t.v} onClick={function(){setFilterType(filterType===t.v?"all":t.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(filterType===t.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {t.icon} {t.l} ({cnt})
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* רשימה */}
        <div className="lg:col-span-1 space-y-2">
          {loading ? <div className="text-center py-8 text-slate-400">טוען...</div> : (
            <>
              {filtered.map(function(p) {
                const pContracts = contracts.filter(function(c) { return c.property_id===p.id; });
                const pMonthly   = pContracts.reduce(function(s,c) { return s+(c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0); }, 0);
                const pSpaces    = spaces.filter(function(s) { return s.property_id===p.id; });
                const pOccupied  = pSpaces.filter(function(s) { return s.status==="occupied"; }).length;
                const ti         = typeInfo(p.property_type);
                return (
                  <div key={p.id} onClick={function(){setSelected(selected===p.id?null:p.id);}}
                    className={"rounded-xl border p-3 cursor-pointer transition-all "+(selected===p.id?"border-blue-500 bg-blue-50 shadow-sm":"border-slate-200 bg-white hover:shadow-sm")}>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{ti.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 text-sm truncate">{p.name}</div>
                        <div className="text-xs text-slate-400">{p.city ?? ti.l}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {pMonthly > 0 && <span className="text-xs text-green-600 font-semibold">₪{Math.round(pMonthly).toLocaleString()}</span>}
                      {pSpaces.length > 0 && <span className="text-xs text-slate-400">{pOccupied}/{pSpaces.length} יחידות</span>}
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">אין נכסים</div>}
            </>
          )}
        </div>

        {/* פרטים */}
        <div className="lg:col-span-2">
          {!selProp ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">🏢</div><div>בחר נכס מהרשימה</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* כרטיס */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{typeInfo(selProp.property_type).icon}</span>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">{selProp.name}</h2>
                      <div className="text-sm text-slate-500">{selProp.companies?.company_name}</div>
                      {selProp.city && <div className="text-xs text-slate-400">📍 {selProp.address ? selProp.address+", " : ""}{selProp.city}</div>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function(){openEdit(selProp);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={function(){handleDelete(selProp.id);}} className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">🗑 מחיקה</button>
                  </div>
                </div>

                {/* KPI */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label:"הכנסה חודשית", value:"₪"+Math.round(selMonthly).toLocaleString(), color:"text-green-700" },
                    { label:"תפוסה",         value:occupancy+"%",                               color:occupancy>=80?"text-green-700":occupancy>=50?"text-yellow-700":"text-red-600" },
                    { label:"יחידות",        value:selSpaces.length+" יח'",                    color:"text-slate-700" },
                    { label:"שטח כולל",      value:totalArea ? totalArea+" מ\"ר" : "—",        color:"text-slate-700" },
                  ].map(function(k) {
                    return (
                      <div key={k.label} className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
                        <div className={"text-lg font-black " + k.color}>{k.value}</div>
                        <div className="text-xs text-slate-400">{k.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* יחידות */}
              {selSpaces.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-semibold text-slate-700">יחידות ({selSpaces.length})</span>
                    <button onClick={function(){router.push("/units");}} className="text-xs text-blue-600 hover:underline">ניהול יחידות →</button>
                  </div>
                  <div className="grid grid-cols-2 gap-px bg-slate-100">
                    {selSpaces.map(function(s) {
                      const isOcc = s.status==="occupied";
                      return (
                        <div key={s.id} className={"bg-white p-3 " + (isOcc?"":"opacity-60")}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-800 text-sm">{s.name}</span>
                            <span className={"text-xs px-1.5 py-0.5 rounded-full font-semibold "+(isOcc?"bg-green-100 text-green-700":"bg-slate-100 text-slate-500")}>
                              {isOcc?"מושכר":"פנוי"}
                            </span>
                          </div>
                          {s.area && <div className="text-xs text-slate-400 mt-0.5">{s.area} מ"ר</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* חוזים */}
              {selContracts.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-700">חוזים פעילים</div>
                  <div className="divide-y divide-slate-100">
                    {selContracts.map(function(c) {
                      const mon = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
                      return (
                        <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
                          <div className="font-medium text-slate-800 text-sm">{c.tenants?.name}</div>
                          <div className="text-green-700 font-bold">₪{Math.round(mon).toLocaleString()}</div>
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
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "נכס חדש" : "עריכת נכס"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם *</label>
                <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג</label>
                <div className="grid grid-cols-3 gap-2">
                  {PROP_TYPES.map(function(t) {
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
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חברה</label>
                <select value={fCompany} onChange={function(e){setFCompany(e.target.value);}} className={ic}>
                  <option value="">-- ללא חברה --</option>
                  {companies.map(function(c){return <option key={c.id} value={c.id}>{c.company_name}</option>;})}
                </select>
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
                  <input type="number" value={fTotalArea} onChange={function(e){setFTotalArea(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">קומות</label>
                  <input type="number" value={fFloors} onChange={function(e){setFFloors(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שנת בנייה</label>
                <input type="number" value={fYear} onChange={function(e){setFYear(e.target.value);}} className={ic} placeholder="2020" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={2} className={ic} />
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
