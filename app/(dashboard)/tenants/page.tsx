"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function TenantsPage() {
  const router = useRouter();
  const [tenants,   setTenants]   = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [selected,  setSelected]  = useState<any>(null);
  const [selContracts, setSelContracts] = useState<any[]>([]);
  const [editingId, setEditingId] = useState("");
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [tab,       setTab]       = useState("details");

  const [fName,    setFName]    = useState("");
  const [fCompNum, setFCompNum] = useState("");
  const [fAddress, setFAddress] = useState("");
  const [fNotes,   setFNotes]   = useState("");
  const [fContacts, setFContacts] = useState<{name:string;role:string;phone:string;email:string}[]>([
    { name:"", role:"", phone:"", email:"" }
  ]);

  useEffect(function() { load(); }, []);

  async function load() {
    const { data } = await supabase.from("tenants")
      .select("*, contracts(id, status, end_date, properties(name), rent_per_sqm, charged_area, investment_addition)")
      .order("name");
    setTenants(data ?? []);
    setLoading(false);
  }

  async function selectTenant(t: any) {
    setSelected(t);
    setTab("details");
    const { data } = await supabase.from("contracts")
      .select("*, properties(name), contract_options(*)")
      .eq("tenant_id", t.id)
      .order("start_date", { ascending: false });
    setSelContracts(data ?? []);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFCompNum(""); setFAddress(""); setFNotes("");
    setFContacts([{ name:"", role:"", phone:"", email:"" }]);
  }

  function openEdit(t: any) {
    setIsNew(false); setEditingId(t.id);
    setFName(t.name ?? ""); setFCompNum(t.company_number ?? "");
    setFAddress(t.address ?? ""); setFNotes(t.notes ?? "");
    const c = Array.isArray(t.contacts) && t.contacts.length > 0
      ? t.contacts
      : [{ name: t.contact_name ?? "", role: t.contact_role ?? "", phone: t.contact_phone ?? "", email: t.contact_email ?? "" }];
    setFContacts(c);
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם שוכר"); return; }
    setSaving(true);
    try {
      const payload = {
        name:           fName.trim(),
        company_number: fCompNum || null,
        address:        fAddress || null,
        notes:          fNotes || null,
        contacts:       fContacts.filter(function(c) { return c.name || c.email || c.phone; }),
        contact_name:   fContacts[0]?.name || null,
        contact_phone:  fContacts[0]?.phone || null,
        contact_email:  fContacts[0]?.email || null,
        contact_role:   fContacts[0]?.role || null,
      };
      if (isNew) {
        const { data } = await supabase.from("tenants").insert(payload).select().single();
        await logAudit({ entity_type: "tenant", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("tenants").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "tenant", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await load();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm("למחוק שוכר \"" + name + "\"?")) return;
    await supabase.from("tenants").delete().eq("id", id);
    if (selected?.id === id) setSelected(null);
    await load();
  }

  function fmtDate(d: string) {
    if (!d) return "—";
    const [y,m,day] = d.split("-");
    return `${day}/${m}/${y}`;
  }
  function daysLeft(d: string) {
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  }

  const filtered = tenants.filter(function(t) {
    return !search || t.name?.includes(search) ||
      t.contact_phone?.includes(search) || t.contact_email?.includes(search);
  });

  const totalRevenue = (selected?.contracts ?? []).reduce(function(s: number, c: any) {
    return s + ((c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0));
  }, 0);

  return (
    <div dir="rtl" className="flex gap-5 h-[calc(100vh-120px)]">
      {/* רשימת שוכרים */}
      <div className="w-80 shrink-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-slate-800">שוכרים</h1>
            <button onClick={openNew}
              className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 font-bold">
              + חדש
            </button>
          </div>
          <input type="text" value={search} onChange={function(e) { setSearch(e.target.value); }}
            placeholder="חיפוש שוכר..." className={ic} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-slate-400 text-sm">טוען...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">לא נמצאו שוכרים</div>
          ) : (
            filtered.map(function(t) {
              const activeContracts = (t.contracts ?? []).filter(function(c: any) {
                return ["active","expiring","extended"].includes(c.status);
              });
              const isSelected = selected?.id === t.id;
              return (
                <div key={t.id}
                  onClick={function() { selectTenant(t); }}
                  className={"flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-slate-50 transition-colors " +
                    (isSelected ? "bg-blue-50 border-r-2 border-r-blue-600" : "hover:bg-slate-50")}>
                  <div className={"w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 " +
                    (isSelected ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600")}>
                    {t.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={"font-semibold text-sm truncate " + (isSelected ? "text-blue-800" : "text-slate-800")}>
                      {t.name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {activeContracts.length > 0
                        ? activeContracts.length + " חוזים פעילים"
                        : "אין חוזים פעילים"}
                    </div>
                  </div>
                  {activeContracts.length > 0 && (
                    <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* פירוט שוכר */}
      {selected ? (
        <div className="flex-1 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
          {/* כותרת */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white text-lg font-black">
                {selected.name?.[0]?.toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-slate-800 text-lg">{selected.name}</div>
                {selected.company_number && (
                  <div className="text-xs text-slate-400">ח.פ: {selected.company_number}</div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={function() { openEdit(selected); }}
                className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">
                ✏️ עריכה
              </button>
              <button onClick={function() { router.push("/contracts/new"); }}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">
                + חוזה חדש
              </button>
              <button onClick={function() { handleDelete(selected.id, selected.name); }}
                className="rounded-lg border border-red-100 px-3 py-2 text-sm text-red-500 hover:bg-red-50">
                🗑
              </button>
            </div>
          </div>

          {/* KPI */}
          {totalRevenue > 0 && (
            <div className="px-6 py-3 border-b border-slate-100 flex gap-6 bg-slate-50">
              <div>
                <div className="text-xs text-slate-500">הכנסה חודשית</div>
                <div className="font-bold text-green-700">₪{Math.round(totalRevenue).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">חוזים</div>
                <div className="font-bold text-slate-800">{selContracts.length}</div>
              </div>
            </div>
          )}

          {/* טאבים */}
          <div className="flex border-b border-slate-100 px-6">
            {[
              { key: "details",   label: "פרטים" },
              { key: "contacts",  label: "אנשי קשר" },
              { key: "contracts", label: "חוזים (" + selContracts.length + ")" },
            ].map(function(t) {
              return (
                <button key={t.key} onClick={function() { setTab(t.key); }}
                  className={"px-4 py-3 text-sm font-semibold border-b-2 transition-colors " +
                    (tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* תוכן */}
          <div className="flex-1 overflow-y-auto p-6">
            {tab === "details" && (
              <div className="space-y-4">
                {[
                  { label: "שם מלא", value: selected.name },
                  { label: "ח.פ / ע.מ", value: selected.company_number },
                  { label: "כתובת", value: selected.address },
                  { label: "טלפון ראשי", value: selected.contact_phone },
                  { label: "אימייל ראשי", value: selected.contact_email },
                ].map(function(row) {
                  if (!row.value) return null;
                  return (
                    <div key={row.label} className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-sm text-slate-500">{row.label}</span>
                      <span className="font-medium text-slate-800">
                        {row.label === "אימייל ראשי"
                          ? <a href={"mailto:" + row.value} className="text-blue-600 hover:underline">{row.value}</a>
                          : row.label === "טלפון ראשי"
                            ? <a href={"tel:" + row.value} className="text-blue-600 hover:underline">{row.value}</a>
                            : row.value}
                      </span>
                    </div>
                  );
                })}
                {selected.notes && (
                  <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{selected.notes}</div>
                )}
              </div>
            )}

            {tab === "contacts" && (
              <div className="space-y-3">
                {(Array.isArray(selected.contacts) && selected.contacts.length > 0
                  ? selected.contacts
                  : [{ name: selected.contact_name, role: selected.contact_role, phone: selected.contact_phone, email: selected.contact_email }]
                ).filter(function(c: any) { return c.name || c.email || c.phone; }).map(function(c: any, i: number) {
                  return (
                    <div key={i} className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-full bg-slate-300 flex items-center justify-center text-xs font-bold text-slate-600">
                          {c.name?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800 text-sm">{c.name}</div>
                          {c.role && <div className="text-xs text-slate-400">{c.role}</div>}
                        </div>
                      </div>
                      <div className="space-y-1 text-sm">
                        {c.phone && <div><a href={"tel:"+c.phone} className="text-blue-600 hover:underline">📞 {c.phone}</a></div>}
                        {c.email && <div><a href={"mailto:"+c.email} className="text-blue-600 hover:underline">✉ {c.email}</a></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "contracts" && (
              <div className="space-y-3">
                {selContracts.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">אין חוזים לשוכר זה</div>
                ) : (
                  selContracts.map(function(c) {
                    const d = c.end_date ? daysLeft(c.end_date) : null;
                    const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                    const statusColors: Record<string,string> = {
                      active: "bg-green-100 text-green-700",
                      expiring: "bg-yellow-100 text-yellow-700",
                      extended: "bg-blue-100 text-blue-700",
                      expired: "bg-red-100 text-red-700",
                      draft: "bg-slate-100 text-slate-500",
                    };
                    return (
                      <div key={c.id}
                        onClick={function() { router.push("/contracts"); }}
                        className="rounded-xl border border-slate-200 p-4 hover:bg-blue-50 cursor-pointer transition-colors">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="font-semibold text-slate-800">{c.properties?.name}</div>
                            <div className="text-xs text-slate-400">
                              {fmtDate(c.start_date)} — {fmtDate(c.end_date)}
                            </div>
                          </div>
                          <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + (statusColors[c.status] ?? "bg-slate-100 text-slate-500")}>
                            {c.status === "active" ? "פעיל" : c.status === "expiring" ? "פג בקרוב" : c.status === "extended" ? "הוארך" : c.status}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-green-700 text-sm">₪{Math.round(monthly).toLocaleString()}/חודש</span>
                          {d !== null && d <= 90 && (
                            <span className={"text-xs font-semibold " + (d <= 30 ? "text-red-600" : "text-yellow-600")}>
                              {d} ימים לסיום
                            </span>
                          )}
                        </div>
                        {c.contract_options?.length > 0 && (
                          <div className="mt-2 text-xs text-slate-400">
                            {c.contract_options.length} אופציות | {c.contract_options.filter(function(o: any) { return o.status === "exercised"; }).length} מומשו
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 rounded-xl border-2 border-dashed border-slate-200 bg-white flex items-center justify-center">
          <div className="text-center text-slate-400">
            <div className="text-5xl mb-3">👥</div>
            <div className="font-medium">בחר שוכר מהרשימה</div>
            <div className="text-sm mt-1">או <button onClick={openNew} className="text-blue-600 hover:underline">הוסף שוכר חדש</button></div>
          </div>
        </div>
      )}

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "שוכר חדש" : "עריכת שוכר"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם שוכר / חברה *</label>
                <input type="text" value={fName} onChange={function(e) { setFName(e.target.value); }} className={ic} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">ח.פ / ע.מ</label>
                  <input type="text" value={fCompNum} onChange={function(e) { setFCompNum(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
                  <input type="text" value={fAddress} onChange={function(e) { setFAddress(e.target.value); }} className={ic} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-700">אנשי קשר</label>
                  <button onClick={function() { setFContacts(function(p) { return [...p, {name:"",role:"",phone:"",email:""}]; }); }}
                    className="text-xs text-blue-600 hover:underline">+ הוסף</button>
                </div>
                {fContacts.map(function(c, i) {
                  return (
                    <div key={i} className="rounded-xl bg-slate-50 p-3 mb-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500">איש קשר {i+1}</span>
                        {fContacts.length > 1 && (
                          <button onClick={function() { setFContacts(function(p) { return p.filter(function(_,j) { return j !== i; }); }); }}
                            className="text-xs text-red-400">הסר</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" value={c.name} onChange={function(e) { setFContacts(function(p) { const n=[...p]; n[i]={...n[i],name:e.target.value}; return n; }); }}
                          placeholder="שם" className={ic} />
                        <input type="text" value={c.role} onChange={function(e) { setFContacts(function(p) { const n=[...p]; n[i]={...n[i],role:e.target.value}; return n; }); }}
                          placeholder="תפקיד" className={ic} />
                        <input type="tel" value={c.phone} onChange={function(e) { setFContacts(function(p) { const n=[...p]; n[i]={...n[i],phone:e.target.value}; return n; }); }}
                          placeholder="טלפון" className={ic} />
                        <input type="email" value={c.email} onChange={function(e) { setFContacts(function(p) { const n=[...p]; n[i]={...n[i],email:e.target.value}; return n; }); }}
                          placeholder="אימייל" className={ic} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={function(e) { setFNotes(e.target.value); }}
                  rows={3} className={ic} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600">ביטול</button>
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
