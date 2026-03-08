
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTenant } from "../../../../lib/db";

export default function NewTenantPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [saving, setSaving] = useState(false);

  const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

  async function handleSave() {
    if (!name) { alert("שם שוכר הוא חובה"); return; }
    setSaving(true);
    try {
      await createTenant({ name, company_name: companyName, contact_name: contactName, contact_phone: contactPhone, contact_email: contactEmail, contact_role: contactRole });
      router.push("/tenants");
    } catch(e) {
      alert("שגיאה: " + e);
      setSaving(false);
    }
  }

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-700 text-2xl">&larr;</button>
        <h1 className="text-2xl font-bold text-slate-800">שוכר חדש</h1>
      </div>
      <div className="space-y-5">

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">פרטי שוכר</h2>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">שם שוכר / חברה *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="שם מלא או שם חברה" className={ic} />
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">שם חברה (אם שונה)</label>
            <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="שם חברה" className={ic} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-500">איש קשר ראשי</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">שם מלא</label>
              <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">תפקיד</label>
              <input type="text" value={contactRole} onChange={e => setContactRole(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">טלפון</label>
              <input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">אימייל</label>
              <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className={ic} />
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={() => router.back()} className="flex-1 rounded-lg border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50">ביטול</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {saving ? "שומר..." : "שמור שוכר"}
          </button>
        </div>
      </div>
    </div>
  );
}
