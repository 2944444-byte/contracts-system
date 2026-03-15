"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const TABS = [
  { id: "general",   label: "כללי",       icon: "⚙️" },
  { id: "vat",       label: "מע\"מ",      icon: "🧾" },
  { id: "templates", label: "תבניות",     icon: "📄" },
];

export default function SettingsPage() {
  const [tab,      setTab]      = useState("general");
  const [vatRates, setVatRates] = useState<any[]>([]);
  const [templates,setTemplates]= useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState("");

  // general settings
  const [companyName,    setCompanyName]    = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone,   setCompanyPhone]   = useState("");
  const [companyEmail,   setCompanyEmail]   = useState("");

  // VAT form
  const [newVatRate,  setNewVatRate]  = useState("");
  const [newVatFrom,  setNewVatFrom]  = useState("");
  const [newVatNotes, setNewVatNotes] = useState("");

  // template form
  const [editTplId,   setEditTplId]   = useState("");
  const [tplName,     setTplName]     = useState("");
  const [tplBody,     setTplBody]     = useState("");
  const [tplActive,   setTplActive]   = useState(true);

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: vat }, { data: tpl }] = await Promise.all([
      supabase.from("vat_rates").select("*").order("effective_from", { ascending: false }),
      supabase.from("document_templates").select("*").order("name"),
    ]);
    setVatRates(vat ?? []);
    setTemplates(tpl ?? []);
    setLoading(false);
  }

  function showMsg(m: string) {
    setMsg(m);
    setTimeout(function() { setMsg(""); }, 3000);
  }

  async function saveVat() {
    if (!newVatRate || !newVatFrom) { alert("חובה: שיעור ותאריך תחילה"); return; }
    setSaving(true);
    // עדכן "תוקף עד" של הרשומה הנוכחית
    const current = vatRates.find(function(v) { return !v.effective_to; });
    if (current) {
      const dayBefore = new Date(newVatFrom);
      dayBefore.setDate(dayBefore.getDate() - 1);
      await supabase.from("vat_rates").update({ effective_to: dayBefore.toISOString().split("T")[0] }).eq("id", current.id);
    }
    await supabase.from("vat_rates").insert({
      rate_pct: Number(newVatRate), effective_from: newVatFrom,
      effective_to: null, notes: newVatNotes || null,
    });
    setNewVatRate(""); setNewVatFrom(""); setNewVatNotes("");
    setSaving(false);
    showMsg("✅ שיעור מע\"מ נוסף");
    await loadAll();
  }

  function openTpl(t?: any) {
    if (t) {
      setEditTplId(t.id); setTplName(t.name ?? ""); setTplBody(t.body_template ?? ""); setTplActive(t.is_active ?? true);
    } else {
      setEditTplId("new"); setTplName(""); setTplBody(""); setTplActive(true);
    }
  }

  async function saveTpl() {
    if (!tplName.trim()) { alert("חובה: שם תבנית"); return; }
    setSaving(true);
    const payload = { name: tplName.trim(), body_template: tplBody, is_active: tplActive };
    if (editTplId === "new") {
      await supabase.from("document_templates").insert(payload);
    } else {
      await supabase.from("document_templates").update(payload).eq("id", editTplId);
    }
    setEditTplId("");
    setSaving(false);
    showMsg("✅ תבנית נשמרה");
    await loadAll();
  }

  async function deleteTpl(id: string) {
    if (!confirm("למחוק תבנית?")) return;
    await supabase.from("document_templates").delete().eq("id", id);
    await loadAll();
  }

  const currentVat = vatRates.find(function(v) { return !v.effective_to; });

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">הגדרות</h1>
      </div>

      {msg && (
        <div className="mb-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 font-semibold">
          {msg}
        </div>
      )}

      {/* טאבים */}
      <div className="mb-5 flex gap-1">
        {TABS.map(function(t) {
          return (
            <button key={t.id} onClick={function() { setTab(t.id); }}
              className={"rounded-xl border px-4 py-2 text-sm font-semibold transition-all " +
                (tab === t.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {/* כללי */}
      {tab === "general" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 max-w-lg">
          <h2 className="font-bold text-slate-800 mb-4">פרטי חברה</h2>
          <div className="space-y-3">
            {[
              { label: "שם החברה",  val: companyName,    set: setCompanyName    },
              { label: "כתובת",     val: companyAddress, set: setCompanyAddress },
              { label: "טלפון",     val: companyPhone,   set: setCompanyPhone   },
              { label: "אימייל",    val: companyEmail,   set: setCompanyEmail   },
            ].map(function(f) {
              return (
                <div key={f.label}>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{f.label}</label>
                  <input type="text" value={f.val} onChange={function(e) { f.set(e.target.value); }} className={ic} />
                </div>
              );
            })}
            <button onClick={function() { showMsg("✅ נשמר"); }}
              className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800">
              שמור
            </button>
          </div>
          <div className="mt-6 rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-600 mb-2">מע"מ נוכחי</div>
            <div className="text-3xl font-black text-blue-700">{currentVat?.rate_pct ?? 18}%</div>
            <div className="text-xs text-slate-400 mt-1">
              מ-{currentVat?.effective_from ? new Date(currentVat.effective_from).toLocaleDateString("he-IL") : "—"}
            </div>
          </div>
        </div>
      )}

      {/* מע"מ */}
      {tab === "vat" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
            <h2 className="font-bold text-slate-800 mb-4">הוסף שיעור מע"מ חדש</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שיעור (%)</label>
                <input type="number" value={newVatRate} onChange={function(e) { setNewVatRate(e.target.value); }}
                  className={ic} placeholder="18" step="0.1" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך כניסה לתוקף</label>
                <input type="date" value={newVatFrom} onChange={function(e) { setNewVatFrom(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערה</label>
                <input type="text" value={newVatNotes} onChange={function(e) { setNewVatNotes(e.target.value); }} className={ic} />
              </div>
              <button onClick={saveVat} disabled={saving}
                className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {saving ? "שומר..." : "הוסף שיעור"}
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-700">היסטוריית מע"מ</div>
            {loading ? (
              <div className="p-8 text-center text-slate-400">טוען...</div>
            ) : (
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-slate-600 border-b">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">שיעור</th>
                    <th className="px-4 py-2.5 font-semibold">מ-</th>
                    <th className="px-4 py-2.5 font-semibold">עד</th>
                    <th className="px-4 py-2.5 font-semibold">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {vatRates.map(function(v) {
                    const isCurrent = !v.effective_to;
                    return (
                      <tr key={v.id} className={"border-t border-slate-100 " + (isCurrent ? "bg-blue-50" : "")}>
                        <td className={"px-4 py-2.5 font-bold text-xl " + (isCurrent ? "text-blue-700" : "text-slate-600")}>{v.rate_pct}%</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{v.effective_from ? new Date(v.effective_from).toLocaleDateString("he-IL") : "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{v.effective_to ? new Date(v.effective_to).toLocaleDateString("he-IL") : "—"}</td>
                        <td className="px-4 py-2.5">{isCurrent && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">נוכחי</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* תבניות */}
      {tab === "templates" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            {!editTplId ? (
              <button onClick={function() { openTpl(); }}
                className="w-full rounded-xl border-2 border-dashed border-blue-200 p-4 text-blue-600 hover:bg-blue-50 font-semibold text-sm">
                + תבנית חדשה
              </button>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-slate-800">{editTplId === "new" ? "תבנית חדשה" : "עריכת תבנית"}</h3>
                  <button onClick={function() { setEditTplId(""); }} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">שם התבנית</label>
                    <input type="text" value={tplName} onChange={function(e) { setTplName(e.target.value); }} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">תוכן</label>
                    <div className="text-xs text-slate-400 mb-1">
                      משתנים: {"{{tenant_name}}"} {"{{property_name}}"} {"{{date}}"} {"{{contact_name}}"}
                    </div>
                    <textarea value={tplBody} onChange={function(e) { setTplBody(e.target.value); }}
                      rows={8} className={ic + " font-mono text-xs"} />
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={tplActive} onChange={function(e) { setTplActive(e.target.checked); }} className="w-4 h-4" />
                    <span>תבנית פעילה</span>
                  </label>
                  <div className="flex gap-2">
                    <button onClick={function() { setEditTplId(""); }}
                      className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">ביטול</button>
                    <button onClick={saveTpl} disabled={saving}
                      className="flex-1 rounded-lg bg-blue-700 py-2 text-sm font-bold text-white disabled:opacity-50">
                      {saving ? "שומר..." : "שמור"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {templates.map(function(t) {
              return (
                <div key={t.id} className={"rounded-xl border p-4 " + (t.is_active ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60")}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-slate-800 text-sm">{t.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{t.body_template?.substring(0, 60)}...</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={function() { openTpl(t); }}
                        className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50">עריכה</button>
                      <button onClick={function() { deleteTpl(t.id); }}
                        className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                    </div>
                  </div>
                  {!t.is_active && <div className="text-xs text-slate-400 mt-1">לא פעיל</div>}
                </div>
              );
            })}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <div className="font-bold text-slate-700 mb-3 text-sm">משתנים זמינים בתבניות</div>
            {[
              { v: "{{tenant_name}}",    d: "שם השוכר" },
              { v: "{{property_name}}", d: "שם הנכס" },
              { v: "{{contact_name}}",  d: "איש קשר" },
              { v: "{{date}}",          d: "תאריך היום" },
            ].map(function(m) {
              return (
                <div key={m.v} className="flex items-center gap-3 py-2 border-b border-slate-200 last:border-0">
                  <code className="text-xs bg-white border border-slate-200 rounded px-2 py-0.5 text-blue-700 font-mono">{m.v}</code>
                  <span className="text-sm text-slate-600">{m.d}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
