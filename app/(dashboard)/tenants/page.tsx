"use client";
import { useEffect, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function formatDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default function TenantsPage() {
  const router = useRouter();
  const [tenants, setTenants]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // מודל עריכת שוכר
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [editName, setEditName]         = useState("");
  const [editCompanyNum, setEditCompanyNum] = useState("");
  const [editAddress, setEditAddress]   = useState("");
  const [editPhone, setEditPhone]       = useState("");
  const [editEmail, setEditEmail]       = useState("");
  const [editContacts, setEditContacts] = useState<any[]>([]);
  const [editNotes, setEditNotes]       = useState("");
  const [saving, setSaving]             = useState(false);

  async function load() {
    const { data } = await supabase
      .from("tenants")
      .select(`
        *,
        contracts(id, status, start_date, end_date, rent_per_sqm, charged_area,
          investment_addition, properties(name))
      `)
      .order("name");
    setTenants(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = tenants.filter(t =>
    !search ||
    t.name?.includes(search) ||
    t.company_number?.includes(search) ||
    t.contact_phone?.includes(search)
  );

  function openEdit(t: any) {
    setEditingId(t.id);
    setEditName(t.name ?? "");
    setEditCompanyNum(t.company_number ?? "");
    setEditAddress(t.address ?? "");
    setEditPhone(t.contact_phone ?? "");
    setEditEmail(t.contact_email ?? "");
    setEditNotes(t.notes ?? "");
    // contacts — JSONB או fallback מהשדות הישנים
    const contacts = Array.isArray(t.contacts) && t.contacts.length > 0
      ? t.contacts
      : (t.contact_phone || t.contact_email)
        ? [{ name: "", role: "", phone: t.contact_phone ?? "", email: t.contact_email ?? "" }]
        : [{ name: "", role: "", phone: "", email: "" }];
    setEditContacts(contacts);
  }

  function addContact() {
    setEditContacts(p => [...p, { name: "", role: "", phone: "", email: "" }]);
  }
  function removeContact(i: number) {
    setEditContacts(p => p.filter((_, idx) => idx !== i));
  }
  function updateContact(i: number, field: string, val: string) {
    setEditContacts(p => p.map((c, idx) => idx === i ? { ...c, [field]: val } : c));
  }

  async function handleSave() {
    if (!editName.trim()) { alert("חובה: שם שוכר"); return; }
    setSaving(true);
    try {
      const cleanContacts = editContacts.filter(c => c.name || c.phone || c.email);
      const { error } = await supabase.from("tenants").update({
        name:           editName.trim(),
        company_number: editCompanyNum || null,
        address:        editAddress || null,
        contact_phone:  editContacts[0]?.phone || null,
        contact_email:  editContacts[0]?.email || null,
        contacts:       cleanContacts,
        notes:          editNotes || null,
      }).eq("id", editingId);
      if (error) throw error;
      setEditingId(null);
      await load();
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`למחוק את השוכר "${name}"?\n⚠️ לא ניתן למחוק שוכר עם חוזים פעילים.`)) return;
    const { error } = await supabase.from("tenants").delete().eq("id", id);
    if (error) { alert("שגיאה: " + error.message); return; }
    await load();
  }

  async function handleNew() {
    const name = prompt("שם השוכר / חברה:");
    if (!name?.trim()) return;
    const { error } = await supabase.from("tenants").insert({ name: name.trim() });
    if (error) { alert("שגיאה: " + error.message); return; }
    await load();
  }

  const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">שוכרים</h1>
          <p className="text-sm text-slate-500 mt-1">{tenants.length} שוכרים במערכת</p>
        </div>
        <button onClick={handleNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + שוכר חדש
        </button>
      </div>

      {/* חיפוש */}
      <div className="mb-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 חיפוש לפי שם, ח.פ או טלפון..."
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-3 py-3 w-6"></th>
                <th className="px-4 py-3 font-semibold">שם שוכר</th>
                <th className="px-4 py-3 font-semibold">ח.פ / ע.מ</th>
                <th className="px-4 py-3 font-semibold">טלפון</th>
                <th className="px-4 py-3 font-semibold">אימייל</th>
                <th className="px-4 py-3 font-semibold">חוזים</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">
                  <div className="text-4xl mb-2">👥</div>
                  <div>{search ? "לא נמצאו שוכרים" : "אין שוכרים עדיין"}</div>
                </td></tr>
              ) : filtered.map(t => {
                const activeContracts = (t.contracts ?? []).filter(
                  (c: any) => c.status === "active" || c.status === "extended"
                );
                const allContracts = t.contracts ?? [];
                const isExpanded = expandedId === t.id;
                const contacts: any[] = Array.isArray(t.contacts) && t.contacts.length > 0
                  ? t.contacts
                  : (t.contact_phone || t.contact_email)
                    ? [{ phone: t.contact_phone, email: t.contact_email }]
                    : [];

                return (
                  <Fragment key={t.id}>
                    <tr onClick={() => setExpandedId(p => p === t.id ? null : t.id)}
                      className={`border-t border-slate-100 cursor-pointer transition-colors ${isExpanded ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                      <td className="px-3 py-3 text-slate-400 text-center text-xs">
                        {isExpanded ? "▲" : "▼"}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{t.name}</td>
                      <td className="px-4 py-3 text-slate-600">{t.company_number ?? "—"}</td>
                      <td className="px-4 py-3">
                        {t.contact_phone
                          ? <a href={"tel:"+t.contact_phone} className="text-blue-700 hover:underline">{t.contact_phone}</a>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{t.contact_email ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {activeContracts.length > 0 && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                              {activeContracts.length} פעיל
                            </span>
                          )}
                          {allContracts.length > activeContracts.length && (
                            <span className="text-xs text-slate-400">
                              +{allContracts.length - activeContracts.length} היסטוריה
                            </span>
                          )}
                          {allContracts.length === 0 && <span className="text-slate-300 text-xs">אין</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(t)}
                            className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50 font-medium">עריכה</button>
                          <button onClick={() => handleDelete(t.id, t.name)}
                            className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">מחיקה</button>
                        </div>
                      </td>
                    </tr>

                    {/* פאנל פרטים */}
                    {isExpanded && (
                      <tr key={t.id+"-details"}>
                        <td colSpan={7} className="p-0 border-t border-blue-100">
                          <div className="bg-blue-50 px-6 py-5">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

                              {/* אנשי קשר */}
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">👤 אנשי קשר</div>
                                {contacts.length === 0 ? (
                                  <div className="text-slate-400 text-xs">לא הוזנו אנשי קשר</div>
                                ) : contacts.map((c: any, i: number) => (
                                  <div key={i} className={`py-2 ${i > 0 ? "border-t border-slate-100 mt-2" : ""}`}>
                                    {c.name && <div className="font-semibold text-slate-800 text-sm">{c.name}</div>}
                                    {c.role && <div className="text-xs text-slate-400 mb-1">{c.role}</div>}
                                    {c.phone && (
                                      <a href={"tel:"+c.phone} className="block text-blue-700 text-sm hover:underline">📞 {c.phone}</a>
                                    )}
                                    {c.email && (
                                      <a href={"mailto:"+c.email} className="block text-blue-700 text-xs hover:underline">✉️ {c.email}</a>
                                    )}
                                  </div>
                                ))}
                                {t.address && (
                                  <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
                                    📍 {t.address}
                                  </div>
                                )}
                              </div>

                              {/* חוזים פעילים */}
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">📄 חוזים פעילים</div>
                                {activeContracts.length === 0 ? (
                                  <div className="text-slate-400 text-xs">אין חוזים פעילים</div>
                                ) : activeContracts.map((c: any) => {
                                  const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                                  return (
                                    <div key={c.id} className="py-2 border-b border-slate-100 last:border-0">
                                      <div className="font-medium text-slate-800 text-sm">{c.properties?.name}</div>
                                      <div className="text-xs text-slate-500">{formatDate(c.start_date)} — {formatDate(c.end_date)}</div>
                                      {monthly > 0 && <div className="text-xs font-semibold text-green-700 mt-0.5">₪{monthly.toLocaleString()}/חודש</div>}
                                    </div>
                                  );
                                })}
                              </div>

                              {/* היסטוריה + פעולות */}
                              <div className="space-y-4">
                                {allContracts.length > activeContracts.length && (
                                  <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                    <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">📋 היסטוריית חוזים</div>
                                    {allContracts.filter((c: any) => c.status !== "active" && c.status !== "extended").map((c: any) => (
                                      <div key={c.id} className="py-1.5 border-b border-slate-100 last:border-0 text-xs text-slate-500">
                                        <span className="font-medium text-slate-600">{c.properties?.name}</span>
                                        <span className="mr-2">{formatDate(c.start_date)} — {formatDate(c.end_date)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-2">
                                  <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">⚡ פעולות</div>
                                  <button onClick={() => openEdit(t)}
                                    className="w-full rounded-lg border border-blue-200 py-2 text-sm text-blue-800 hover:bg-blue-50 font-semibold">✏️ עריכת פרטים</button>
                                  <button onClick={() => router.push(`/contracts/new?tenant=${t.id}`)}
                                    className="w-full rounded-lg border border-green-200 py-2 text-sm text-green-700 hover:bg-green-50 font-semibold">+ חוזה חדש</button>
                                </div>
                                {t.notes && (
                                  <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 text-xs">
                                    <span className="font-bold text-yellow-700">📝 </span>{t.notes}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* מודל עריכה */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">עריכת שוכר</h2>
              <button onClick={() => setEditingId(null)} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם שוכר / חברה *</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className={ic} placeholder="שם מלא" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">ח.פ / ע.מ</label>
                  <input type="text" value={editCompanyNum} onChange={e => setEditCompanyNum(e.target.value)} className={ic} placeholder="515123456" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
                  <input type="text" value={editAddress} onChange={e => setEditAddress(e.target.value)} className={ic} placeholder="רחוב, עיר" />
                </div>
              </div>

              {/* אנשי קשר */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-700">אנשי קשר</label>
                  <button onClick={addContact} className="text-xs text-blue-600 hover:underline">+ הוסף איש קשר</button>
                </div>
                <div className="space-y-3">
                  {editContacts.map((c, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-500">איש קשר {i+1}</span>
                        {editContacts.length > 1 && (
                          <button onClick={() => removeContact(i)} className="text-xs text-red-400 hover:text-red-600">הסר</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <input type="text" value={c.name} onChange={e => updateContact(i, "name", e.target.value)}
                          placeholder="שם" className={ic} />
                        <input type="text" value={c.role} onChange={e => updateContact(i, "role", e.target.value)}
                          placeholder="תפקיד" className={ic} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="tel" value={c.phone} onChange={e => updateContact(i, "phone", e.target.value)}
                          placeholder="טלפון" className={ic} />
                        <input type="email" value={c.email} onChange={e => updateContact(i, "email", e.target.value)}
                          placeholder="אימייל" className={ic} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                  rows={2} className={ic + " resize-none"} placeholder="הערות..." />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingId(null)}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
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
