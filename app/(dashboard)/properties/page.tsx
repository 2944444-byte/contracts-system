"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const PROP_TYPES = [
  { v: "office",      l: "משרדים",    icon: "💼" },
  { v: "commercial",  l: "מסחרי",     icon: "🏪" },
  { v: "logistics",   l: "לוגיסטי",   icon: "🏭" },
  { v: "storage",     l: "מחסנים",    icon: "📦" },
  { v: "mixed",       l: "מעורב",     icon: "🏗️" },
  { v: "other",       l: "אחר",       icon: "🏠" },
];

function getTypeInfo(v: string) {
  return PROP_TYPES.find(function(t) { return t.v === v; }) ?? PROP_TYPES[5];
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<any[]>([]);
  const [companies,  setCompanies]  = useState<any[]>([]);
  const [groups,     setGroups]     = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState<any>(null);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);

  const [fName,      setFName]      = useState("");
  const [fAddress,   setFAddress]   = useState("");
  const [fCity,      setFCity]      = useState("");
  const [fType,      setFType]      = useState("office");
  const [fArea,      setFArea]      = useState("");
  const [fCompanyId, setFCompanyId] = useState("");
  const [fGroupId,   setFGroupId]   = useState("");
  const [fMgmtFee,   setFMgmtFee]   = useState("");
  const [fNotes,     setFNotes]     = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: p }, { data: c }, { data: g }] = await Promise.all([
      supabase.from("properties")
        .select("*, companies(company_name), property_groups(name), spaces(id,status,area), contracts(id,status,rent_per_sqm,charged_area,investment_addition,tenants(name))")
        .order("name"),
      supabase.from("companies").select("id, company_name").order("company_name"),
      supabase.from("property_groups").select("id, name").order("name"),
    ]);
    setProperties(p ?? []);
    setCompanies(c ?? []);
    setGroups(g ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFAddress(""); setFCity(""); setFType("office");
    setFArea(""); setFCompanyId(""); setFGroupId(""); setFMgmtFee(""); setFNotes("");
  }

  function openEdit(p: any) {
    setIsNew(false); setEditingId(p.id);
    setFName(p.name ?? ""); setFAddress(p.address ?? ""); setFCity(p.city ?? "");
    setFType(p.property_type ?? "office"); setFArea(p.total_rentable_area?.toString() ?? "");
    setFCompanyId(p.company_id ?? ""); setFGroupId(p.group_id ?? "");
    setFMgmtFee(p.mgmt_fee_per_sqm?.toString() ?? ""); setFNotes(p.notes ?? "");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם נכס"); return; }
    setSaving(true);
    try {
      const payload = {
        name: fName.trim(), address: fAddress || null, city: fCity || null,
        property_type: fType, total_rentable_area: fArea ? Number(fArea) : null,
        company_id: fCompanyId || null, group_id: fGroupId || null,
        mgmt_fee_per_sqm: fMgmtFee ? Number(fMgmtFee) : null, notes: fNotes || null,
      };
      if (isNew) {
        const { data } = await supabase.from("properties").insert(payload).select().single();
        await logAudit({ entity_type: "property", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("properties").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "property", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm("למחוק נכס \"" + name + "\"?")) return;
    await supabase.from("properties").delete().eq("id", id);
    if (selected?.id === id) setSelected(null);
    await loadAll();
  }

  function getStats(p: any) {
    const spaces   = p.spaces ?? [];
    const occupied = spaces.filter(function(s: any) { return s.status === "rented"; }).length;
    const totalArea= spaces.reduce(function(s: number, sp: any) { return s + (sp.area ?? 0); }, 0);
    const pct      = spaces.length > 0 ? Math.round(occupied / spaces.length * 100) : 0;
    const active   = (p.contracts ?? []).filter(function(c: any) { return ["active","expiring","extended"].includes(c.status); });
    const revenue  = active.reduce(function(s: number, c: any) {
      return s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
    }, 0);
    return { total: spaces.length, occupied, pct, totalArea, revenue, activeContracts: active.length };
  }

  const filtered = properties.filter(function(p) {
    return !search || p.name?.includes(search) || p.city?.includes(search);
  });

  return (
    <div dir="rtl" className="flex gap-5 h-[calc(100vh-120px)]">
      {/* רשימה */}
      <div className="w-72 shrink-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-slate-800">נכסים</h1>
            <button onClick={openNew}
              className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg font-bold">+ חדש</button>
          </div>
          <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
            placeholder="חיפוש נכס..." className={ic} />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
          {loading ? (
            <div className="py-8 text-center text-slate-400 text-sm">טוען...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">לא נמצאו נכסים</div>
          ) : filtered.map(function(p) {
            const s = getStats(p);
            const ti = getTypeInfo(p.property_type);
            const isSelected = selected?.id === p.id;
            return (
              <div key={p.id} onClick={function(){setSelected(p);}}
                className={"flex items-center gap-3 px-4 py-3 cursor-pointer " +
                  (isSelected ? "bg-blue-50 border-r-2 border-r-blue-600" : "hover:bg-slate-50")}>
                <div className={"w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 " +
                  (isSelected ? "bg-blue-100" : "bg-slate-100")}>
                  {ti.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={"font-semibold text-sm truncate " + (isSelected ? "text-blue-800" : "text-slate-800")}>{p.name}</div>
                  <div className="text-xs text-slate-400 truncate">{p.city ?? ti.l}</div>
                </div>
                {s.pct > 0 && (
                  <div className={"text-xs font-bold shrink-0 " + (s.pct >= 80 ? "text-green-600" : s.pct >= 50 ? "text-yellow-600" : "text-red-500")}>
                    {s.pct}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* פירוט */}
      {selected ? (
        <div className="flex-1 rounded-xl border border-slate-200 bg-white shadow-sm overflow-y-auto">
          {(() => {
            const s  = getStats(selected);
            const ti = getTypeInfo(selected.property_type);
            return (
              <div>
                {/* Header */}
                <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-100 z-10">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-2xl">{ti.icon}</div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-800">{selected.name}</h2>
                        <div className="text-sm text-slate-500">
                          {selected.city ?? ""}{selected.address ? " | " + selected.address : ""}
                        </div>
                        {selected.companies && (
                          <div className="text-xs text-blue-600 mt-0.5">🏛️ {selected.companies.company_name}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={function(){openEdit(selected);}}
                        className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">✏️ עריכה</button>
                      <button onClick={function(){handleDelete(selected.id, selected.name);}}
                        className="rounded-lg border border-red-100 px-3 py-2 text-xs text-red-500 hover:bg-red-50">🗑</button>
                    </div>
                  </div>

                  {/* KPI */}
                  <div className="grid grid-cols-4 gap-3 mt-4">
                    {[
                      { label: "יחידות",      value: s.total,                                                  color: "text-slate-800" },
                      { label: "תפוסה",       value: s.pct + "%",                                              color: s.pct>=80?"text-green-700":s.pct>=50?"text-yellow-600":"text-red-600" },
                      { label: "הכנסה/חודש",  value: "₪" + Math.round(s.revenue).toLocaleString(),            color: "text-green-700" },
                      { label: "שטח מ\"ר",    value: (selected.total_rentable_area ?? s.totalArea).toLocaleString(), color: "text-slate-800" },
                    ].map(function(k) {
                      return (
                        <div key={k.label} className="rounded-xl border border-slate-200 p-3 text-center">
                          <div className={"text-lg font-black " + k.color}>{k.value}</div>
                          <div className="text-xs text-slate-400">{k.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* פרטים */}
                <div className="p-6 space-y-4">
                  <div className="space-y-2 max-w-md">
                    {[
                      { label: "סוג נכס",       value: ti.icon + " " + ti.l },
                      { label: "קבוצה",         value: selected.property_groups?.name },
                      { label: "דמי ניהול",     value: selected.mgmt_fee_per_sqm ? "₪" + selected.mgmt_fee_per_sqm + "/מ\"ר" : null },
                      { label: "חוזים פעילים",  value: s.activeContracts > 0 ? s.activeContracts + " חוזים" : null },
                    ].map(function(row) {
                      if (!row.value) return null;
                      return (
                        <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100">
                          <span className="text-xs text-slate-500">{row.label}</span>
                          <span className="text-sm font-medium text-slate-800">{row.value}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* יחידות */}
                  {(selected.spaces ?? []).length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-slate-500 uppercase mb-2">יחידות ({selected.spaces.length})</div>
                      <div className="grid grid-cols-3 gap-2">
                        {selected.spaces.map(function(sp: any) {
                          return (
                            <div key={sp.id} className={"rounded-lg border p-2 text-center text-xs " +
                              (sp.status === "rented" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-green-200 bg-green-50 text-green-700")}>
                              <div className="font-semibold">{sp.area ?? 0} מ"ר</div>
                              <div>{sp.status === "rented" ? "מושכר" : "פנוי"}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* שוכרים פעילים */}
                  {s.activeContracts > 0 && (
                    <div>
                      <div className="text-xs font-bold text-slate-500 uppercase mb-2">שוכרים פעילים</div>
                      <div className="space-y-1">
                        {(selected.contracts ?? [])
                          .filter(function(c: any) { return ["active","expiring","extended"].includes(c.status); })
                          .map(function(c: any) {
                            const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                            return (
                              <div key={c.id} className="flex justify-between items-center py-1.5 border-b border-slate-100">
                                <span className="text-sm text-slate-700">{c.tenants?.name}</span>
                                <span className="text-xs font-bold text-green-700">₪{Math.round(monthly).toLocaleString()}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {selected.notes && (
                    <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{selected.notes}</div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="flex-1 rounded-xl border-2 border-dashed border-slate-200 bg-white flex items-center justify-center">
          <div className="text-center text-slate-400">
            <div className="text-5xl mb-3">🏢</div>
            <div className="font-medium">בחר נכס מהרשימה</div>
            <div className="text-sm mt-1">או <button onClick={openNew} className="text-blue-600 hover:underline">הוסף נכס חדש</button></div>
          </div>
        </div>
      )}

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "נכס חדש" : "עריכת נכס"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם הנכס *</label>
                <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} />
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
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג נכס</label>
                <div className="grid grid-cols-3 gap-2">
                  {PROP_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFType(t.v);}}
                        className={"rounded-lg border p-2 text-center " +
                          (fType === t.v ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <div>{t.icon}</div>
                        <div className={"text-xs font-semibold " + (fType === t.v ? "text-blue-700" : "text-slate-600")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שטח כולל (מ"ר)</label>
                  <input type="number" value={fArea} onChange={function(e){setFArea(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול (₪/מ"ר)</label>
                  <input type="number" value={fMgmtFee} onChange={function(e){setFMgmtFee(e.target.value);}} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">חברה</label>
                  <select value={fCompanyId} onChange={function(e){setFCompanyId(e.target.value);}} className={ic}>
                    <option value="">-- ללא חברה --</option>
                    {companies.map(function(c) { return <option key={c.id} value={c.id}>{c.company_name}</option>; })}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">קבוצה</label>
                  <select value={fGroupId} onChange={function(e){setFGroupId(e.target.value);}} className={ic}>
                    <option value="">-- ללא קבוצה --</option>
                    {groups.map(function(g) { return <option key={g.id} value={g.id}>{g.name}</option>; })}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={2} className={ic} />
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
