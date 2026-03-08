"use client";
import { useState } from "react";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
const ROLES = ["מנהל", "חשבונאי", "עו\"ד", "איש קשר ראשי", "טכני", "אחר"];

interface Props { tenant?: any; onSubmit: (data: any) => void; onCancel: () => void; }

export default function TenantForm({ tenant, onSubmit, onCancel }: Props) {
  const [tab, setTab] = useState<"main"|"contacts">("main");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    legal_name: tenant?.legal_name ?? tenant?.name ?? "",
    id_number: tenant?.id_number ?? tenant?.id_number ?? "",
    primary_email: tenant?.primary_email ?? tenant?.contact_email ?? "",
    phone: tenant?.phone ?? tenant?.contact_phone ?? "",
    address: tenant?.address ?? "",
    notes: tenant?.notes ?? "",
  });
  const [contacts, setContacts] = useState<any[]>(
    tenant?.contacts?.length ? tenant.contacts : []
  );

  function set(f: string, v: any) { setForm(p => ({ ...p, [f]: v })); }
  function addContact() { setContacts(p => [...p, { name: "", role: "", email: "", phone: "" }]); }
  function removeContact(i: number) { setContacts(p => p.filter((_,j) => j !== i)); }
  function setContact(i: number, f: string, v: string) {
    setContacts(p => p.map((c,j) => j === i ? { ...c, [f]: v } : c));
  }

  async function handleSubmit() {
    if (!form.legal_name.trim()) { alert("שם חובה"); return; }
    setSaving(true);
    await onSubmit({ ...form, contacts: contacts.filter(c => c.name.trim()) });
    setSaving(false);
  }

  return (
    <div dir="rtl" className="space-y-5">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {([["main","פרטי שוכר 👤"],["contacts",`אנשי קשר 📋${contacts.length > 0 ? ` (${contacts.length})` : ""}`]] as const).map(([t,l]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-2 text-sm font-bold transition-colors ${tab === t ? "bg-white shadow text-slate-800" : "text-slate-500"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "main" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">שם משפטי / שם חברה *</label>
            <input value={form.legal_name} onChange={e => set("legal_name", e.target.value)} placeholder="חברת ABC בע&quot;מ" className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">ת.ז / ח.פ</label>
            <input value={form.id_number} onChange={e => set("id_number", e.target.value)} placeholder="123456789" className={ic} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון</label>
            <input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="050-1234567" className={ic} />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל ראשי</label>
            <input type="email" value={form.primary_email} onChange={e => set("primary_email", e.target.value)} placeholder="info@company.co.il" className={ic} />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
            <input value={form.address} onChange={e => set("address", e.target.value)} placeholder="כתובת המשרד הרשום" className={ic} />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
              rows={2} placeholder="הערות..." className={ic + " resize-none"} />
          </div>
        </div>
      )}

      {tab === "contacts" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">אנשי קשר נוספים (ממונה, חשבונאי, עו&quot;ד וכו&apos;)</p>
            <button type="button" onClick={addContact}
              className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-800">
              ＋ הוסף
            </button>
          </div>
          {contacts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
              <div className="text-3xl mb-2">👥</div>
              <p className="text-slate-500 text-sm">אין אנשי קשר — לחץ להוספה</p>
            </div>
          ) : contacts.map((c, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-700">איש קשר {i+1}</span>
                <button type="button" onClick={() => removeContact(i)} className="text-xs text-red-500 hover:text-red-700">🗑 הסר</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">שם</label>
                  <input value={c.name} onChange={e => setContact(i,"name",e.target.value)} placeholder="ישראל ישראלי" className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">תפקיד</label>
                  <select value={c.role} onChange={e => setContact(i,"role",e.target.value)} className={ic}>
                    <option value="">בחר תפקיד</option>
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">אימייל</label>
                  <input type="email" value={c.email} onChange={e => setContact(i,"email",e.target.value)} placeholder="name@co.il" className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">טלפון</label>
                  <input value={c.phone} onChange={e => setContact(i,"phone",e.target.value)} placeholder="050-0000000" className={ic} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 justify-end border-t pt-4">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {saving ? "שומר..." : tenant ? "💾 עדכן שוכר" : "➕ צור שוכר"}
        </button>
      </div>
    </div>
  );
}
