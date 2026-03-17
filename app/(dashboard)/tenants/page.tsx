"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function TenantsPage() {
  const router   = useRouter();
  const [tenants,    setTenants]    = useState<any[]>([]);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [selected,   setSelected]   = useState<string | null>(null);

  const [fName,         setFName]         = useState("");
  const [fCompany,      setFCompany]      = useState("");
  const [fIdNum,        setFIdNum]        = useState("");
  const [fPhone,        setFPhone]        = useState("");
  const [fEmail,        setFEmail]        = useState("");
  const [fAddress,      setFAddress]      = useState("");
  const [fContact,      setFContact]      = useState("");
  const [fContactPhone, setFContactPhone] = useState("");
  const [fNotes,        setFNotes]        = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from("tenants").select("*").order("name"),
      supabase.from("contracts")
        .select("id, status, start_date, end_date, rent_per_sqm, charged_area, investment_addition, tenant_id, properties(name)")
        .in("status", ["active","expiring","extended","upcoming"]),
    ]);
    setTenants(t ?? []);
    setContracts(c ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFCompany(""); setFIdNum(""); setFPhone(""); setFEmail("");
    setFAddress(""); setFContact(""); setFContactPhone(""); setFNotes("");
  }

  function openEdit(t: any) {
    setIsNew(false); setEditingId(t.id);
    setFName(t.name??""); setFCompany(t.company_name??""); setFIdNum(t.id_number??"");
    setFPhone(t.phone??""); setFEmail(t.email??""); setFAddress(t.address??"");
    setFContact(t.contact_name??""); setFContactPhone(t.contact_phone??""); setFNotes(t.notes??"");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם"); return; }
    setSaving(true);
    try {
      const payload = {
        name: fName.trim(), company_name: fCompany||null, id_number: fIdNum||null,
        phone: fPhone||null, email: fEmail||null, address: fAddress||null,
        contact_name: fContact||null, contact_phone: fContactPhone||null, notes: fNotes||null,
      };
      if (isNew) {
        const { data } = await supabase.from("tenants").insert(payload).select().single();
        await logAudit({ entity_type:"tenant", entity_id:data.id, action:"create" });
      } else {
        await supabase.from("tenants").update(payload).eq("id", editingId);
        await logAudit({ entity_type:"tenant", entity_id:editingId, action:"update" });
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק שוכר? (חוזים קשורים יישארו)")) return;
    await supabase.from("tenants").delete().eq("id", id);
    setSelected(null); await loadAll();
  }

  const filtered = tenants.filter(function(t) {
    return !search || t.name?.includes(search) || t.company_name?.includes(search) || t.phone?.includes(search);
  });

  function tenantContracts(id: string) {
    return contracts.filter(function(c) { return c.tenant_id === id; });
  }

  function tenantMonthly(id: string): number {
    return tenantContracts(id).reduce(function(s, c) {
      return s + (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
    }, 0);
  }

  const selectedTenant = tenants.find(function(t) { return t.id === selected; });
  const selContracts   = selected ? tenantContracts(selected) : [];

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">שוכרים</h1>
          <p className="text-sm text-slate-500 mt-1">{tenants.length} שוכרים רשומים</p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + שוכר חדש
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* רשימה */}
        <div className="lg:col-span-1">
          <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
            placeholder="חיפוש שוכר..."
            className={"mb-3 " + ic} />
          {loading ? (
            <div className="text-center py-8 text-slate-400">טוען...</div>
          ) : (
            <div className="space-y-2">
              {filtered.map(function(t) {
                const cnt = tenantContracts(t.id).length;
                const mon = tenantMonthly(t.id);
                return (
                  <div key={t.id}
                    onClick={function(){setSelected(selected===t.id?null:t.id);}}
                    className={"rounded-xl border p-3 cursor-pointer transition-all " +
                      (selected===t.id ? "border-blue-500 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:shadow-sm")}>
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-slate-800 text-sm">{t.name}</div>
                      {cnt > 0 && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">{cnt} חוזים</span>}
                    </div>
                    {t.company_name && <div className="text-xs text-slate-400 mt-0.5">{t.company_name}</div>}
                    {mon > 0 && <div className="text-xs text-green-600 font-semibold mt-0.5">₪{Math.round(mon).toLocaleString()}/חודש</div>}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-sm">אין שוכרים</div>
              )}
            </div>
          )}
        </div>

        {/* פרטים */}
        <div className="lg:col-span-2">
          {!selectedTenant ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">👤</div>
              <div>בחר שוכר מהרשימה</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* כרטיס ראשי */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">{selectedTenant.name}</h2>
                    {selectedTenant.company_name && <div className="text-sm text-slate-500">{selectedTenant.company_name}</div>}
                    {selectedTenant.id_number && <div className="text-xs text-slate-400 font-mono">ח.פ: {selectedTenant.id_number}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function(){openEdit(selectedTenant);}}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                      ✏️ עריכה
                    </button>
                    <button onClick={function(){handleDelete(selectedTenant.id);}}
                      className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">
                      🗑 מחיקה
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label:"טלפון",    value:selectedTenant.phone,         icon:"📞" },
                    { label:"אימייל",   value:selectedTenant.email,         icon:"✉️" },
                    { label:"כתובת",    value:selectedTenant.address,       icon:"📍" },
                    { label:"איש קשר", value:selectedTenant.contact_name,  icon:"👤" },
                  ].map(function(f) {
                    if (!f.value) return null;
                    return (
                      <div key={f.label} className="flex items-center gap-2 text-slate-600">
                        <span className="text-base">{f.icon}</span>
                        <div>
                          <div className="text-xs text-slate-400">{f.label}</div>
                          <div className="font-medium text-slate-800">{f.value}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {selectedTenant.notes && (
                  <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{selectedTenant.notes}</div>
                )}
              </div>

              {/* חוזים */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="font-semibold text-slate-700">חוזים</span>
                  <button onClick={function(){router.push("/contracts/new");}}
                    className="text-xs text-blue-600 hover:underline">+ חוזה חדש</button>
                </div>
                {selContracts.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-sm">אין חוזים פעילים</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {selContracts.map(function(c) {
                      const mon = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
                      const statusColor = c.status==="active"?"bg-green-100 text-green-700":c.status==="expiring"?"bg-yellow-100 text-yellow-700":"bg-slate-100 text-slate-600";
                      return (
                        <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                          onClick={function(){router.push("/contracts");}}>
                          <div>
                            <div className="font-medium text-slate-800 text-sm">{c.properties?.name}</div>
                            <div className="text-xs text-slate-400">
                              {fmtDate(c.start_date)} — {fmtDate(c.end_date)}
                            </div>
                          </div>
                          <div className="text-left">
                            <div className="font-bold text-green-700">₪{Math.round(mon).toLocaleString()}</div>
                            <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + statusColor}>
                              {c.status==="active"?"פעיל":c.status==="expiring"?"פוגה":"אחר"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "שוכר חדש" : "עריכת שוכר"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שם *</label>
                  <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שם חברה</label>
                  <input type="text" value={fCompany} onChange={function(e){setFCompany(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">ח.פ / ת.ז</label>
                  <input type="text" value={fIdNum} onChange={function(e){setFIdNum(e.target.value);}} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון</label>
                  <input type="tel" value={fPhone} onChange={function(e){setFPhone(e.target.value);}} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל</label>
                  <input type="email" value={fEmail} onChange={function(e){setFEmail(e.target.value);}} className={ic} dir="ltr" />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
                  <input type="text" value={fAddress} onChange={function(e){setFAddress(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">איש קשר</label>
                  <input type="text" value={fContact} onChange={function(e){setFContact(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון איש קשר</label>
                  <input type="tel" value={fContactPhone} onChange={function(e){setFContactPhone(e.target.value);}} className={ic} dir="ltr" />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                  <textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={2} className={ic} />
                </div>
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
