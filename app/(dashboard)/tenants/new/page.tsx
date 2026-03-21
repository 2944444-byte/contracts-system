"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function NewTenantPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");

  const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

  async function handleSave() {
    if (!name.trim()) { alert("שם שוכר הוא חובה"); return; }
    setSaving(true);
    try {
      await supabase.from("tenants").insert({
        name: name.trim(),
        company_name: companyName || null,
        id_number: idNumber || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        city: city || null,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        notes: notes || null,
      });
      router.push("/tenants");
    } catch(e: any) {
      alert("שגיאה: " + e.message);
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
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">שם שוכר / חברה *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="שם מלא או שם חברה" className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">שם חברה</label>
              <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">ח.פ / ת.ז</label>
              <input type="text" value={idNumber} onChange={e => setIdNumber(e.target.value)} className={ic} dir="ltr" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">טלפון</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={ic} dir="ltr" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">אימייל</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={ic} dir="ltr" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">כתובת</label>
              <input type="text" value={address} onChange={e => setAddress(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">עיר</label>
              <input type="text" value={city} onChange={e => setCity(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">איש קשר</label>
              <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">טלפון איש קשר</label>
              <input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} className={ic} dir="ltr" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">הערות</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={ic} />
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={() => router.back()} className="rounded-lg border border-slate-300 px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
          <button onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {saving ? "שומר..." : "➕ צור שוכר"}
          </button>
        </div>
      </div>
    </div>
  );
}
