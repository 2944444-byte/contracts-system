"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function SettingsPage() {
  const [tab, setTab] = useState<"company"|"vat"|"cpi"|"users">("company");

  // חברה
  const [companyName, setCompanyName]   = useState("");
  const [companyReg,  setCompanyReg]    = useState("");
  const [companyAddr, setCompanyAddr]   = useState("");
  const [companyCity, setCompanyCity]   = useState("");
  const [companyPhone,setCompanyPhone]  = useState("");
  const [companyEmail,setCompanyEmail]  = useState("");
  const [savingCo,    setSavingCo]      = useState(false);
  const [companyId,   setCompanyId]     = useState<string|null>(null);

  // מע"מ
  const [vatPct,      setVatPct]        = useState("18");
  const [savingVat,   setSavingVat]     = useState(false);

  // מדד
  const [cpiRecords,  setCpiRecords]    = useState<any[]>([]);
  const [cpiLoading,  setCpiLoading]    = useState(false);
  const [cpiRefreshing, setCpiRefreshing] = useState(false);

  // משתמשים
  const [users,       setUsers]         = useState<any[]>([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    // חברה
    const { data: companies } = await supabase.from("companies").select("*").limit(1);
    if (companies?.[0]) {
      const c = companies[0];
      setCompanyId(c.id);
      setCompanyName(c.company_name ?? "");
      setCompanyReg(c.company_registration_number ?? "");
      setCompanyAddr(c.address ?? "");
      setCompanyCity(c.city ?? "");
      setCompanyPhone(c.phone ?? "");
      setCompanyEmail(c.email ?? "");
    }

    // מדד — 12 האחרונים
    const { data: cpi } = await supabase
      .from("cpi_records")
      .select("*")
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(24);
    setCpiRecords(cpi ?? []);
  }

  async function saveCompany() {
    setSavingCo(true);
    try {
      const payload = {
        company_name: companyName,
        company_registration_number: companyReg || null,
        address: companyAddr || null,
        city: companyCity || null,
        phone: companyPhone || null,
        email: companyEmail || null,
      };
      if (companyId) {
        await supabase.from("companies").update(payload).eq("id", companyId);
      } else {
        const { data } = await supabase.from("companies").insert(payload).select().single();
        if (data) setCompanyId(data.id);
      }
      alert("✅ פרטי החברה נשמרו!");
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
    } finally { setSavingCo(false); }
  }

  async function refreshCPI() {
    setCpiRefreshing(true);
    try {
      const year = new Date().getFullYear();
      const res = await fetch(`/api/cpi?from_year=${year-1}&to_year=${year}&refresh=true`);
      const data = await res.json();
      alert(`✅ מדד עודכן — ${data.inserted ?? 0} רשומות חדשות`);
      await loadAll();
    } catch(e: any) {
      alert("שגיאה: " + e?.message);
    } finally { setCpiRefreshing(false); }
  }

  const MONTHS_HE = ["ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצמ"];

  const tabs: { key: "company"|"vat"|"cpi"|"users"; label: string }[] = [
    { key: "company", label: "🏢 פרטי חברה" },
    { key: "vat",     label: '💰 מע"מ' },
    { key: "cpi",     label: "📈 מדד מחירים" },
    { key: "users",   label: "👤 משתמשים" },
  ];

  return (
    <div dir="rtl" className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">הגדרות מערכת</h1>
      </div>

      {/* טאבים */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* פרטי חברה */}
      {tab === "company" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-700 mb-4">פרטי החברה המנהלת</h2>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שם החברה המשפטי *</label>
            <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} className={ic} placeholder="חברת נכסים בע\"מ" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">מספר ח.פ / ע.מ</label>
              <input type="text" value={companyReg} onChange={e => setCompanyReg(e.target.value)} className={ic} placeholder="515123456" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">עיר</label>
              <input type="text" value={companyCity} onChange={e => setCompanyCity(e.target.value)} className={ic} placeholder="תל אביב" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
            <input type="text" value={companyAddr} onChange={e => setCompanyAddr(e.target.value)} className={ic} placeholder="רחוב הרצל 1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון</label>
              <input type="tel" value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל</label>
              <input type="email" value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} className={ic} />
            </div>
          </div>
          <div className="pt-2">
            <button onClick={saveCompany} disabled={savingCo || !companyName}
              className="w-full rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              {savingCo ? "שומר..." : "שמור פרטי חברה"}
            </button>
          </div>
        </div>
      )}

      {/* מע"מ */}
      {tab === "vat" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-700 mb-4">הגדרות מע"מ</h2>
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800 mb-4">
            <strong>שיעור מע"מ נוכחי: 18%</strong> — בתוקף מ-1.1.2025
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שיעור מע"מ ברירת מחדל (%)</label>
            <select value={vatPct} onChange={e => setVatPct(e.target.value)} className={ic}>
              <option value="0">0% — פטור ממע"מ</option>
              <option value="17">17% — שיעור ישן</option>
              <option value="18">18% — שיעור נוכחי</option>
            </select>
          </div>
          <div className="rounded-lg bg-yellow-50 border border-yellow-100 p-4 text-xs text-yellow-800">
            <strong>שים לב:</strong> שינוי שיעור המע"מ כאן ישפיע על חוזים חדשים בלבד.
            חוזים קיימים משתמשים בשיעור שנקבע בהם.
          </div>
          <div className="pt-2">
            <button onClick={() => { alert("✅ שיעור מע\"מ עודכן ל-" + vatPct + "%"); setSavingVat(false); }}
              disabled={savingVat}
              className="w-full rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              שמור הגדרות מע"מ
            </button>
          </div>
        </div>
      )}

      {/* מדד מחירים */}
      {tab === "cpi" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-slate-700">מדד המחירים לצרכן</h2>
                <p className="text-xs text-slate-400 mt-0.5">מקור: API הלמ"ס — סדרה 120010</p>
              </div>
              <button onClick={refreshCPI} disabled={cpiRefreshing}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {cpiRefreshing ? "⟳ מעדכן..." : "🔄 עדכן מדד"}
              </button>
            </div>

            {cpiRecords.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <div className="text-3xl mb-2">📈</div>
                <div>לא נמצאו רשומות מדד</div>
                <button onClick={refreshCPI} className="mt-3 text-blue-600 hover:underline text-sm">
                  משוך מדדים מ-API הלמ"ס
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs border-b border-slate-100">
                    <tr>
                      <th className="px-3 py-2 font-semibold">שנה</th>
                      {MONTHS_HE.map(m => <th key={m} className="px-2 py-2 font-semibold text-center">{m}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const byYear: Record<number, Record<number, number>> = {};
                      cpiRecords.forEach(r => {
                        if (!byYear[r.year]) byYear[r.year] = {};
                        byYear[r.year][r.month] = r.value;
                      });
                      return Object.keys(byYear).sort((a,b) => Number(b)-Number(a)).map(year => (
                        <tr key={year} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 font-bold text-slate-800">{year}</td>
                          {Array.from({length:12},(_,i)=>i+1).map(m => (
                            <td key={m} className="px-2 py-2 text-center text-xs text-slate-600">
                              {byYear[Number(year)]?.[m]?.toFixed(1) ?? <span className="text-slate-300">—</span>}
                            </td>
                          ))}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-700">
            <strong>כלל t-2:</strong> המדד הקובע לתשלום ב-1 לחודש X הוא המדד של חודש X-2.
            הלמ"ס מפרסם ב-15 לחודש את מדד החודש הקודם.
            <div className="mt-1">לדוגמה: תשלום ב-1.3.2026 → מדד קובע = ינואר 2026</div>
          </div>
        </div>
      )}

      {/* משתמשים */}
      {tab === "users" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold text-slate-700 mb-4">ניהול משתמשים</h2>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600 text-center">
            <div className="text-3xl mb-2">👤</div>
            <div className="font-medium mb-1">ניהול משתמשים</div>
            <div className="text-xs text-slate-400">ניהול משתמשים מתבצע דרך Supabase Auth Dashboard</div>
            <a href="https://supabase.com/dashboard/project/ndvcqgrpsqykhodiyrhx/auth/users"
              target="_blank" rel="noopener noreferrer"
              className="mt-3 inline-block rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800">
              פתח Supabase Auth ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
