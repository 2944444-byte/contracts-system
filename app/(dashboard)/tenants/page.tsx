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
  const router = useRouter();
  const [tenants,   setTenants]   = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [selected,  setSelected]  = useState<any>(null);
  const [activeTab, setActiveTab] = useState("info");
  const [editingId, setEditingId] = useState("");
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);

  const [fName,         setFName]         = useState("");
  const [fCompany,      setFCompany]      = useState("");
  const [fIdNum,        setFIdNum]        = useState("");
  const [fContactName,  setFContactName]  = useState("");
  const [fContactPhone, setFContactPhone] = useState("");
  const [fContactEmail, setFContactEmail] = useState("");
  const [fContactRole,  setFContactRole]  = useState("");
  const [fNotes,        setFNotes]        = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const { data } = await supabase.from("tenants")
      .select("*, contracts(id, status, start_date, end_date, rent_per_sqm, charged_area, investment_addition, properties(name), contract_options(status))")
      .order("name");
    setTenants(data ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFCompany(""); setFIdNum(""); setFContactName("");
    setFContactPhone(""); setFContactEmail(""); setFContactRole(""); setFNotes("");
  }

  function openEdit(t: any) {
    setIsNew(false); setEditingId(t.id);
    setFName(t.name ?? ""); setFCompany(t.company_name ?? ""); setFIdNum(t.id_number ?? "");
    setFContactName(t.contact_name ?? ""); setFContactPhone(t.contact_phone ?? "");
    setFContactEmail(t.contact_email ?? ""); setFContactRole(t.contact_role ?? ""); setFNotes(t.notes ?? "");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם שוכר"); return; }
    setSaving(true);
    try {
      const payload = {
        name: fName.trim(), company_name: fCompany || null, id_number: fIdNum || null,
        contact_name: fContactName || null, contact_phone: fContactPhone || null,
        contact_email: fContactEmail || null, contact_role: fContactRole || null, notes: fNotes || null,
      };
      if (isNew) {
        const { data } = await supabase.from("tenants").insert(payload).select().single();
        await logAudit({ entity_type: "tenant", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("tenants").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "tenant", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm("למחוק שוכר \"" + name + "\"?")) return;
    await supabase.from("tenants").delete().eq("id", id);
    if (selected?.id === id) setSelected(null);
    await loadAll();
  }

  const filtered = tenants.filter(function(t) {
    return !search || t.name?.includes(search) || t.company_name?.includes(search) || t.contact_phone?.includes(search);
  });

  function getStats(t: any) {
    const contracts = t.contracts ?? [];
    const active = contracts.filter(function(c: any) { return ["active","expiring","extended"].includes(c.status); });
    const revenue = active.reduce(function(s: number, c: any) {
      return s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
    }, 0);
    return { contractCount: contracts.length, activeCount: active.length, revenue };
  }

  return (
    <div dir="rtl" className="flex gap-5 h-[calc(100vh-120px)]">
      {/* רשימה */}
      <div className="w-72 shrink-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-slate-800">שוכרים</h1>
            <button onClick={openNew}
              className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 font-bold">+ חדש</button>
          </div>
          <input type="text" value={search} onChange={function(e) { setSearch(e.target.value); }}
            placeholder="חיפוש שוכר..." className={ic} />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
          {loading ? (
            <div className="py-8 text-center text-slate-400 text-sm">טוען...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">לא נמצאו שוכרים</div>
          ) : filtered.map(function(t) {
            const s = getStats(t);
            const isSelected = selected?.id === t.id;
            return (
              <div key={t.id} onClick={function() { setSelected(t); setActiveTab("info"); }}
                className={"flex items-center gap-3 px-4 py-3 cursor-pointer " +
                  (isSelected ? "bg-blue-50 border-r-2 border-r-blue-600" : "hover:bg-slate-50")}>
                <div className={"w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 " +
                  (isSelected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600")}>
                  {t.name?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={"font-semibold text-sm truncate " + (isSelected ? "text-blue-800" : "text-slate-800")}>{t.name}</div>
                  <div className="text-xs text-slate-400 truncate">{t.company_name ?? t.contact_phone ?? "—"}</div>
                </div>
                {s.activeCount > 0 && (
                  <div className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                    {s.activeCount}
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
          {/* header */}
          <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-100 z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-xl font-bold text-blue-700">
                  {selected.name?.[0]}
                </div>
                <div>
                  <div className="font-bold text-slate-800 text-lg">{selected.name}</div>
                  <div className="text-xs text-slate-400">{selected.company_name ?? selected.contact_email ?? "—"}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={function() { openEdit(selected); }}
                  className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">✏️ עריכה</button>
                <button onClick={function() { handleDelete(selected.id, selected.name); }}
                  className="rounded-lg border border-red-100 px-3 py-2 text-xs text-red-500 hover:bg-red-50">🗑</button>
              </div>
            </div>
            {/* KPI */}
            {(() => {
              const s = getStats(selected);
              return (
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="rounded-xl bg-slate-50 p-3 text-center">
                    <div className="text-xl font-black text-slate-800">{s.activeCount}</div>
                    <div className="text-xs text-slate-400">חוזים פעילים</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 text-center">
                    <div className="text-xl font-black text-slate-800">{s.contractCount}</div>
                    <div className="text-xs text-slate-400">סה"כ חוזים</div>
                  </div>
                  <div className="rounded-xl bg-green-50 p-3 text-center">
                    <div className="text-xl font-black text-green-700">₪{Math.round(s.revenue).toLocaleString()}</div>
                    <div className="text-xs text-slate-400">הכנסה/חודש</div>
                  </div>
                </div>
              );
            })()}
            {/* טאבים */}
            <div className="flex gap-1 mt-3">
              {[
                { id: "info",      label: "פרטים"   },
                { id: "contracts", label: "חוזים"   },
              ].map(function(t) {
                return (
                  <button key={t.id} onClick={function() { setActiveTab(t.id); }}
                    className={"rounded-lg px-3 py-1.5 text-xs font-semibold transition-all " +
                      (activeTab === t.id ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-100")}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-6">
            {/* פרטים */}
            {activeTab === "info" && (
              <div className="space-y-3 max-w-md">
                {[
                  { label: "ח.פ / ת.ז",    value: selected.id_number     },
                  { label: "איש קשר",       value: selected.contact_name  },
                  { label: "תפקיד",         value: selected.contact_role  },
                  { label: "טלפון",         value: selected.contact_phone },
                  { label: "אימייל",        value: selected.contact_email },
                ].map(function(row) {
                  if (!row.value) return null;
                  return (
                    <div key={row.label} className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-xs text-slate-500">{row.label}</span>
                      <span className="text-sm font-medium text-slate-800">{row.value}</span>
                    </div>
                  );
                })}
                {selected.notes && (
                  <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 mt-2">{selected.notes}</div>
                )}
              </div>
            )}

            {/* חוזים */}
            {activeTab === "contracts" && (
              <div className="space-y-3">
                {(selected.contracts ?? []).length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <div className="text-4xl mb-2">📄</div>
                    <div className="text-sm">אין חוזים</div>
                    <button onClick={function() { router.push("/contracts/new"); }}
                      className="mt-2 text-blue-600 hover:underline text-xs">+ חוזה חדש</button>
                  </div>
                ) : (
                  (selected.contracts ?? []).map(function(c: any) {
                    const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                    const isActive = ["active","expiring","extended"].includes(c.status);
                    return (
                      <div key={c.id}
                        onClick={function() { router.push("/contracts"); }}
                        className={"rounded-xl border p-4 cursor-pointer transition-colors " +
                          (isActive ? "border-green-200 bg-green-50 hover:bg-green-100" : "border-slate-200 bg-slate-50 hover:bg-slate-100")}>
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-semibold text-slate-800">{c.properties?.name}</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {fmtDate(c.start_date)} — {fmtDate(c.end_date)}
                            </div>
                          </div>
                          <div className="text-left">
                            {monthly > 0 && (
                              <div className="font-bold text-green-700 text-sm">₪{Math.round(monthly).toLocaleString()}</div>
                            )}
                            <span className={"text-xs px-2 py-0.5 rounded-full " +
                              (c.status === "expiring" ? "bg-yellow-100 text-yellow-700" :
                                c.status === "extended" ? "bg-blue-100 text-blue-700" :
                                isActive ? "bg-green-100 text-green-700" :
                                "bg-slate-100 text-slate-500")}>
                              {c.status === "active" ? "פעיל" : c.status === "expiring" ? "פוגה" :
                                c.status === "extended" ? "מורחב" : c.status === "ended" ? "הסתיים" : c.status}
                            </span>
                          </div>
                        </div>
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
            <div className="text-5xl mb-3">👤</div>
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
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שם השוכר *</label>
                  <input type="text" value={fName} onChange={function(e) { setFName(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שם חברה</label>
                  <input type="text" value={fCompany} onChange={function(e) { setFCompany(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">ח.פ / ת.ז</label>
                  <input type="text" value={fIdNum} onChange={function(e) { setFIdNum(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">איש קשר</label>
                  <input type="text" value={fContactName} onChange={function(e) { setFContactName(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תפקיד</label>
                  <input type="text" value={fContactRole} onChange={function(e) { setFContactRole(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון</label>
                  <input type="tel" value={fContactPhone} onChange={function(e) { setFContactPhone(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל</label>
                  <input type="email" value={fContactEmail} onChange={function(e) { setFContactEmail(e.target.value); }} className={ic} />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                  <textarea value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} rows={2} className={ic} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }}
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
