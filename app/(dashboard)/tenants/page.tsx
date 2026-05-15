"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import { fetchCpiAdjusted, fetchHighestChainedCpi } from '@/lib/cpi-server';
import { getKnownIndexMonth } from '@/lib/cpi-utils';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return n ? "₪"+n.toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; }

export default function TenantsPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string|null>(null);
  const [editingId, setEditingId] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [fName, setFName] = useState("");
  const [fCompany, setFCompany] = useState("");
  const [fIdNumber, setFIdNumber] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fAddress, setFAddress] = useState("");
  const [fCity, setFCity] = useState("");
  const [fContactName, setFContactName] = useState("");
  const [fContactPhone, setFContactPhone] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fContacts, setFContacts] = useState<{name:string;role:string;email:string;phone:string}[]>([]);
  const [cpiRatios, setCpiRatios] = useState<Record<string, number>>({});

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from("tenants").select("*").order("name"),
      supabase.from("contracts")
        .select("id, status, start_date, end_date, rent_per_sqm, charged_area, investment_addition, tenant_id, index_base_date, indexation_method, index_mechanism, properties(name)")
        .in("status", ["active","expiring","extended","upcoming"]).order("end_date"),
    ]);
    setTenants(t ?? []);
    setContracts(c ?? []);
    setLoading(false);
    if (!selected && (t ?? []).length > 0) setSelected((t ?? [])[0].id);
    // Per-contract CPI ratios. Group by (base date + mechanism) to dedupe
    // CBS calls; each contract still gets its own ratio.
    try {
      var toCbsDate = function(d: string): string {
        var dt = new Date(d); if (dt.getDate() === 15) dt.setDate(16);
        var mm = String(dt.getMonth()+1).padStart(2,"0");
        var dd = String(dt.getDate()).padStart(2,"0");
        return mm + "-" + dd + "-" + dt.getFullYear();
      };
      var now = new Date();
      var todayCbs = String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0")+"-"+now.getFullYear();
      var nowKnown = getKnownIndexMonth(now);

      var validContracts = (c ?? []).filter(function(x: any) {
        return x.index_base_date && x.indexation_method && x.indexation_method !== "none";
      });

      var groupMap: Record<string, { contractIds: string[]; fromDate: string; rawBase: string; isHighest: boolean }> = {};
      validContracts.forEach(function(x: any) {
        var fromDate = toCbsDate(x.index_base_date);
        var isHighest = x.indexation_method === "highest_in_period" || x.indexation_method === "no_drop"
          || x.index_mechanism === "highest_in_period" || x.index_mechanism === "no_drop";
        var key = fromDate + "|" + (isHighest ? "H" : "S");
        if (!groupMap[key]) groupMap[key] = { contractIds: [], fromDate: fromDate, rawBase: x.index_base_date, isHighest: isHighest };
        groupMap[key].contractIds.push(x.id);
      });

      var groupResults = await Promise.all(Object.keys(groupMap).map(async function(k) {
        var g = groupMap[k];
        try {
          if (g.isHighest) {
            var baseDateObj = new Date(g.rawBase);
            var peak = await fetchHighestChainedCpi({
              baseFromDate: g.fromDate,
              scanFromYear: baseDateObj.getFullYear(),
              scanFromMonth: baseDateObj.getMonth() + 1,
              scanToYear: nowKnown.year,
              scanToMonth: nowKnown.month,
            });
            if (peak.success && peak.peakRatio) return { key: k, ratio: peak.peakRatio };
          }
          var data: any = await fetchCpiAdjusted({ value: 10000, fromDate: g.fromDate, toDate: todayCbs });
          if (!data || !data.success) return { key: k, ratio: 1 };
          return { key: k, ratio: (Number(data.adjustedRentPerSqm) || 10000) / 10000 };
        } catch { return { key: k, ratio: 1 }; }
      }));

      var ratioMap: Record<string, number> = {};
      groupResults.forEach(function(r: any) {
        var g = groupMap[r.key];
        if (!g) return;
        g.contractIds.forEach(function(cid: string) { ratioMap[cid] = r.ratio; });
      });
      setCpiRatios(ratioMap);
    } catch(e) {}
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFCompany(""); setFIdNumber(""); setFPhone("");
    setFEmail(""); setFAddress(""); setFCity(""); setFContactName("");
    setFContactPhone(""); setFNotes(""); setFContacts([]);
  }

  function openEdit(t: any) {
    setIsNew(false); setEditingId(t.id);
    setFName(t.name ?? ""); setFCompany(t.company_name ?? "");
    setFIdNumber(t.id_number ?? ""); setFPhone(t.phone ?? "");
    setFEmail(t.email ?? ""); setFAddress(t.address ?? "");
    setFCity(t.city ?? ""); setFContactName(t.contact_name ?? "");
    setFContactPhone(t.contact_phone ?? ""); setFNotes(t.notes ?? "");
    setFContacts(Array.isArray(t.contacts) ? t.contacts : []);
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם שוכר"); return; }
    setSaving(true);
    try {
      const payload = {
        name: fName.trim(), company_name: fCompany||null,
        id_number: fIdNumber||null, phone: fPhone||null,
        email: fEmail||null, address: fAddress||null,
        city: fCity||null, contact_name: fContactName||null,
        contact_phone: fContactPhone||null, notes: fNotes||null,
        contacts: fContacts.filter(c => c.name.trim()),
      };
      if (isNew) {
        const { data, error: _ie } = await supabase.from("tenants").insert(payload).select().single();
      if (_ie) throw new Error(_ie.message);
      if (!data?.id) throw new Error("שגיאה בשמירה");
        await logAudit({ entity_type: "tenant", entity_id: data.id, action: "create" });
        setSelected(data.id);
      } else {
        await supabase.from("tenants").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "tenant", entity_id: editingId, action: "update" });
      }
      setEditingId(""); await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק שוכר? פעולה זו תמחק גם את כל חוזי השוכר וכל הנתונים הקשורים אליהם.")) return;
    const { data: tContracts } = await supabase.from("contracts").select("id").eq("tenant_id", id);
    const tcIds = (tContracts || []).map((c: any) => c.id);
    if (tcIds.length > 0) {
      await supabase.from("charges").delete().in("contract_id", tcIds);
      await supabase.from("contract_spaces").delete().in("contract_id", tcIds);
      await supabase.from("contract_options").delete().in("contract_id", tcIds);
      await supabase.from("contract_price_tiers").delete().in("contract_id", tcIds);
      await supabase.from("guarantees").delete().in("contract_id", tcIds);
      await supabase.from("insurances_tenant").delete().in("contract_id", tcIds);
      await supabase.from("letters").delete().in("contract_id", tcIds);
      await supabase.from("contracts").delete().in("id", tcIds);
    }
    await supabase.from("tenants").delete().eq("id", id);
    setSelected(null); await loadAll();
  }

  const filtered = tenants.filter(t =>
    !search || t.name?.includes(search) || t.company_name?.includes(search) || t.id_number?.includes(search)
  );
  const selTenant = tenants.find(t => t.id === selected);
  const selContracts = contracts.filter(c => c.tenant_id === selected);
  const selRevenueBase = selContracts.reduce((s, c) => s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0), 0);
  // Indexed revenue: each contract uses its own ratio (highest contracts get
  // the chained peak; standard contracts get the base→today ratio).
  const selRevenue = selContracts.reduce((s, c) => {
    var r = cpiRatios[c.id] || 1;
    return s + ((c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0)) * r;
  }, 0);

  const STATUS_MAP: Record<string, {label: string; color: string}> = {
    active:   { label: "פעיל",    color: "bg-green-100 text-green-700"   },
    expiring: { label: "פוגע",    color: "bg-yellow-100 text-yellow-700" },
    extended: { label: "מוארך",   color: "bg-blue-100 text-blue-700"     },
    upcoming: { label: "עתידי",   color: "bg-purple-100 text-purple-700" },
  };

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">שוכרים</h1>
          <p className="text-sm text-slate-500 mt-1">{tenants.length} שוכרים</p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + שוכר חדש
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* רשימה */}
        <div className="space-y-2">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש שם / חברה / ח.פ..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm mb-2" />
          {loading ? <div className="text-center py-4 text-slate-400">טוען...</div> : (
            filtered.map(t => {
              const tenContracts = contracts.filter(c => c.tenant_id === t.id);
              const hasActive = tenContracts.some(c => c.status === "active");
              return (
                <div key={t.id} onClick={() => setSelected(selected === t.id ? null : t.id)}
                  className={"rounded-xl border p-3 cursor-pointer transition-all " +
                    (selected === t.id ? "border-blue-500 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:shadow-sm")}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-800 text-sm">{t.name}</div>
                      {t.company_name && <div className="text-xs text-slate-400">{t.company_name}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      {hasActive && <span className="w-2 h-2 rounded-full bg-green-400" />}
                      {tenContracts.length > 0 && <span className="text-xs text-slate-400">{tenContracts.length}</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {filtered.length === 0 && !loading && <div className="text-center py-4 text-slate-400 text-sm">אין שוכרים</div>}
        </div>

        {/* פרטים */}
        <div className="lg:col-span-3">
          {!selTenant ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">👤</div>
              <div>בחר שוכר לצפייה</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* כרטיס ראשי */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 mb-0.5">{selTenant.name}</h2>
                    {selTenant.company_name && <div className="text-sm text-slate-500">🏢 {selTenant.company_name}</div>}
                    {selTenant.id_number && <div className="text-xs text-slate-400 font-mono">ח.פ/ת.ז: {selTenant.id_number}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(selTenant)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={() => handleDelete(selTenant.id)}
                      className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">🗑</button>
                  </div>
                </div>
                {/* KPI */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: "חוזים פעילים",    value: String(selContracts.length),  color: "text-slate-800", bg: "bg-slate-50"  },
                    { label: "הכנסה חודשית צמודה", value: fmtMoney(selRevenue),          color: "text-green-700", bg: "bg-green-50"  },
                    { label: "נכסים",            value: String(new Set(selContracts.map(c => c.properties?.name)).size), color: "text-blue-700", bg: "bg-blue-50" },
                  ].map(k => (
                    <div key={k.label} className={"rounded-xl p-3 text-center " + k.bg}>
                      <div className={"text-lg font-black " + k.color}>{k.value}</div>
                      <div className="text-xs text-slate-400">{k.label}</div>
                    </div>
                  ))}
                </div>
                {/* פרטי קשר */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { l: "טלפון",    v: selTenant.phone,   dir: "ltr" },
                    { l: "אימייל",   v: selTenant.email,   dir: "ltr" },
                    { l: "כתובת",    v: selTenant.address ? selTenant.address + (selTenant.city ? ", " + selTenant.city : "") : selTenant.city, dir: "rtl" },
                    { l: "איש קשר", v: selTenant.contact_name ? selTenant.contact_name + (selTenant.contact_phone ? " | " + selTenant.contact_phone : "") : null, dir: "rtl" },
                  ].filter(f => f.v).map(f => (
                    <div key={f.l} className="flex gap-2 border-b border-slate-100 pb-1.5">
                      <span className="text-slate-400 shrink-0">{f.l}:</span>
                      <span className="font-medium text-slate-700" dir={f.dir as any}>{f.v}</span>
                    </div>
                  ))}
                </div>
                {selTenant.notes && <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{selTenant.notes}</div>}
              </div>

              {/* חוזים */}
              {selContracts.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-semibold text-slate-700 text-sm">חוזים ({selContracts.length})</span>
                    <button onClick={() => router.push("/contracts/new")}
                      className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg font-semibold hover:bg-blue-700">+ חוזה חדש</button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {selContracts.map(c => {
                      const mon = ((c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0)) * (cpiRatios[c.id] || 1);
                      const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime() - Date.now()) / 86400000) : null;
                      const si = STATUS_MAP[c.status] ?? { label: c.status, color: "bg-slate-100 text-slate-600" };
                      return (
                        <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                          onClick={() => router.push("/contracts")}>
                          <div>
                            <div className="font-medium text-slate-800 text-sm">{c.properties?.name}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={"text-xs px-1.5 py-0.5 rounded-full " + si.color}>{si.label}</span>
                              <span className="text-xs text-slate-400">{fmtDate(c.start_date)} — {fmtDate(c.end_date)}</span>
                              {days !== null && days <= 90 && days > 0 && (
                                <span className={"text-xs font-semibold " + (days <= 30 ? "text-red-600" : "text-yellow-600")}>{days} ימים</span>
                              )}
                            </div>
                          </div>
                          <div className="font-bold text-green-700 text-sm">{fmtMoney(mon)}/חודש</div>
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingId("")}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "שוכר חדש" : "עריכת שוכר"}</h2>
              <button onClick={() => setEditingId("")} className="text-2xl text-slate-400">✕</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם *</label>
                <input type="text" value={fName} onChange={e => setFName(e.target.value)} className={ic} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שם חברה</label>
                  <input type="text" value={fCompany} onChange={e => setFCompany(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">ח.פ / ת.ז</label>
                  <input type="text" value={fIdNumber} onChange={e => setFIdNumber(e.target.value)} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון</label>
                  <input type="tel" value={fPhone} onChange={e => setFPhone(e.target.value)} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל</label>
                  <input type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
                  <input type="text" value={fAddress} onChange={e => setFAddress(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">עיר</label>
                  <input type="text" value={fCity} onChange={e => setFCity(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">איש קשר</label>
                  <input type="text" value={fContactName} onChange={e => setFContactName(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון איש קשר</label>
                  <input type="tel" value={fContactPhone} onChange={e => setFContactPhone(e.target.value)} className={ic} dir="ltr" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={2} className={ic} />
              </div>

              {/* אנשי קשר */}
              <div className="rounded-lg border border-slate-200 p-3 mt-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700">אנשי קשר נוספים</span>
                  <button type="button" onClick={() => setFContacts(prev => [...prev, {name:"",role:"",email:"",phone:""}])}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg font-semibold hover:bg-blue-700">+ הוסף</button>
                </div>
                {fContacts.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-2">אין אנשי קשר נוספים</div>
                ) : fContacts.map((c, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 p-2 mb-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600">איש קשר {i+1}</span>
                      <button type="button" onClick={() => setFContacts(prev => prev.filter((_,j)=>j!==i))}
                        className="text-xs text-red-500 hover:text-red-700">הסר</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={c.name} placeholder="שם" className={ic+" text-xs"}
                        onChange={e => setFContacts(prev => prev.map((x,j)=>j===i?{...x,name:e.target.value}:x))} />
                      <input type="text" value={c.role} placeholder="תפקיד" className={ic+" text-xs"}
                        onChange={e => setFContacts(prev => prev.map((x,j)=>j===i?{...x,role:e.target.value}:x))} />
                      <input type="email" value={c.email} placeholder="אימייל" className={ic+" text-xs"} dir="ltr"
                        onChange={e => setFContacts(prev => prev.map((x,j)=>j===i?{...x,email:e.target.value}:x))} />
                      <input type="tel" value={c.phone} placeholder="טלפון" className={ic+" text-xs"} dir="ltr"
                        onChange={e => setFContacts(prev => prev.map((x,j)=>j===i?{...x,phone:e.target.value}:x))} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingId("")}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
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
