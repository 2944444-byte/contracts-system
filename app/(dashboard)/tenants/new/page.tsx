"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
      const { error } = await supabase.from("tenants").insert({
        name,
        legal_name: name,
        company_name: companyName || null,
        phone: contactPhone || null,
        primary_email: contactEmail || null,
        contacts: contactName ? [{ name: contactName, phone: contactPhone, email: contactEmail, role: contactRole }] : [],
      });
      if (error) throw error;
      router.push("/tenants");
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
      setSaving(false);
    }
  }

  return (
    <div dir="rtl" className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-700 text-2xl">←</button>
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
              <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="ישראל ישראלי" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">תפקיד</label>
              <input type="text" value={contactRole} onChange={e => setContactRole(e.target.value)} placeholder="מנכ"ל" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">טלפון</label>
              <input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="050-0000000" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">אימייל</label>
              <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="name@co.il" className={ic} />
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={() => router.back()} className="rounded-lg border border-slate-300 px-5 py-2 text-sm text-slate-600">ביטול</button>
          <button onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {saving ? "שומר..." : "צור שוכר"}
          </button>
        </div>
      </div>
    </div>
  );
}
