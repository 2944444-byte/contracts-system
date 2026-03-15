"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editingId, setEditingId] = useState("");
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);

  const [fName,     setFName]     = useState("");
  const [fRegNum,   setFRegNum]   = useState("");
  const [fAddress,  setFAddress]  = useState("");
  const [fCity,     setFCity]     = useState("");
  const [fPhone,    setFPhone]    = useState("");
  const [fEmail,    setFEmail]    = useState("");
  const [fLogoUrl,  setFLogoUrl]  = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const { data } = await supabase.from("companies")
      .select("*, properties(id)")
      .order("company_name");
    setCompanies(data ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFRegNum(""); setFAddress(""); setFCity("");
    setFPhone(""); setFEmail(""); setFLogoUrl("");
  }

  function openEdit(c: any) {
    setIsNew(false); setEditingId(c.id);
    setFName(c.company_name ?? ""); setFRegNum(c.company_registration_number ?? "");
    setFAddress(c.address ?? ""); setFCity(c.city ?? "");
    setFPhone(c.phone ?? ""); setFEmail(c.email ?? ""); setFLogoUrl(c.logo_url ?? "");
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם חברה"); return; }
    setSaving(true);
    try {
      const payload = {
        company_name: fName.trim(), company_registration_number: fRegNum || null,
        address: fAddress || null, city: fCity || null,
        phone: fPhone || null, email: fEmail || null, logo_url: fLogoUrl || null,
      };
      if (isNew) {
        const { data } = await supabase.from("companies").insert(payload).select().single();
        await logAudit({ entity_type: "company", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("companies").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "company", entity_id: editingId, action: "update" });
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm("למחוק חברה \"" + name + "\"?")) return;
    await supabase.from("companies").delete().eq("id", id);
    await loadAll();
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חברות</h1>
          <p className="text-sm text-slate-500 mt-1">{companies.length} חברות במערכת</p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
          + חברה חדשה
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : companies.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🏛️</div>
          <div>אין חברות — הוסף חברה ראשונה</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף חברה</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {companies.map(function(c) {
            const propCount = c.properties?.length ?? 0;
            return (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt="" className="w-10 h-10 rounded-lg object-contain border border-slate-200" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-xl">🏛️</div>
                    )}
                    <div>
                      <div className="font-bold text-slate-800">{c.company_name}</div>
                      {c.company_registration_number && (
                        <div className="text-xs text-slate-400">ח.פ: {c.company_registration_number}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={function() { openEdit(c); }}
                      className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">עריכה</button>
                    <button onClick={function() { handleDelete(c.id, c.company_name); }}
                      className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-slate-500">
                  {c.city   && <div>📍 {c.address ? c.address + ", " : ""}{c.city}</div>}
                  {c.phone  && <div>📞 {c.phone}</div>}
                  {c.email  && <div>✉️ {c.email}</div>}
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                    {propCount} נכסים
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "חברה חדשה" : "עריכת חברה"}</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם החברה *</label>
                <input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic} placeholder="שם החברה המשפטי" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">ח.פ / עוסק מורשה</label>
                <input type="text" value={fRegNum} onChange={function(e){setFRegNum(e.target.value);}} className={ic} placeholder="000000000" />
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון</label>
                  <input type="tel" value={fPhone} onChange={function(e){setFPhone(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל</label>
                  <input type="email" value={fEmail} onChange={function(e){setFEmail(e.target.value);}} className={ic} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">URL לוגו</label>
                <input type="url" value={fLogoUrl} onChange={function(e){setFLogoUrl(e.target.value);}} className={ic} placeholder="https://..." />
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
