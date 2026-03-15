"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
const MO = ["ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצמ"];




function VatHistorySection() {
  const ic3 = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400";
  const [rates,   setRates]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding,  setAdding]  = useState(false);
  const [fRate,   setFRate]   = useState("");
  const [fFrom,   setFFrom]   = useState("");
  const [fTo,     setFTo]     = useState("");
  const [fNotes,  setFNotes]  = useState("");

  useEffect(function() {
    supabase.from("vat_rates").select("*").order("effective_from", { ascending: false })
      .then(function({ data }) { setRates(data ?? []); setLoading(false); });
  }, []);

  async function addRate() {
    if (!fRate || !fFrom) { alert("חובה: שיעור ותאריך התחלה"); return; }
    const { error } = await supabase.from("vat_rates").insert({
      rate_pct: Number(fRate), effective_from: fFrom, effective_to: fTo || null, notes: fNotes || null,
    });
    if (error) { alert("שגיאה: " + error.message); return; }
    const { data } = await supabase.from("vat_rates").select("*").order("effective_from", { ascending: false });
    setRates(data ?? []);
    setFRate(""); setFFrom(""); setFTo(""); setFNotes(""); setAdding(false);
  }

  function fmtD(d: string) {
    if (!d) return "—";
    const [y,m,day] = d.split("-");
    return `${day}/${m}/${y}`;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs border-b">
            <tr>
              <th className="px-4 py-2.5 font-semibold">שיעור מע"מ</th>
              <th className="px-4 py-2.5 font-semibold">מתאריך</th>
              <th className="px-4 py-2.5 font-semibold">עד תאריך</th>
              <th className="px-4 py-2.5 font-semibold">הערות</th>
              <th className="px-4 py-2.5 font-semibold">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-6 text-center text-slate-400 text-xs">טוען...</td></tr>
            ) : rates.map(function(r) {
              const isActive = !r.effective_to || new Date(r.effective_to) >= new Date();
              return (
                <tr key={r.id} className={"border-t " + (isActive ? "bg-green-50" : "hover:bg-slate-50")}>
                  <td className="px-4 py-2.5 font-bold text-lg text-slate-800">{r.rate_pct}%</td>
                  <td className="px-4 py-2.5 text-slate-600">{fmtD(r.effective_from)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{fmtD(r.effective_to)}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{r.notes}</td>
                  <td className="px-4 py-2.5">
                    {isActive && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                        פעיל כעת
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adding ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שיעור (%)</label>
              <input type="number" value={fRate} onChange={function(e) { setFRate(e.target.value); }} className={ic3} placeholder="18" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">מתאריך</label>
              <input type="date" value={fFrom} onChange={function(e) { setFFrom(e.target.value); }} className={ic3} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">עד תאריך (ריק = עד היום)</label>
              <input type="date" value={fTo} onChange={function(e) { setFTo(e.target.value); }} className={ic3} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
              <input type="text" value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} className={ic3} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={function() { setAdding(false); }}
              className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">ביטול</button>
            <button onClick={addRate}
              className="flex-1 rounded-lg bg-blue-700 py-2 text-sm font-bold text-white hover:bg-blue-800">שמור</button>
          </div>
        </div>
      ) : (
        <button onClick={function() { setAdding(true); }}
          className="text-xs text-blue-600 hover:underline">+ הוסף שיעור מע"מ חדש</button>
      )}
    </div>
  );
}

function TemplatesSection() {
  const ic2 = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400";
  const [selectedType, setSelectedType] = useState("annual_start");
  const [tmplContent, setTmplContent]   = useState("");
  const [savedAt,     setSavedAt]       = useState("");
  const [saving,      setSaving2]       = useState(false);
  const [loadingT,    setLoadingT]      = useState(false);

  const TTYPES = [
    { v: "annual_start",  l: "📋 תחילת שנה" },
    { v: "indexation",    l: "📊 הפרשי הצמדה" },
    { v: "management",    l: "🔧 השלמת ניהול" },
    { v: "demand",        l: "📬 דרישת תשלום" },
    { v: "insurance",     l: "🛡️ דמי ביטוח" },
    { v: "rent_update",   l: "📈 עדכון שכ\"ד" },
  ];

  const DEFAULTS: Record<string,string> = {
    annual_start: "לכבוד: {{tenant_name}}\nהנדון: שיקי שכ\"ד לשנת {{year}}\n\n{{payment_table}}\n\nבברכה,\n{{company_name}}",
    indexation:   "לכבוד: {{tenant_name}}\nהנדון: הפרשי הצמדה {{year}}\n\n{{indexation_table}}\n\nסה\"כ: ₪{{total_diff}}\n\nבברכה,\n{{company_name}}",
    management:   "לכבוד: {{tenant_name}}\nהנדון: השלמת דמי ניהול {{year}}\n\nהוצאות בפועל: ₪{{actual_cost}}\nPlus: ₪{{plus_amount}}\nיתרה: ₪{{balance}}\n\nבברכה,\n{{company_name}}",
    demand:       "לכבוד: {{tenant_name}}\nהנדון: דרישת תשלום\n\nסכום: ₪{{amount}}\nעבור: {{description}}\nתאריך: {{due_date}}\n\nבברכה,\n{{company_name}}",
    insurance:    "לכבוד: {{tenant_name}}\nהנדון: דמי ביטוח {{year}}\n\nחלקכם בפרמיה: ₪{{amount}}\n\nבברכה,\n{{company_name}}",
    rent_update:  "לכבוד: {{tenant_name}}\nהנדון: עדכון שכר דירה\n\nשכ\"ד חדש: ₪{{new_rent}} מתאריך {{effective_date}}\n\nבברכה,\n{{company_name}}",
  };

  const VARS = ["{{tenant_name}}","{{company_name}}","{{year}}","{{payment_table}}",
    "{{indexation_table}}","{{total_diff}}","{{actual_cost}}","{{plus_amount}}",
    "{{balance}}","{{amount}}","{{description}}","{{due_date}}","{{new_rent}}",
    "{{effective_date}}","{{property_name}}","{{base_index_value}}","{{index_ratio}}"];

  useEffect(function() {
    setLoadingT(true);
    supabase.from("document_templates").select("content,updated_at")
      .eq("template_type", selectedType).single()
      .then(function({ data }) {
        if (data) { setTmplContent(data.content); setSavedAt(data.updated_at ? new Date(data.updated_at).toLocaleDateString("he-IL") : ""); }
        else       { setTmplContent(DEFAULTS[selectedType] ?? ""); setSavedAt(""); }
        setLoadingT(false);
      });
  }, [selectedType]);

  async function saveTemplate() {
    setSaving2(true);
    try {
      const { error } = await supabase.from("document_templates").upsert(
        { template_type: selectedType, content: tmplContent, updated_at: new Date().toISOString() },
        { onConflict: "template_type" }
      );
      if (error) throw error;
      setSavedAt(new Date().toLocaleDateString("he-IL"));
      alert("תבנית נשמרה!");
    } catch(e: any) { alert("שגיאה: " + (e as any)?.message); }
    finally { setSaving2(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-bold text-slate-700 mb-1">תבניות מסמכים</div>
        <div className="text-xs text-slate-400">ערוך את הטקסט — השדות בין סוגריים כפולות יוחלפו אוטומטית</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {TTYPES.map(function(t) {
          return (
            <button key={t.v} onClick={function() { setSelectedType(t.v); }}
              className={"rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all " +
                (selectedType === t.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {t.l}
            </button>
          );
        })}
      </div>
      <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-600">
            {TTYPES.find(function(t) { return t.v === selectedType; })?.l}
            {savedAt && <span className="text-slate-400 mr-2 font-normal">— עודכן {savedAt}</span>}
          </span>
          <button onClick={function() { setTmplContent(DEFAULTS[selectedType] ?? ""); }}
            className="text-xs text-slate-400 hover:text-slate-600 hover:underline">אפס</button>
        </div>
        {loadingT ? (
          <div className="text-center py-6 text-slate-400 text-xs">טוען...</div>
        ) : (
          <textarea value={tmplContent} onChange={function(e) { setTmplContent(e.target.value); }}
            rows={12} dir="rtl"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-xs text-slate-800 bg-white font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400" />
        )}
        <div className="flex justify-between items-center mt-3">
          <div className="flex flex-wrap gap-1">
            {VARS.slice(0,8).map(function(v) {
              return (
                <button key={v} onClick={function() { setTmplContent(function(p) { return p + v; }); }}
                  className="text-xs bg-white border border-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-mono hover:bg-blue-50">
                  {v}
                </button>
              );
            })}
          </div>
          <button onClick={saveTemplate} disabled={saving || loadingT}
            className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {saving ? "שומר..." : "💾 שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [tab,          setTab]          = useState("company");
  const [companyName,  setCompanyName]  = useState("");
  const [companyReg,   setCompanyReg]   = useState("");
  const [companyAddr,  setCompanyAddr]  = useState("");
  const [companyCity,  setCompanyCity]  = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyId,    setCompanyId]    = useState("");
  const [savingCo,     setSavingCo]     = useState(false);
  const [vatPct,       setVatPct]       = useState("18");
  const [cpiRows,      setCpiRows]      = useState<any[]>([]);
  const [refreshing,   setRefreshing]   = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const { data: cos } = await supabase.from("companies").select("*").limit(1);
    if (cos && cos[0]) {
      const c = cos[0];
      setCompanyId(c.id ?? "");
      setCompanyName(c.company_name ?? "");
      setCompanyReg(c.company_registration_number ?? "");
      setCompanyAddr(c.address ?? "");
      setCompanyCity(c.city ?? "");
      setCompanyPhone(c.phone ?? "");
      setCompanyEmail(c.email ?? "");
    }
    const { data: cpi } = await supabase
      .from("cpi_records").select("*")
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(36);
    setCpiRows(cpi ?? []);
  }

  async function saveCompany() {
    if (!companyName.trim()) { alert("חובה: שם חברה"); return; }
    setSavingCo(true);
    try {
      const p = {
        company_name: companyName,
        company_registration_number: companyReg || null,
        address: companyAddr || null,
        city: companyCity || null,
        phone: companyPhone || null,
        email: companyEmail || null,
      };
      if (companyId) {
        await supabase.from("companies").update(p).eq("id", companyId);
      } else {
        const { data } = await supabase.from("companies").insert(p).select().single();
        if (data) setCompanyId(data.id);
      }
      alert("נשמר!");
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSavingCo(false); }
  }

  async function refreshCPI() {
    setRefreshing(true);
    try {
      const y = new Date().getFullYear();
      const res = await fetch("/api/cpi?from_year=" + (y-1) + "&to_year=" + y + "&refresh=true");
      const d = await res.json();
      alert("עודכן: " + (d.inserted ?? 0) + " רשומות");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setRefreshing(false); }
  }

  // בנה טבלת מדד
  const cpiByYear: Record<string, Record<string, number>> = {};
  cpiRows.forEach(function(r) {
    if (!cpiByYear[r.year]) cpiByYear[r.year] = {};
    cpiByYear[r.year][r.month] = r.value;
  });
  const cpiYears = Object.keys(cpiByYear).sort(function(a, b) { return Number(b) - Number(a); });

  return (
    <div dir="rtl" className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">הגדרות מערכת</h1>
      </div>

      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {["company","vat","cpi","users"].map(function(k) {
          const labels: Record<string,string> = { company: "פרטי חברה", vat: "מע\"מ", cpi: "מדד מחירים", users: "משתמשים", templates: "📝 תבניות", vat_history: "📅 היסטוריית מע\"מ" };
          return (
            <button key={k} onClick={function() { setTab(k); }}
              className={"px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors " + (tab === k ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
              {labels[k]}
            </button>
          );
        })}
      </div>

      {tab === "company" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-700">פרטי החברה המנהלת</h2>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שם החברה</label>
            <input type="text" value={companyName} onChange={function(e) { setCompanyName(e.target.value); }} className={ic} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">ח.פ</label>
              <input type="text" value={companyReg} onChange={function(e) { setCompanyReg(e.target.value); }} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">עיר</label>
              <input type="text" value={companyCity} onChange={function(e) { setCompanyCity(e.target.value); }} className={ic} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
            <input type="text" value={companyAddr} onChange={function(e) { setCompanyAddr(e.target.value); }} className={ic} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון</label>
              <input type="tel" value={companyPhone} onChange={function(e) { setCompanyPhone(e.target.value); }} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל</label>
              <input type="email" value={companyEmail} onChange={function(e) { setCompanyEmail(e.target.value); }} className={ic} />
            </div>
          </div>
          <button onClick={saveCompany} disabled={savingCo}
            className="w-full rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {savingCo ? "שומר..." : "שמור פרטי חברה"}
          </button>
        </div>
      )}

      {tab === "vat" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-700">הגדרות מע&quot;מ</h2>
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800">
            שיעור מע&quot;מ נוכחי: <strong>18%</strong> — בתוקף מ-1.1.2025
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שיעור ברירת מחדל</label>
            <select value={vatPct} onChange={function(e) { setVatPct(e.target.value); }} className={ic}>
              <option value="0">0% — פטור</option>
              <option value="17">17% — ישן</option>
              <option value="18">18% — נוכחי</option>
            </select>
          </div>
          <div className="rounded-lg bg-yellow-50 border border-yellow-100 p-3 text-xs text-yellow-800">
            שינוי ישפיע על חוזים חדשים בלבד.
          </div>
          <button onClick={function() { alert("שמור: " + vatPct + "%"); }}
            className="w-full rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800">
            שמור
          </button>
        </div>
      )}

      {tab === "cpi" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-slate-700">מדד המחירים לצרכן</h2>
                <p className="text-xs text-slate-400 mt-0.5">API הלמ&quot;ס — סדרה 120010</p>
              </div>
              <button onClick={refreshCPI} disabled={refreshing}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {refreshing ? "מעדכן..." : "עדכן מדד"}
              </button>
            </div>
            {cpiRows.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <div className="text-3xl mb-2">📈</div>
                <button onClick={refreshCPI} className="text-blue-600 hover:underline text-sm">משוך מדדים</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-slate-600">שנה</th>
                      {MO.map(function(m) { return <th key={m} className="px-2 py-2 font-semibold text-slate-600 text-center">{m}</th>; })}
                    </tr>
                  </thead>
                  <tbody>
                    {cpiYears.map(function(year) {
                      return (
                        <tr key={year} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 font-bold text-slate-800">{year}</td>
                          {[1,2,3,4,5,6,7,8,9,10,11,12].map(function(m) {
                            const val = cpiByYear[year] && cpiByYear[year][m];
                            return (
                              <td key={m} className="px-2 py-2 text-center text-slate-600">
                                {val ? val.toFixed(1) : <span className="text-slate-300">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-700">
            <strong>כלל t-2:</strong> תשלום ב-1.3.2026 → מדד קובע = ינואר 2026 (פורסם 15.2)
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <div className="text-4xl mb-3">👤</div>
          <div className="font-medium text-slate-700 mb-1">ניהול משתמשים</div>
          <div className="text-xs text-slate-400 mb-4">מתבצע דרך Supabase Auth Dashboard</div>
          <a href="https://supabase.com/dashboard/project/ndvcqgrpsqykhodiyrhx/auth/users"
            target="_blank" rel="noopener noreferrer"
            className="inline-block rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800">
            פתח Supabase Auth
          </a>
        </div>
      )}

      {tab === "vat_history" && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-bold text-slate-700 mb-1">היסטוריית שיעורי מע"מ</div>
          <div className="text-xs text-slate-400 mb-4">שיעורי מע"מ היסטוריים — חשוב לחישוב תקופות עבר</div>
          <VatHistorySection />
        </div>
      )}
      {tab === "templates" && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
          <TemplatesSection />
        </div>
      )}
    </div>
  );
}
